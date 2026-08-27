import type { Context } from "hono";

import { loadActiveProfile } from "../auth/http.ts";
import type { AppEnvironment } from "../http/types.ts";
import { resetDemoData } from "./reset.ts";

const validatedJson = (context: Context<AppEnvironment>): { idempotencyKey: string } =>
  (
    context.req as unknown as {
      valid: (target: "json") => { idempotencyKey: string };
    }
  ).valid("json");

export const resetDemoHandler = async (context: Context<AppEnvironment>) => {
  const request = validatedJson(context);
  const auth = context.get("auth");
  const startedAt = new Date();
  const result = await resetDemoData(context.get("database"), {
    authUserId: auth.authUserId,
    networkId: auth.networkId,
    sessionId: auth.sessionId,
    idempotencyKey: request.idempotencyKey,
    startedAt,
  });
  const profile = await loadActiveProfile(context.get("database"), auth.authUserId, startedAt);
  if (!profile) throw new Error("Authenticated profile disappeared during demo reset");
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
