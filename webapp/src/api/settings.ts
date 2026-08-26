import {
  feedbackMutationSchema,
  feedbackResponseSchema,
  languageRequestSchema,
  onboardingLanguageResponseSchema,
  productEventRequestSchema,
  productEventResponseSchema,
  revenueGoalMutationResponseSchema,
  revenueGoalMutationSchema,
  type FeedbackMutation,
  type ProductEventRequest,
  type RevenueGoalMutation,
} from "@brew-dashboard/contracts";
import { queryOptions } from "@tanstack/react-query";

import { requestApi } from "./client";

export const feedbackQueryKey = (networkId: string) => ["tenant", networkId, "feedback"] as const;

export const feedbackQuery = (networkId: string) =>
  queryOptions({
    queryKey: feedbackQueryKey(networkId),
    queryFn: ({ signal }) =>
      requestApi({ path: "/api/v1/feedback", schema: feedbackResponseSchema, signal }),
  });

export const saveSettingsLanguage = (language: "en" | "ru", idempotencyKey: string) =>
  requestApi({
    path: "/api/v1/settings/language",
    method: "PUT",
    body: languageRequestSchema.parse({ language, idempotencyKey }),
    schema: onboardingLanguageResponseSchema,
  });

export const saveRevenueGoal = (request: RevenueGoalMutation) =>
  requestApi({
    path: "/api/v1/settings/revenue-goal",
    method: "PUT",
    body: revenueGoalMutationSchema.parse(request),
    schema: revenueGoalMutationResponseSchema,
  });

export const saveFeedback = (request: FeedbackMutation) =>
  requestApi({
    path: "/api/v1/feedback",
    method: "PUT",
    body: feedbackMutationSchema.parse(request),
    schema: feedbackResponseSchema,
  });

export const sendProductEvent = (request: ProductEventRequest) =>
  requestApi({
    path: "/api/v1/events",
    method: "POST",
    body: productEventRequestSchema.parse(request),
    schema: productEventResponseSchema,
  });
