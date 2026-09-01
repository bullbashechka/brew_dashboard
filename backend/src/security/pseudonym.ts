import type { WorkerBindings } from "../http/types.ts";

const FALLBACK_SECRET = "brew-dashboard-local-observability-key";

const secretFor = (environment?: WorkerBindings) =>
  environment?.LOG_PSEUDONYM_SECRET ?? environment?.BETTER_AUTH_SECRET ?? FALLBACK_SECRET;

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

/** Return a short keyed identifier suitable for logs without exposing account or tenant UUIDs. */
export const pseudonymize = async (
  value: string,
  environment?: WorkerBindings,
  namespace = "id",
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretFor(environment)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${namespace}:${value}`),
  );
  return toBase64Url(signature).slice(0, 22);
};

export const __test = { secretFor, toBase64Url };
