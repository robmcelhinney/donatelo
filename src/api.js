async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function fetchSession(sessionId) {
  return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export function createSession({ start = false, excludedCauseIds = [], allocationStyle = 50 } = {}) {
  return requestJson("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ start, excludedCauseIds, allocationStyle }),
  });
}

export function applySessionAction(sessionId, payload) {
  return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/actions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchCauses() {
  return requestJson("/api/causes");
}
