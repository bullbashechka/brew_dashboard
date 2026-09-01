const LOGOUT_LOCK_KEY = "brew-dashboard:logout-lock";
const LOGOUT_LOCK_TTL_MS = 60_000;
const channelName = "brew-dashboard-session";

export type SessionBoundaryEvent = { type: "logout-start"; at: number };

const getStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    // localStorage is shared by same-origin tabs, so two tabs cannot normally start duplicate
    // logout mutations. Fall back to sessionStorage when storage is disabled by the browser.
    return window.localStorage;
  } catch {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
};

const getChannel = () => {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(channelName);
};

/** Acquire a short-lived cross-tab logout lock before sending the mutation. */
export const acquireLogoutLock = () => {
  const storage = getStorage();
  if (!storage) return true;
  try {
    const current = Number(storage.getItem(LOGOUT_LOCK_KEY));
    if (Number.isFinite(current) && Date.now() - current < LOGOUT_LOCK_TTL_MS) return false;
    storage.setItem(LOGOUT_LOCK_KEY, String(Date.now()));
  } catch {
    // A quota/private-mode failure must not strand the user in an authenticated tab.
  }
  return true;
};

export const releaseLogoutLock = () => {
  try {
    getStorage()?.removeItem(LOGOUT_LOCK_KEY);
  } catch {
    // Storage cleanup is best effort after the server-side logout has settled.
  }
};

export const announceLogout = () => {
  const channel = getChannel();
  if (!channel) return;
  channel.postMessage({ type: "logout-start", at: Date.now() } satisfies SessionBoundaryEvent);
  channel.close();
};

export const subscribeSessionBoundary = (handler: (event: SessionBoundaryEvent) => void) => {
  if (typeof window === "undefined") return () => {};
  const channel = getChannel();
  let lastLogoutAt = 0;
  const notify = (event: SessionBoundaryEvent) => {
    if (!Number.isFinite(event.at) || event.at <= lastLogoutAt) return;
    lastLogoutAt = event.at;
    handler(event);
  };
  const onMessage = (event: MessageEvent<SessionBoundaryEvent>) => {
    if (event.data?.type === "logout-start") notify(event.data);
  };
  channel?.addEventListener("message", onMessage);

  // BroadcastChannel is unavailable in some embedded/older browsers. A localStorage write emits
  // the same-origin `storage` event in every other tab, preserving the session boundary there.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LOGOUT_LOCK_KEY || !event.newValue) return;
    const at = Number(event.newValue);
    if (Number.isFinite(at)) notify({ type: "logout-start", at });
  };
  window.addEventListener("storage", onStorage);

  return () => {
    channel?.removeEventListener("message", onMessage);
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
};

export const __test = { LOGOUT_LOCK_KEY, LOGOUT_LOCK_TTL_MS };
