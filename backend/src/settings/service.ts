import {
  feedbackMutationSchema,
  languageRequestSchema,
  revenueGoalMutationSchema,
  type FeedbackMutation,
  type RevenueGoalMutation,
} from "@brew-dashboard/contracts";
import { and, eq } from "drizzle-orm";

import { lockNetwork, type RequestTransaction } from "../db/client.ts";
import { isZero, parseDecimal } from "../domain/decimal.ts";
import {
  claimIdempotency,
  completeIdempotency,
  hashOperationPayload,
} from "../domain/idempotency.ts";
import { localDateKey } from "../domain/periods.ts";
import { feedbackResponses, networks, revenueTargets } from "../db/schema.ts";
import { recordServerProductEvent } from "../events/service.ts";
import { ApiProblem } from "../http/errors.ts";
import { assertDemoDataRevision } from "../onboarding/service.ts";

export const SETTINGS_LANGUAGE_OPERATION = "settings.language";
export const REVENUE_GOAL_OPERATION = "settings.revenue-goal";
export const FEEDBACK_OPERATION = "feedback.upsert";

const feedbackData = (feedback: typeof feedbackResponses.$inferSelect) => ({
  rating: feedback.rating,
  comment: feedback.comment,
  desiredFeatures: feedback.desiredFeatures,
  version: feedback.version,
  submittedAt: feedback.submittedAt.toISOString(),
  updatedAt: feedback.updatedAt.toISOString(),
});

const loadNetworkForUpdate = async (transaction: RequestTransaction, networkId: string) => {
  const rows = await transaction
    .select({
      id: networks.id,
      timezone: networks.timezone,
      demoDataRevision: networks.demoDataRevision,
    })
    .from(networks)
    .where(eq(networks.id, networkId))
    .for("update")
    .limit(1);
  const network = rows[0];
  if (!network || !network.timezone)
    throw new ApiProblem("NOT_FOUND", 404, "Network was not found");
  return { ...network, timezone: network.timezone };
};

export const setSettingsLanguage = async (
  transaction: RequestTransaction,
  input: {
    networkId: string;
    request: { language: "en" | "ru"; idempotencyKey: string };
  },
) => {
  const request = languageRequestSchema.parse(input.request);
  await lockNetwork(transaction, input.networkId);
  const requestHash = await hashOperationPayload(SETTINGS_LANGUAGE_OPERATION, {
    language: request.language,
  });
  const claim = await claimIdempotency(transaction, {
    networkId: input.networkId,
    key: request.idempotencyKey,
    operation: SETTINGS_LANGUAGE_OPERATION,
    requestHash,
  });
  if (!claim.replay) {
    await transaction
      .update(networks)
      .set({ language: request.language, updatedAt: new Date() })
      .where(eq(networks.id, input.networkId));
    await completeIdempotency(transaction, { id: claim.id, resourceId: input.networkId });
  }
  return { language: request.language, effectiveLanguage: request.language };
};

