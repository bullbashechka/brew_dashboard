import { type FeedbackMutation, type RevenueGoalMutation } from "@brew-dashboard/contracts";
import type { Context } from "hono";

import type { AppEnvironment } from "../http/types.ts";
import { getFeedback, setRevenueGoal, setSettingsLanguage, upsertFeedback } from "./service.ts";

const validatedJson = <T>(context: Context<AppEnvironment>): T =>
  (
    context.req as unknown as {
      valid: (target: "json") => T;
    }
  ).valid("json");

export const settingsLanguageHandler = async (context: Context<AppEnvironment>) => {
  const request = validatedJson<{ language: "en" | "ru"; idempotencyKey: string }>(context);
  const result = await setSettingsLanguage(context.get("database"), {
    networkId: context.get("auth").networkId,
    request,
  });
  return context.json({ data: result, meta: {}, requestId: context.get("requestId") }, 200);
};

export const revenueGoalHandler = async (context: Context<AppEnvironment>) => {
  const auth = context.get("auth");
  const result = await setRevenueGoal(context.get("database"), {
    authUserId: auth.authUserId,
    networkId: auth.networkId,
    request: validatedJson<RevenueGoalMutation>(context),
  });
  return context.json({ data: result, meta: {}, requestId: context.get("requestId") }, 200);
};

export const feedbackGetHandler = async (context: Context<AppEnvironment>) =>
  context.json({
    data: await getFeedback(context.get("database"), context.get("auth").networkId),
    meta: {},
    requestId: context.get("requestId"),
  });

export const feedbackPutHandler = async (context: Context<AppEnvironment>) => {
  const auth = context.get("auth");
  const result = await upsertFeedback(context.get("database"), {
    authUserId: auth.authUserId,
    networkId: auth.networkId,
    request: validatedJson<FeedbackMutation>(context),
  });
  return context.json({ data: result, meta: {}, requestId: context.get("requestId") }, 200);
};
