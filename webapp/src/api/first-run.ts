import {
  languageRequestSchema,
  loginRequestSchema,
  onboardingCompleteResponseSchema,
  onboardingLanguageResponseSchema,
  onboardingRequestSchema,
  sessionResponseSchema,
  type OnboardingRequest,
} from "@brew-dashboard/contracts";

import { requestApi } from "./client";

export type OnboardingFormRequest = Omit<OnboardingRequest, "idempotencyKey">;

export const login = (request: { login: string; password: string }) =>
  requestApi({
    path: "/api/v1/auth/login",
    method: "POST",
    body: loginRequestSchema.parse(request),
    schema: sessionResponseSchema,
    unauthorized: "ignore",
  });

export const saveOnboardingLanguage = (language: "en" | "ru") =>
  requestApi({
    path: "/api/v1/onboarding/language",
    method: "PUT",
    body: languageRequestSchema.parse({ language, idempotencyKey: crypto.randomUUID() }),
    schema: onboardingLanguageResponseSchema,
  });

export const completeOnboarding = (request: OnboardingFormRequest) =>
  requestApi({
    path: "/api/v1/onboarding/complete",
    method: "POST",
    body: onboardingRequestSchema.parse({ ...request, idempotencyKey: crypto.randomUUID() }),
    schema: onboardingCompleteResponseSchema,
  });
