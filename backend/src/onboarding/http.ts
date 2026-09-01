import { type OnboardingRequest } from "@brew-dashboard/contracts";
import type { Context } from "hono";

import { loadActiveProfile } from "../auth/http.ts";
import { completeOnboarding, setOnboardingLanguage } from "./service.ts";
import type { AppEnvironment } from "../http/types.ts";

const validatedJson = (context: Context<AppEnvironment>): unknown =>
  (
    context.req as unknown as {
      valid: (target: "json") => unknown;
    }
  ).valid("json");

export const onboardingLanguageHandler = async (context: Context<AppEnvironment>) => {
  const request = validatedJson(context) as { language: "en" | "ru"; idempotencyKey: string };
  const auth = context.get("auth");
  const result = await setOnboardingLanguage(context.get("database"), {
    authUserId: auth.authUserId,
    networkId: auth.networkId,
    language: request.language,
    idempotencyKey: request.idempotencyKey,
  });
  const profile = await loadActiveProfile(context.get("database"), auth.authUserId);
  if (!profile) throw new Error("Authenticated profile disappeared during onboarding");
  context.set("auth", { ...auth, profile: profile.profile });
  return context.json(
    {
      data: result,
      meta: {},
      requestId: context.get("requestId"),
    },
    200,
  );
};

export const onboardingCompleteHandler = async (context: Context<AppEnvironment>) => {
  const request = validatedJson(context) as OnboardingRequest;
  const auth = context.get("auth");
  const startedAt = new Date();
  const result = await completeOnboarding(context.get("database"), {
    authUserId: auth.authUserId,
    networkId: auth.networkId,
    request,
    startedAt,
  });
  const profile = await loadActiveProfile(context.get("database"), auth.authUserId, startedAt);
  if (!profile) throw new Error("Authenticated profile disappeared during onboarding");
  context.set("auth", { ...auth, profile: profile.profile });
  return context.json(
    {
      data: {
        profile: profile.profile,
        generation: result.generation,
        counts: result.counts,
      },
      meta: {},
      requestId: context.get("requestId"),
    },
    200,
  );
};