export const setRevenueGoal = async (
  transaction: RequestTransaction,
  input: {
    authUserId: string;
    networkId: string;
    request: RevenueGoalMutation;
    now?: Date;
  },
) => {
  const request = revenueGoalMutationSchema.parse(input.request);
  const now = input.now ?? new Date();
  await lockNetwork(transaction, input.networkId);
  const network = await loadNetworkForUpdate(transaction, input.networkId);
  assertDemoDataRevision(network.demoDataRevision, request.expectedDemoDataRevision);
  const monthDate = `${localDateKey(now, network.timezone).slice(0, 7)}-01`;
  const month = monthDate.slice(0, 7);
  const targets = await transaction
    .select()
    .from(revenueTargets)
    .where(and(eq(revenueTargets.networkId, input.networkId), eq(revenueTargets.month, monthDate)))
    .for("update")
    .limit(1);
  const current = targets[0] ?? null;
  const requestHash = await hashOperationPayload(REVENUE_GOAL_OPERATION, {
    monthlyGoal: request.monthlyGoal,
    expectedVersion: request.expectedVersion,
    expectedDemoDataRevision: request.expectedDemoDataRevision,
  });
  const claim = await claimIdempotency(transaction, {
    networkId: input.networkId,
    key: request.idempotencyKey,
    operation: REVENUE_GOAL_OPERATION,
    requestHash,
  });
  if (claim.replay) {
    return {
      month,
      monthlyGoal: isZero(parseDecimal(request.monthlyGoal)) ? null : request.monthlyGoal,
      version: isZero(parseDecimal(request.monthlyGoal))
        ? null
        : (request.expectedVersion ?? 0) + 1,
      demoDataRevision: network.demoDataRevision,
    };
  }
  if ((current?.version ?? null) !== request.expectedVersion) {
    throw new ApiProblem("CONFLICT", 409, "Revenue goal changed in another tab", {
      expectedVersion: ["Reload the latest goal before saving"],
    });
  }

  const zero = isZero(parseDecimal(request.monthlyGoal));
  if (zero) {
    if (current) {
      await transaction.delete(revenueTargets).where(eq(revenueTargets.id, current.id));
    }
    await completeIdempotency(transaction, {
      id: claim.id,
      resourceId: input.networkId,
      completedAt: now,
    });
    if (current) {
      await recordServerProductEvent(transaction, {
        authUserId: input.authUserId,
        networkId: input.networkId,
        type: "revenue_goal_changed",
        route: "settings",
        metadata: {},
        occurredAt: now,
      });
    }
    return { month, monthlyGoal: null, version: null, demoDataRevision: network.demoDataRevision };
  }

  const target = current
    ? (
        await transaction
          .update(revenueTargets)
          .set({ amount: request.monthlyGoal, version: current.version + 1, updatedAt: now })
          .where(eq(revenueTargets.id, current.id))
          .returning()
      )[0]
    : (
        await transaction
          .insert(revenueTargets)
          .values({ networkId: input.networkId, month: monthDate, amount: request.monthlyGoal })
          .returning()
      )[0];
  if (!target) throw new Error("Revenue goal was not saved");
  await completeIdempotency(transaction, { id: claim.id, resourceId: target.id, completedAt: now });
  await recordServerProductEvent(transaction, {
    authUserId: input.authUserId,
    networkId: input.networkId,
    type: "revenue_goal_changed",
    route: "settings",
    metadata: {},
    occurredAt: now,
  });
  return {
    month,
    monthlyGoal: target.amount,
    version: target.version,
    demoDataRevision: network.demoDataRevision,
  };
};

export const getFeedback = async (transaction: RequestTransaction, networkId: string) => {
  const rows = await transaction
    .select()
    .from(feedbackResponses)
    .where(eq(feedbackResponses.networkId, networkId))
    .limit(1);
  return rows[0] ? feedbackData(rows[0]) : null;
};

export const upsertFeedback = async (
  transaction: RequestTransaction,
  input: { authUserId: string; networkId: string; request: FeedbackMutation; now?: Date },
) => {
  const request = feedbackMutationSchema.parse(input.request);
  const now = input.now ?? new Date();
  await lockNetwork(transaction, input.networkId);
  const rows = await transaction
    .select()
    .from(feedbackResponses)
    .where(eq(feedbackResponses.networkId, input.networkId))
    .for("update")
    .limit(1);
  const current = rows[0] ?? null;
  const requestHash = await hashOperationPayload(FEEDBACK_OPERATION, {
    rating: request.rating,
    comment: request.comment,
    desiredFeatures: request.desiredFeatures,
    expectedVersion: request.expectedVersion,
  });
  const claim = await claimIdempotency(transaction, {
    networkId: input.networkId,
    key: request.idempotencyKey,
    operation: FEEDBACK_OPERATION,
    requestHash,
  });
  if (claim.replay) return getFeedback(transaction, input.networkId);
  if ((current?.version ?? null) !== request.expectedVersion) {
    throw new ApiProblem("CONFLICT", 409, "Feedback changed in another tab", {
      expectedVersion: ["Reload the latest feedback before saving"],
    });
  }
  const saved = current
    ? (
        await transaction
          .update(feedbackResponses)
          .set({
            rating: request.rating,
            comment: request.comment,
            desiredFeatures: request.desiredFeatures,
            version: current.version + 1,
            updatedAt: now,
          })
          .where(eq(feedbackResponses.id, current.id))
          .returning()
      )[0]
    : (
        await transaction
          .insert(feedbackResponses)
          .values({
            networkId: input.networkId,
            rating: request.rating,
            comment: request.comment,
            desiredFeatures: request.desiredFeatures,
            submittedAt: now,
            updatedAt: now,
          })
          .returning()
      )[0];
  if (!saved) throw new Error("Feedback was not saved");
  await completeIdempotency(transaction, { id: claim.id, resourceId: saved.id, completedAt: now });
  await recordServerProductEvent(transaction, {
    authUserId: input.authUserId,
    networkId: input.networkId,
    type: "feedback_submitted",
    route: "settings",
    metadata: { rating: request.rating },
    occurredAt: now,
  });
  return feedbackData(saved);
};
