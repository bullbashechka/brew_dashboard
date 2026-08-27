import type { ApiErrorCode } from "@brew-dashboard/contracts";
import type { Context } from "hono";

import type { AppEnvironment } from "./types.ts";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500;

export class ApiProblem extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: ErrorStatus,
    message: string,
    readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiProblem";
  }
}

export const ensureRequestId = (context: Context<AppEnvironment>) => {
  const current = context.get("requestId");
  const requestId = current || crypto.randomUUID();
  if (!current) context.set("requestId", requestId);
  context.header("x-request-id", requestId);
  return requestId;
};

export const errorResponse = (
  context: Context<AppEnvironment>,
  code: ApiErrorCode,
  status: ErrorStatus,
  message: string,
  fields: Record<string, string[]> = {},
) => {
  const requestId = ensureRequestId(context);
  return context.json(
    {
      error: { code, fields, message },
      requestId,
    },
    status,
  );
};

export const unauthenticatedResponse = (context: Context<AppEnvironment>) =>
  errorResponse(context, "UNAUTHENTICATED", 401, "Invalid login or password");
