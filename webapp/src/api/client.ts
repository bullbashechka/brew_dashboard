import { apiErrorResponseSchema, type ApiErrorCode } from "@brew-dashboard/contracts";
import type { z } from "zod";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: ApiErrorCode,
    readonly fields: Record<string, string[]> = {},
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type RequestOptions<TSchema extends z.ZodType> = {
  path: `/api/v1/${string}`;
  schema: TSchema;
  method?: "GET" | "POST" | "PUT" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
  unauthorized?: "session" | "guest" | "ignore";
};

let sessionExpiredHandler: (() => Promise<void> | void) | null = null;
let sessionExpiryInFlight: Promise<void> | null = null;

export const setSessionExpiredHandler = (handler: (() => Promise<void> | void) | null) => {
  sessionExpiredHandler = handler;
};

const notifySessionExpired = async () => {
  if (!sessionExpiredHandler) return;
  sessionExpiryInFlight ??= Promise.resolve(sessionExpiredHandler()).finally(() => {
    sessionExpiryInFlight = null;
  });
  await sessionExpiryInFlight;
};

const responseBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const parseRetryAfter = (value: string | null) => {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

export async function requestApi<TSchema extends z.ZodType>(
  options: RequestOptions<TSchema>,
): Promise<z.output<TSchema>> {
  const response = await fetch(options.path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const body = await responseBody(response);
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(body);
    const error = new ApiClientError(
      parsed.success ? parsed.data.error.message : "Request failed",
      response.status,
      parsed.success ? parsed.data.error.code : undefined,
      parsed.success ? parsed.data.error.fields : {},
      parsed.success ? parsed.data.requestId : (response.headers.get("x-request-id") ?? undefined),
      parseRetryAfter(response.headers.get("retry-after")),
    );
    if (response.status === 401 && (options.unauthorized ?? "session") === "session") {
      await notifySessionExpired();
    }
    throw error;
  }
  const parsed = options.schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError(
      "Malformed API response",
      response.status,
      "INTERNAL_ERROR",
      {},
      response.headers.get("x-request-id") ?? undefined,
    );
  }
  return parsed.data;
}
