const ACTIVE_SESSION_KEY = "donatelo.activeSessionId.v1";

export function loadActiveSessionId() {
  try {
    return window.localStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

export function saveActiveSessionId(sessionId) {
  try {
    if (sessionId) {
      window.localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    } else {
      window.localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

export function clearActiveSessionId() {
  saveActiveSessionId(null);
}
