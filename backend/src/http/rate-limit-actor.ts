import type { WorkerBindings } from "./types.ts";

type DurableBucket = {
  count: number;
  windowStartedAt: number;
};

type ConsumeRequest = {
  key: string;
  windowSeconds: number;
  max: number;
  nowMs?: number;
};

type ConsumeResponse = {
  allowed: boolean;
  retryAfter: number | null;
};

const MAX_KEY_LENGTH = 160;
const MAX_BUCKETS_PER_ACTOR = 50_000;
const MAX_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const MAX_REQUESTS_PER_WINDOW = 100_000;
const BUCKET_COUNT_KEY = "meta:bucket-count";
const CLEANUP_BATCH_SIZE = 100;

const validConsumeRequest = (value: unknown): value is ConsumeRequest => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConsumeRequest>;
  const windowSeconds = candidate.windowSeconds;
  const max = candidate.max;
  return (
    typeof candidate.key === "string" &&
    candidate.key.length > 0 &&
    candidate.key.length <= MAX_KEY_LENGTH &&
    typeof windowSeconds === "number" &&
    Number.isSafeInteger(windowSeconds) &&
    windowSeconds > 0 &&
    windowSeconds <= MAX_WINDOW_SECONDS &&
    typeof max === "number" &&
    Number.isSafeInteger(max) &&
    max > 0 &&
    max <= MAX_REQUESTS_PER_WINDOW &&
    (candidate.nowMs === undefined ||
      (Number.isSafeInteger(candidate.nowMs) && candidate.nowMs >= 0))
  );
};

/** One strongly-consistent actor serializes fixed-window counters for a shard. */
export class RateLimitActor {
  constructor(
    private readonly state: DurableObjectState,
    environment: WorkerBindings,
  ) {
    void environment;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const input = await request.json().catch(() => null);
    if (!validConsumeRequest(input)) return new Response("Bad Request", { status: 400 });

    const result = await this.state.blockConcurrencyWhile(async () => {
      const nowMs = input.nowMs ?? Date.now();
      const storageKey = `bucket:${input.key}`;
      const existing = await this.state.storage.get<DurableBucket>(storageKey);
      const windowMs = input.windowSeconds * 1000;
      if (!existing || nowMs - existing.windowStartedAt >= windowMs) {
        await this.state.storage.put(storageKey, { count: 1, windowStartedAt: nowMs });
        if (!existing) {
          const bucketCount = await this.state.storage.get<number>(BUCKET_COUNT_KEY);
          const currentBucketCount =
            typeof bucketCount === "number" && Number.isSafeInteger(bucketCount) ? bucketCount : 0;
          await this.state.storage.put(BUCKET_COUNT_KEY, Math.max(0, currentBucketCount + 1));
        }
        const response = { allowed: true, retryAfter: null } satisfies ConsumeResponse;
        await this.cleanupIfOverCapacity(nowMs, storageKey);
        return response;
      }
      if (existing.count >= input.max) {
        const response = {
          allowed: false,
          retryAfter: Math.max(
            1,
            Math.ceil((windowMs - (nowMs - existing.windowStartedAt)) / 1000),
          ),
        } satisfies ConsumeResponse;
        await this.cleanupIfOverCapacity(nowMs, storageKey);
        return response;
      }
      await this.state.storage.put(storageKey, {
        count: existing.count + 1,
        windowStartedAt: existing.windowStartedAt,
      });
      const response = { allowed: true, retryAfter: null } satisfies ConsumeResponse;
      await this.cleanupIfOverCapacity(nowMs, storageKey);
      return response;
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  }

  private async cleanupIfOverCapacity(nowMs: number, currentKey: string) {
    try {
      const bucketCount = await this.state.storage.get<number>(BUCKET_COUNT_KEY);
      if (
        typeof bucketCount !== "number" ||
        !Number.isSafeInteger(bucketCount) ||
        bucketCount <= MAX_BUCKETS_PER_ACTOR
      )
        return;

      // The count is maintained inside blockConcurrencyWhile. Scan only a bounded batch so an
      // attacker cannot turn cleanup into an unbounded request. Prefer expired buckets; if none
      // exist, evict a few arbitrary non-current buckets to restore the cardinality limit.
      const listed = await this.state.storage.list<DurableBucket>({
        prefix: "bucket:",
        limit: CLEANUP_BATCH_SIZE + 1,
      });
      const cutoff = nowMs - 24 * 60 * 60 * 1000;
      const candidates = [...listed.entries()].filter(([key]) => key !== currentKey);
      const stale = candidates.filter(([, bucket]) => bucket.windowStartedAt < cutoff);
      const victims = (stale.length ? stale : candidates).slice(0, CLEANUP_BATCH_SIZE);
      if (!victims.length) return;
      await Promise.all(victims.map(([key]) => this.state.storage.delete(key)));
      await this.state.storage.put(BUCKET_COUNT_KEY, Math.max(0, bucketCount - victims.length));
    } catch {
      // Limiting is the security decision; cleanup must never turn a valid request into a 5xx.
    }
  }
}

export type RateLimitActorResult =
  { status: "ok"; result: ConsumeResponse } | { status: "unavailable"; error: unknown };

const actorNameFor = (secret: string, key: string) => {
  // The key is already a keyed HMAC. A short prefix provides bounded sharding without exposing
  // the source IP, login, or user id in the Durable Object name.
  let hash = 0;
  for (const character of `${secret}\u0000${key}`)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `rate-limit-shard-${hash % 32}`;
};

export const consumeDurableRateLimit = async (
  namespace: DurableObjectNamespace | undefined,
  secret: string,
  key: string,
  windowSeconds: number,
  max: number,
  nowMs = Date.now(),
): Promise<RateLimitActorResult> => {
  if (!namespace)
    return { status: "unavailable", error: new Error("Rate-limit binding unavailable") };
  try {
    const id = namespace.idFromName(actorNameFor(secret, key));
    const stub = namespace.get(id);
    const response = await stub.fetch("https://rate-limit-actor/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, windowSeconds, max, nowMs }),
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) throw new Error(`Rate-limit actor returned HTTP ${response.status}`);
    const result = (await response.json()) as ConsumeResponse;
    if (typeof result.allowed !== "boolean") throw new Error("Rate-limit actor response malformed");
    return { status: "ok", result };
  } catch (error) {
    return { status: "unavailable", error };
  }
};

export const __test = { actorNameFor, validConsumeRequest, MAX_BUCKETS_PER_ACTOR };
