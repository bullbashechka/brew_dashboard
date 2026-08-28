import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type MemoryRateLimitInput = {
  key: string;
  windowSeconds: number;
  max: number;
  nowMs?: number;
};

export type MemoryRateLimitResult = {
  allowed: boolean;
  retryAfter: number | null;
};

type MemoryRateLimitEntry = {
  count: number;
  windowStartedAt: number;
  lastSeenAt: number;
};

const MAX_MEMORY_RATE_LIMIT_ENTRIES = 50_000;
const MEMORY_RATE_LIMIT_SWEEP_INTERVAL = 256;
const MEMORY_RATE_LIMIT_EVICTION_COUNT = Math.ceil(MAX_MEMORY_RATE_LIMIT_ENTRIES * 0.1);

const entries = new Map<string, MemoryRateLimitEntry>();
let operationCount = 0;

const hmac = (secret: string, namespace: string, value: string) =>
  createHmac("sha256", secret).update(`${namespace}\u0000${value}`).digest("hex");

export const rateLimitKey = (secret: string, namespace: string, value: string) =>
  `brew-dashboard:${namespace}:${hmac(secret, namespace, value)}`;

export const trustedClientIp = (value: string | undefined) =>
  value && isIP(value) ? value : "unknown";

const removeExpiredEntries = (nowMs: number) => {
  for (const [key, entry] of entries) {
    if (entry.windowStartedAt <= nowMs - 24 * 60 * 60 * 1000) entries.delete(key);
  }
};

const enforceCapacity = (nowMs: number) => {
  if (entries.size < MAX_MEMORY_RATE_LIMIT_ENTRIES) return;
  removeExpiredEntries(nowMs);
  if (entries.size < MAX_MEMORY_RATE_LIMIT_ENTRIES) return;

  let removed = 0;
  for (const key of entries.keys()) {
    entries.delete(key);
    removed += 1;
    if (removed >= MEMORY_RATE_LIMIT_EVICTION_COUNT) break;
  }
};

export const consumeMemoryFixedWindow = ({
  key,
  windowSeconds,
  max,
  nowMs = Date.now(),
}: MemoryRateLimitInput): MemoryRateLimitResult => {
  operationCount += 1;
  if (operationCount % MEMORY_RATE_LIMIT_SWEEP_INTERVAL === 0) removeExpiredEntries(nowMs);

  const windowMs = windowSeconds * 1000;
  const existing = entries.get(key);
  if (!existing || nowMs - existing.windowStartedAt >= windowMs) {
    enforceCapacity(nowMs);
    entries.set(key, { count: 1, windowStartedAt: nowMs, lastSeenAt: nowMs });
    return { allowed: true, retryAfter: null };
  }

  existing.lastSeenAt = nowMs;
  entries.delete(key);
  entries.set(key, existing);
  if (existing.count >= max) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((windowMs - (nowMs - existing.windowStartedAt)) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfter: null };
};

export const __test = {
  clear: () => {
    entries.clear();
    operationCount = 0;
  },
  entryCount: () => entries.size,
  maxEntries: MAX_MEMORY_RATE_LIMIT_ENTRIES,
};
