import { useEffect, useRef, useState } from "react";
import ComparisonCard from "./components/ComparisonCard.jsx";
import { causes } from "./data.js";
import { buildConfidence, buildShareText, ratingsToAllocations } from "./ranking.js";
import { applySessionAction, createSession, fetchSession } from "./api.js";
import { clearActiveSessionId, loadActiveSessionId, saveActiveSessionId } from "./storage.js";

const DEFAULT_COMPARE_MORE = 5;

function getSessionIdFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get("session");
}

function setSessionIdInUrl(sessionId) {
  const url = new URL(window.location.href);
  if (sessionId) {
    url.searchParams.set("session", sessionId);
  } else {
    url.searchParams.delete("session");
  }
  window.history.replaceState({}, "", url);
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoDate));
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function clampAllocationStyle(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 50;
  }

  return Math.min(100, Math.max(0, numeric));
}

function allocationStyleLabel(value) {
  if (value <= 33) {
    return "Balanced";
  }

  if (value >= 67) {
    return "Decisive";
  }

  return "Moderate";
}

function recalculateSessionAllocations(baseSession, allocationStyle) {
  if (!baseSession) {
    return baseSession;
  }

  const nextAllocationStyle = clampAllocationStyle(allocationStyle);
  const activeIds = new Set(baseSession.comparisons.flatMap((comparison) => [comparison.leftId, comparison.rightId]));
  const allocations = ratingsToAllocations(causes, baseSession.ratings, undefined, activeIds, nextAllocationStyle);

  return {
    ...baseSession,
    allocationStyle: nextAllocationStyle,
    allocations,
    confidence: buildConfidence(baseSession.comparisonCount, allocations),
  };
}

function readSavedSessionId() {
  return getSessionIdFromUrl() || loadActiveSessionId();
}

