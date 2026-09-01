const baseUrlValue = process.env.RELEASE_LOAD_BASE_URL;
const allowedHost = process.env.RELEASE_LOAD_ALLOW_HOST;

if (!baseUrlValue) {
  throw new Error("RELEASE_LOAD_BASE_URL is required");
}

const baseUrl = new URL(baseUrlValue);
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
if (!localHosts.has(baseUrl.hostname) && baseUrl.hostname !== allowedHost) {
  throw new Error(
    "Refusing to target a non-local host without an exact RELEASE_LOAD_ALLOW_HOST allowlist",
  );
}

const positiveInteger = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`);
  return value;
};

const durationSeconds = positiveInteger("RELEASE_LOAD_DURATION_SECONDS", 600);
const publicRequestsPerSecond = positiveInteger("RELEASE_LOAD_PUBLIC_RPS", 4);
const publicBurstRequestsPerSecond = positiveInteger("RELEASE_LOAD_PUBLIC_BURST_RPS", 16);
const authenticatedRequestsPerSecond = positiveInteger("RELEASE_LOAD_AUTHENTICATED_RPS", 10);
const concurrentAuthenticatedUsers = positiveInteger(
  "RELEASE_LOAD_CONCURRENT_AUTHENTICATED_USERS",
  10,
);
const cookies = JSON.parse(process.env.RELEASE_LOAD_SESSION_COOKIES ?? "[]");
if (!Array.isArray(cookies) || !cookies.every((cookie) => typeof cookie === "string" && cookie)) {
  throw new Error("RELEASE_LOAD_SESSION_COOKIES must be a JSON array of non-empty cookie headers");
}
if (cookies.length > 0 && cookies.length < concurrentAuthenticatedUsers) {
  throw new Error(
    `Provide at least ${concurrentAuthenticatedUsers} session cookies for the concurrent-user gate`,
  );
}

const durations = [];
const routeDurations = new Map();
let unexpectedFailures = 0;
let requestCount = 0;

const request = async (path, cookie) => {
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL(path, baseUrl), {
      headers: cookie ? { cookie } : undefined,
    });
    if (response.status < 200 || response.status >= 300) unexpectedFailures += 1;
  } catch {
    unexpectedFailures += 1;
  } finally {
    const duration = performance.now() - startedAt;
    durations.push(duration);
    const values = routeDurations.get(path) ?? [];
    values.push(duration);
    routeDurations.set(path, values);
    requestCount += 1;
  }
};

const percentile = (values, percent) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1)];
};

const scheduleRequests = async (rate, seconds, createRequest) => {
  const intervalMs = 1000 / rate;
  const pending = [];
  const endAt = Date.now() + seconds * 1000;
  let nextAt = Date.now();
  while (nextAt < endAt) {
    const delay = nextAt - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    pending.push(createRequest());
    nextAt += intervalMs;
  }
  await Promise.all(pending);
};

const publicPhaseSeconds = Math.max(1, durationSeconds - 60);
const publicLoad = (async () => {
  await scheduleRequests(publicRequestsPerSecond, publicPhaseSeconds, () => request("/"));
  await scheduleRequests(publicBurstRequestsPerSecond, 60, () => request("/"));
})();
const authenticatedLoad = cookies.length
  ? (async () => {
      await Promise.all(
        cookies
          .slice(0, concurrentAuthenticatedUsers)
          .map((cookie) => request("/api/v1/overview?period=today", cookie)),
      );
      let cookieIndex = 0;
      let routeIndex = 0;
      const routes = [
        "/api/v1/auth/me",
        "/api/v1/overview?period=today",
        "/api/v1/locations?period=today",
      ];
      await scheduleRequests(authenticatedRequestsPerSecond, durationSeconds, () => {
        const cookie = cookies[cookieIndex % cookies.length];
        cookieIndex += 1;
        const route = routes[routeIndex % routes.length];
        routeIndex += 1;
        return request(route, cookie);
      });
    })()
  : Promise.resolve();
await Promise.all([publicLoad, authenticatedLoad]);

const p95 = percentile(durations, 0.95);
const failureRate = requestCount ? unexpectedFailures / requestCount : 1;
const routeP95Ms = Object.fromEntries(
  [...routeDurations.entries()].map(([path, values]) => [
    path,
    Math.round(percentile(values, 0.95)),
  ]),
);
console.log(
  JSON.stringify({
    event: "release_load_completed.v1",
    target: baseUrl.origin,
    requests: requestCount,
    p95Ms: Math.round(p95),
    routeP95Ms,
    unexpectedResponsesOrNetworkFailures: unexpectedFailures,
    failureRate,
    authenticatedLoadIncluded: Boolean(cookies.length),
    concurrentAuthenticatedUsers: cookies.length ? concurrentAuthenticatedUsers : 0,
  }),
);

if (p95 > 750 || Object.values(routeP95Ms).some((value) => value > 750) || failureRate > 0) {
  throw new Error("Release load acceptance criteria were not met");
}