async function copyToClipboard(value) {
  const writeText = navigator.clipboard?.writeText;
  if (!writeText) {
    return false;
  }

  try {
    await writeText.call(navigator.clipboard, value);
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState(null);
  const [savedSessionId, setSavedSessionId] = useState(() => readSavedSessionId());
  const [excludedCauseIds, setExcludedCauseIds] = useState([]);
  const [allocationStyleDraft, setAllocationStyleDraft] = useState(50);
  const allocationStyleSaveRef = useRef(null);
  const pendingAllocationStyleRef = useRef(null);
  const currentSessionIdRef = useRef(null);

  useEffect(() => {
    let alive = true;

    async function bootstrap() {
      const initialSessionId = getSessionIdFromUrl() || loadActiveSessionId();
      if (!initialSessionId) {
        if (alive) {
          setLoading(false);
        }
        return;
      }

      try {
        const loaded = await fetchSession(initialSessionId);
        if (!alive) {
          return;
        }
        setSession(loaded);
        setExcludedCauseIds(Array.isArray(loaded.excludedCauseIds) ? loaded.excludedCauseIds : []);
        setAllocationStyleDraft(clampAllocationStyle(loaded.allocationStyle ?? 50));
        pendingAllocationStyleRef.current = null;
        currentSessionIdRef.current = loaded.id;
        saveActiveSessionId(loaded.id);
        setSavedSessionId(loaded.id);
        setSessionIdInUrl(loaded.id);
      } catch {
        if (!alive) {
          return;
        }
        clearActiveSessionId();
        setSavedSessionId(null);
        setSession(null);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      alive = false;
      if (allocationStyleSaveRef.current) {
        window.clearTimeout(allocationStyleSaveRef.current);
      }
    };
  }, []);

  const currentPair = session?.currentPair || null;
  const leftCause = currentPair ? causes.find((cause) => cause.id === currentPair.leftId) || null : null;
  const rightCause = currentPair ? causes.find((cause) => cause.id === currentPair.rightId) || null : null;
  const allocations = session?.allocations || [];
  const confidence = session?.confidence || null;
  const progress = session ? Math.min(100, (session.comparisonCount / session.comparisonTarget) * 100) : 0;
  const introExcludedCauseIds = excludedCauseIds;
  const activeIntroCauses = causes.filter((cause) => !introExcludedCauseIds.includes(cause.id));
  const activeCauseCount = activeIntroCauses.length;
  const totalPossiblePairs = activeCauseCount < 2 ? 0 : (activeCauseCount * (activeCauseCount - 1)) / 2;
  const canAddMoreComparisons = Boolean(session && session.phase === "results" && session.comparisons.length < totalPossiblePairs);
  const allocationStyleLabelText = allocationStyleLabel(allocationStyleDraft);
  const shareUrl = session ? new URL(window.location.href) : null;

  if (session?.id && shareUrl) {
    shareUrl.searchParams.set("session", session.id);
  }

  async function syncSession(nextSession) {
    setSession(nextSession);
    if (nextSession.phase === "intro") {
      setExcludedCauseIds(Array.isArray(nextSession.excludedCauseIds) ? nextSession.excludedCauseIds : []);
    }
    const nextStyle = clampAllocationStyle(nextSession.allocationStyle ?? 50);
    setAllocationStyleDraft(nextStyle);
    pendingAllocationStyleRef.current = null;
    currentSessionIdRef.current = nextSession.id;
    saveActiveSessionId(nextSession.id);
    setSavedSessionId(nextSession.id);
    setSessionIdInUrl(nextSession.id);
  }

  async function startFreshSession() {
    setBusyAction("start");
    setError(null);
    try {
      const created = await createSession({
        start: true,
        excludedCauseIds: introExcludedCauseIds,
        allocationStyle: allocationStyleDraft,
      });
      await syncSession(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a new session.");
    } finally {
      setBusyAction(null);
      setLoading(false);
    }
  }

  async function resumeSavedSession() {
    if (!savedSessionId) {
      return;
    }

    setBusyAction("resume");
    setError(null);
    try {
      const loaded = await fetchSession(savedSessionId);
      await syncSession(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resume the session.");
      clearActiveSessionId();
      setSavedSessionId(null);
    } finally {
      setBusyAction(null);
      setLoading(false);
    }
  }

  async function restart() {
    setBusyAction("restart");
    setError(null);
    try {
      const created = await createSession({
        start: true,
        excludedCauseIds: session?.excludedCauseIds || introExcludedCauseIds,
        allocationStyle: session?.allocationStyle ?? allocationStyleDraft,
      });
      await syncSession(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restart the session.");
    } finally {
      setBusyAction(null);
    }
  }

  function goHome() {
    clearActiveSessionId();
    setSavedSessionId(null);
    setSession(null);
    setExcludedCauseIds([]);
    setAllocationStyleDraft(50);
    setBusyAction(null);
    setError(null);
    setLoading(false);
    setSessionIdInUrl(null);
    currentSessionIdRef.current = null;
    pendingAllocationStyleRef.current = null;
    if (allocationStyleSaveRef.current) {
      window.clearTimeout(allocationStyleSaveRef.current);
      allocationStyleSaveRef.current = null;
    }
  }

  async function recordChoice(choice) {
    if (!session?.id || busyAction) {
      return;
    }

    setBusyAction("choice");
    setError(null);
    try {
      const nextSession = await applySessionAction(session.id, {
        action: "choice",
        choice,
      });
      await syncSession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that choice.");
    } finally {
      setBusyAction(null);
    }
  }

  async function addMoreComparisons() {
    if (!session?.id) {
      return;
    }

    setBusyAction("more");
    setError(null);
    try {
      const nextSession = await applySessionAction(session.id, {
        action: "more",
        extraComparisons: DEFAULT_COMPARE_MORE,
      });
      await syncSession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not extend the session.");
    } finally {
      setBusyAction(null);
    }
  }

  async function finishEarly() {
    if (!session?.id) {
      return;
    }

    setBusyAction("finish");
    setError(null);
    try {
      const nextSession = await applySessionAction(session.id, {
        action: "finish",
      });
      await syncSession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish the session.");
    } finally {
      setBusyAction(null);
    }
  }

  async function undoLastChoice() {
    if (!session?.id || !session.comparisons.length) {
      return;
    }

    setBusyAction("undo");
    setError(null);
    try {
      const nextSession = await applySessionAction(session.id, {
        action: "undo",
      });
      await syncSession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo the last choice.");
    } finally {
      setBusyAction(null);
    }
  }

  function toggleCauseExclusion(causeId) {
    setExcludedCauseIds((current) =>
      current.includes(causeId) ? current.filter((id) => id !== causeId) : [...current, causeId],
    );
  }

  function updateAllocationStyle(nextStyle) {
    const normalizedStyle = clampAllocationStyle(nextStyle);
    setAllocationStyleDraft(normalizedStyle);
    setSession((currentSession) => recalculateSessionAllocations(currentSession, normalizedStyle));
  }

  async function saveAllocationStyle(nextStyle = allocationStyleDraft) {
    if (!session?.id || session.phase !== "results") {
      return;
    }

    const normalizedStyle = clampAllocationStyle(nextStyle);

    if (pendingAllocationStyleRef.current === normalizedStyle && allocationStyleSaveRef.current) {
      return;
    }

    if (allocationStyleSaveRef.current) {
      window.clearTimeout(allocationStyleSaveRef.current);
    }

    const sessionId = session.id;
    currentSessionIdRef.current = sessionId;
    pendingAllocationStyleRef.current = normalizedStyle;
    allocationStyleSaveRef.current = window.setTimeout(async () => {
      try {
        const nextSession = await applySessionAction(sessionId, {
          action: "allocation-style",
          allocationStyle: normalizedStyle,
        });
        if (currentSessionIdRef.current !== sessionId) {
          pendingAllocationStyleRef.current = null;
          return;
        }
        await syncSession(nextSession);
        pendingAllocationStyleRef.current = null;
      } catch (err) {
        pendingAllocationStyleRef.current = null;
        setError(err instanceof Error ? err.message : "Could not update the allocation style.");
      }
    }, 160);
  }

  async function shareResults() {
    if (!session || !shareUrl) {
      return;
    }

    const text = buildShareText({
      allocations,
      comparisonCount: session.comparisonCount,
    });
    const shareLink = shareUrl.toString();

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Donatelo results",
          text,
          url: shareLink,
        });
        return;
      } catch {
        // fall through to clipboard
      }
    }

    const copiedText = `${text}\n${shareLink}`;
    const copied = await copyToClipboard(copiedText);
    if (!copied) {
      window.alert(copiedText);
      return;
    }
    window.alert("Share link copied.");
  }

  async function copyShareLink() {
    if (!shareUrl) {
      return;
    }

    const copied = await copyToClipboard(shareUrl.toString());
    if (!copied) {
      window.alert(shareUrl.toString());
      return;
    }
    window.alert("Share link copied.");
  }

  const renderedComparison = session?.phase === "comparing" && leftCause && rightCause;
  const renderedResults = session?.phase === "results";
  const canResume = Boolean(savedSessionId);

  if (loading && !session && !error) {
    return (
      <div className="app-shell">
        <div className="panel center-panel">
          <p className="eyebrow">Donatelo</p>
          <h1>Loading session…</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button type="button" className="brand-link" onClick={goHome} aria-label="Go to homepage">
          <p className="eyebrow">Donatelo</p>
          <h1>Minimal donation ranking.</h1>
        </button>
        {session?.phase !== "intro" ? (
          <button type="button" className="button button--ghost" onClick={restart} disabled={busyAction === "restart"}>
            {busyAction === "restart" ? "Restarting…" : "Restart"}
          </button>
        ) : null}
      </header>

      {error ? (
        <div className="inline-banner" role="status">
          {error}
        </div>
      ) : null}

      {!session || session.phase === "intro" ? (
        <main className="panel intro-panel">
          <div className="intro-copy">
            <p className="lede">
              Drop any causes you do not care about, then compare the rest two at a time. Swipe or tap which one matters more, and Donatelo will turn your choices into a donation allocation.
            </p>
            <p className="intro-note">
              You will be asked about {activeCauseCount} causes, so the number of comparisons scales with the set you keep.
            </p>
          </div>

          <div className="intro-summary">
            <span>{activeIntroCauses.length} kept</span>
            <span>{introExcludedCauseIds.length} dropped</span>
          </div>

          <div className="cause-toggle-grid" aria-label="Choose causes to drop">
            {causes.map((cause) => {
              const isDropped = introExcludedCauseIds.includes(cause.id);
              return (
                <button
                  key={cause.id}
                  type="button"
                  className={`cause-toggle${isDropped ? " is-dropped" : " is-kept"}`}
                  aria-pressed={isDropped}
                  onClick={() => toggleCauseExclusion(cause.id)}
                >
                  <span className="cause-toggle__top">
                    <strong>{cause.name}</strong>
                    <span>{isDropped ? "Dropped" : "Will ask"}</span>
                  </span>
                  <span className="cause-toggle__description">{cause.description}</span>
                </button>
              );
            })}
          </div>

          <div className="intro-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={startFreshSession}
              disabled={busyAction === "start" || activeIntroCauses.length === 0}
            >
              {busyAction === "start"
                ? "Starting…"
                : activeIntroCauses.length <= 1
                  ? "Show result"
                  : "Start ranking"}
            </button>
            <button type="button" className="button button--ghost" onClick={resumeSavedSession} disabled={!canResume || busyAction === "resume"}>
              {busyAction === "resume" ? "Resuming…" : "Resume session"}
            </button>
          </div>
          {activeIntroCauses.length === 0 ? (
            <p className="intro-note">Keep at least one cause to continue.</p>
          ) : activeIntroCauses.length === 1 ? (
            <p className="intro-note">With one cause left, Donatelo will give it the full allocation.</p>
          ) : null}
        </main>
      ) : null}

      {session && session.phase !== "intro" ? (
        <main className="content-grid">
          <section className="panel status-panel">
            <div className="status-row">
              <div>
                <p className="eyebrow">Progress</p>
                <p className="status-value">
                  {session.comparisonCount} / {session.comparisonTarget}
                </p>
              </div>
              <div className="status-meta">
                <span>Confidence</span>
                <strong>{confidence?.label || "—"}</strong>
              </div>
            </div>
            <div className="progress-track" aria-hidden="true">
              <span className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="status-note">{confidence?.description || "Keep going to sharpen the split."}</p>
            <p className="status-note status-note--subtle">
              This session is sized for {activeCauseCount} kept causes.
            </p>
          </section>

          {renderedComparison ? (
            <section className="panel comparison-panel">
              <div className="comparison-heading">
                <p className="eyebrow">Comparison</p>
                <h2>Which cause matters more to you?</h2>
                <p className="comparison-subcopy">Swipe the card, or tap a side.</p>
              </div>
              <ComparisonCard
                leftCause={leftCause}
                rightCause={rightCause}
                onChoose={recordChoice}
                disabled={Boolean(busyAction)}
              />
              <div className="comparison-footer">
                <button type="button" className="button button--ghost" onClick={undoLastChoice} disabled={!session.comparisons.length || busyAction === "undo"}>
                  {busyAction === "undo" ? "Undoing…" : "Undo last choice"}
                </button>
                <button type="button" className="button button--ghost" onClick={finishEarly} disabled={busyAction === "finish"}>
                  {busyAction === "finish" ? "Finishing…" : "Finish early"}
                </button>
              </div>
            </section>
          ) : null}

          {renderedResults ? (
            <section className="panel results-panel">
              <div className="results-heading">
                <p className="eyebrow">Results</p>
                <h2>Your donation allocation</h2>
                <p className="lede">
                  The split is based on pairwise preferences. Adjust the allocation style if you want it flatter or sharper.
                </p>
              </div>

              <div className="allocation-style-panel">
                <div className="allocation-style-panel__top">
                  <div>
                    <p className="eyebrow">Allocation style</p>
                    <strong>{allocationStyleLabelText}</strong>
                  </div>
                  <span>{allocationStyleDraft}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={allocationStyleDraft}
                  onChange={(event) => updateAllocationStyle(event.target.value)}
                  onPointerUp={() => saveAllocationStyle()}
                  onBlur={() => saveAllocationStyle()}
                  aria-label="Allocation style"
                />
                <div className="allocation-style-panel__scale" aria-hidden="true">
                  <span>Balanced</span>
                  <span>Decisive</span>
                </div>
              </div>

              <div className="results-actions">
                <button type="button" className="button button--ghost" onClick={undoLastChoice} disabled={!session.comparisons.length || busyAction === "undo"}>
                  {busyAction === "undo" ? "Undoing…" : "Undo last choice"}
                </button>
                {canAddMoreComparisons ? (
                  <button type="button" className="button button--primary" onClick={addMoreComparisons} disabled={busyAction === "more"}>
                    {busyAction === "more" ? "Adding…" : "Add 5 more comparisons"}
                  </button>
                ) : null}
                <button type="button" className="button button--ghost" onClick={shareResults} disabled={!session.id}>
                  Share results
                </button>
                <button type="button" className="button button--ghost" onClick={copyShareLink} disabled={!shareUrl}>
                  Copy link
                </button>
              </div>

              <div className="share-box">
                <span>Shareable link</span>
                <code>{shareUrl?.toString() || ""}</code>
              </div>

              <ol className="results-list">
                {allocations.map((item, index) => (
                  <li key={item.id} className="result-row">
                    <div className="result-row__top">
                      <span className="result-row__rank">{String(index + 1).padStart(2, "0")}</span>
                      <div className="result-row__copy">
                        <strong>{item.name}</strong>
                        <span>{item.description}</span>
                      </div>
                      <strong className="result-row__share">{formatPercent(item.share)}</strong>
                    </div>
                    <div className="result-row__bar" aria-hidden="true">
                      <span style={{ width: `${item.share}%` }} />
                    </div>
                  </li>
                ))}
              </ol>

              <div className="results-meta">
                <div>
                  <span>Comparisons</span>
                  <strong>{session.comparisonCount}</strong>
                </div>
                <div>
                  <span>Completed</span>
                  <strong>{session.completedAt ? formatDate(session.completedAt) : "—"}</strong>
                </div>
                <div>
                  <span>Confidence</span>
                  <strong>{confidence?.score?.toFixed?.(1) || "0.0"} / 100</strong>
                </div>
              </div>
            </section>
          ) : null}
        </main>
      ) : null}
    </div>
  );
}
