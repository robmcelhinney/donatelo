import { useEffect, useRef, useState } from "react";
import ComparisonCard from "./components/ComparisonCard.jsx";
import InfoPage from "./components/InfoPage.jsx";
import SiteFooter from "./components/SiteFooter.jsx";
import { causes } from "./data.js";
import { buildConfidence, buildResultExplanation, buildShareText, describeAllocationStyle, ratingsToAllocations } from "./ranking.js";
import { EFFECTIVE_GIVING_GUIDE } from "./recommendations.js";
import { applySessionAction, createSession, deleteSession, fetchSession } from "./api.js";
import { clearActiveSessionId, loadActiveSessionId, saveActiveSessionId } from "./storage.js";

const DEFAULT_COMPARE_MORE = 5;

function getSessionIdFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get("session");
}

function getInfoPageFromUrl() {
  const page = new URL(window.location.href).searchParams.get("view");
  return page === "methodology" || page === "privacy" ? page : null;
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

function recalculateSessionAllocations(baseSession, allocationStyle) {
  if (!baseSession) {
    return baseSession;
  }

  const nextAllocationStyle = clampAllocationStyle(allocationStyle);
  const sessionCauses = [...causes, ...(baseSession.customCauses || [])];
  const activeIds = new Set(baseSession.comparisons.flatMap((comparison) => [comparison.leftId, comparison.rightId]));
  const allocations = ratingsToAllocations(sessionCauses, baseSession.ratings, undefined, activeIds, nextAllocationStyle);

  return {
    ...baseSession,
    allocationStyle: nextAllocationStyle,
    allocations,
    confidence: buildConfidence(baseSession.comparisonCount, allocations),
  };
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

function createResultImage(allocations, comparisonCount) {
  const activeAllocations = allocations.filter((item) => item.share > 0);
  const width = 1200;
  const height = 280 + activeAllocations.length * 92;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  context.fillStyle = "#f4f2ec";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#141414";
  context.font = "600 30px Inter, system-ui, sans-serif";
  context.fillText("DONATELO", 72, 72);
  context.font = "700 58px Inter, system-ui, sans-serif";
  context.fillText("My donation allocation", 72, 146);
  context.fillStyle = "#6f6960";
  context.font = "28px Inter, system-ui, sans-serif";
  context.fillText(`Based on ${comparisonCount} comparison${comparisonCount === 1 ? "" : "s"}`, 72, 194);

  activeAllocations.forEach((item, index) => {
    const y = 270 + index * 92;
    context.fillStyle = "#141414";
    context.font = "600 30px Inter, system-ui, sans-serif";
    context.fillText(item.name, 72, y);
    context.textAlign = "right";
    context.fillText(formatPercent(item.share), width - 72, y);
    context.textAlign = "left";
    context.fillStyle = "#ddd7cc";
    context.fillRect(72, y + 20, width - 144, 10);
    context.fillStyle = "#141414";
    context.fillRect(72, y + 20, (width - 144) * (item.share / 100), 10);
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not create result image."));
      }
    }, "image/png");
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState(null);
  const [excludedCauseIds, setExcludedCauseIds] = useState([]);
  const [customCauses, setCustomCauses] = useState([]);
  const [customCauseName, setCustomCauseName] = useState("");
  const [customCauseDescription, setCustomCauseDescription] = useState("");
  const [editingCustomCauseId, setEditingCustomCauseId] = useState(null);
  const [editCustomCauseName, setEditCustomCauseName] = useState("");
  const [editCustomCauseDescription, setEditCustomCauseDescription] = useState("");
  const [editingComparisonId, setEditingComparisonId] = useState(null);
  const [editingComparisonChoice, setEditingComparisonChoice] = useState("left");
  const [infoPage, setInfoPage] = useState(() => getInfoPageFromUrl());
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
        setCustomCauses(Array.isArray(loaded.customCauses) ? loaded.customCauses : []);
        setAllocationStyleDraft(clampAllocationStyle(loaded.allocationStyle ?? 50));
        pendingAllocationStyleRef.current = null;
        currentSessionIdRef.current = loaded.id;
        saveActiveSessionId(loaded.id);
        setSessionIdInUrl(loaded.id);
      } catch {
        if (!alive) {
          return;
        }
        clearActiveSessionId();
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

  useEffect(() => {
    function handlePopState() {
      setInfoPage(getInfoPageFromUrl());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const currentPair = session?.currentPair || null;
  const allCauses = [...causes, ...customCauses];
  const leftCause = currentPair ? allCauses.find((cause) => cause.id === currentPair.leftId) || null : null;
  const rightCause = currentPair ? allCauses.find((cause) => cause.id === currentPair.rightId) || null : null;
  const allocations = session?.allocations || [];
  const confidence = session?.confidence || null;
  const progress = session ? (session.comparisonTarget > 0 ? Math.min(100, (session.comparisonCount / session.comparisonTarget) * 100) : 100) : 0;
  const introExcludedCauseIds = excludedCauseIds;
  const activeIntroCauses = allCauses.filter((cause) => !introExcludedCauseIds.includes(cause.id));
  const activeCauseCount = activeIntroCauses.length;
  const totalPossiblePairs = activeCauseCount < 2 ? 0 : (activeCauseCount * (activeCauseCount - 1)) / 2;
  const comparedPairCount = new Set((session?.comparisons || []).map((comparison) => comparison.pair)).size;
  const canAddMoreComparisons = Boolean(session && session.phase === "results" && comparedPairCount < totalPossiblePairs);
  const allPairsCompared = Boolean(session?.phase === "results" && totalPossiblePairs > 0 && comparedPairCount >= totalPossiblePairs);
  const allocationStyleInfo = describeAllocationStyle(allocationStyleDraft);
  const resultExplanation = session?.phase === "results"
    ? buildResultExplanation({
        allocations,
        comparisons: session.comparisons,
        allocationStyle: session.allocationStyle,
      })
    : [];
  const shareUrl = session ? new URL(window.location.href) : null;

  if (session?.id && shareUrl) {
    shareUrl.searchParams.set("session", session.id);
    shareUrl.searchParams.delete("view");
  }

  async function syncSession(nextSession) {
    setSession(nextSession);
    setEditingComparisonId(null);
    if (nextSession.phase === "intro") {
      setExcludedCauseIds(Array.isArray(nextSession.excludedCauseIds) ? nextSession.excludedCauseIds : []);
    }
    setCustomCauses(Array.isArray(nextSession.customCauses) ? nextSession.customCauses : []);
    const nextStyle = clampAllocationStyle(nextSession.allocationStyle ?? 50);
    setAllocationStyleDraft(nextStyle);
    pendingAllocationStyleRef.current = null;
    currentSessionIdRef.current = nextSession.id;
    saveActiveSessionId(nextSession.id);
    setSessionIdInUrl(nextSession.id);
  }

  async function startFreshSession() {
    setBusyAction("start");
    setError(null);
    try {
      if (session?.id && session.phase === "intro") {
        const resumed = await applySessionAction(session.id, {
          action: "start",
          excludedCauseIds: introExcludedCauseIds,
          customCauses,
          allocationStyle: allocationStyleDraft,
        });
        await syncSession(resumed);
      } else {
        const created = await createSession({
          start: true,
          excludedCauseIds: introExcludedCauseIds,
          customCauses,
          allocationStyle: allocationStyleDraft,
        });
        await syncSession(created);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a new session.");
    } finally {
      setBusyAction(null);
      setLoading(false);
    }
  }

  async function cancelEditing() {
    if (!session?.id || !session.editingReturnPhase) {
      return;
    }

    setBusyAction("resume");
    setError(null);
    try {
      const loaded = await applySessionAction(session.id, { action: "cancel-edit" });
      await syncSession(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resume the session.");
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
        customCauses: session?.customCauses || customCauses,
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
    setSession(null);
    setExcludedCauseIds([]);
    setCustomCauses([]);
    setCustomCauseName("");
    setCustomCauseDescription("");
    setEditingCustomCauseId(null);
    setEditingComparisonId(null);
    setEditingComparisonChoice("left");
    setInfoPage(null);
    setAllocationStyleDraft(50);
    setBusyAction(null);
    setError(null);
    setLoading(false);
    setSessionIdInUrl(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    window.history.replaceState({}, "", url);
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

  async function editCauses() {
    if (!session?.id) {
      return;
    }

    setBusyAction("edit-causes");
    setError(null);
    if (allocationStyleSaveRef.current) {
      window.clearTimeout(allocationStyleSaveRef.current);
      allocationStyleSaveRef.current = null;
    }
    pendingAllocationStyleRef.current = null;
    try {
      const nextSession = await applySessionAction(session.id, {
        action: "edit-causes",
        allocationStyle: allocationStyleDraft,
      });
      await syncSession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not edit the cause list.");
    } finally {
      setBusyAction(null);
    }
  }

  function beginEditingComparison(comparison) {
    setEditingComparisonId(comparison.id);
    setEditingComparisonChoice(comparison.choice);
  }

  function cancelEditingComparison() {
    setEditingComparisonId(null);
  }

  async function saveComparisonEdit() {
    if (!session?.id || !editingComparisonId) {
      return;
    }

    setBusyAction("edit-history");
    setError(null);
    try {
      const nextSession = await applySessionAction(session.id, {
        action: "update-comparison",
        comparisonId: editingComparisonId,
        choice: editingComparisonChoice,
      });
      await syncSession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that answer.");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeComparison(comparisonId) {
    if (!session?.id || !comparisonId) {
      return;
    }

    const confirmed = window.confirm("Remove this answer from the history? Donatelo will replay the remaining answers.");
    if (!confirmed) {
      return;
    }

    setBusyAction("remove-history");
    setError(null);
    try {
      const nextSession = await applySessionAction(session.id, {
        action: "remove-comparison",
        comparisonId,
      });
      await syncSession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that answer.");
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteCurrentSession() {
    if (!session?.id) {
      return;
    }

    const confirmed = window.confirm("Delete this saved session? This will remove it from the server and make the share link stop working.");
    if (!confirmed) {
      return;
    }

    setBusyAction("delete");
    setError(null);
    try {
      await deleteSession(session.id);
      goHome();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the session.");
    } finally {
      setBusyAction(null);
    }
  }

  function toggleCauseExclusion(causeId) {
    setExcludedCauseIds((current) =>
      current.includes(causeId) ? current.filter((id) => id !== causeId) : [...current, causeId],
    );
  }

  function addCustomCause(event) {
    event.preventDefault();
    const name = customCauseName.trim();
    if (!name || customCauses.length >= 5) {
      return;
    }

    setCustomCauses((current) => [
      ...current,
      {
        id: `custom-${crypto.randomUUID()}`,
        name: name.slice(0, 80),
        description: customCauseDescription.trim().slice(0, 240) || "A cause area added by you.",
        category: "custom",
      },
    ]);
    setCustomCauseName("");
    setCustomCauseDescription("");
  }

  function beginEditingCustomCause(cause) {
    setEditingCustomCauseId(cause.id);
    setEditCustomCauseName(cause.name);
    setEditCustomCauseDescription(cause.description === "A cause area added by you." ? "" : cause.description);
  }

  function saveCustomCause(event) {
    event.preventDefault();
    const name = editCustomCauseName.trim();
    if (!editingCustomCauseId || !name) {
      return;
    }

    setCustomCauses((current) => current.map((cause) =>
      cause.id === editingCustomCauseId
        ? {
            ...cause,
            name: name.slice(0, 80),
            description: editCustomCauseDescription.trim().slice(0, 240) || "A cause area added by you.",
          }
        : cause,
    ));
    setEditingCustomCauseId(null);
  }

  function removeCustomCause(causeId) {
    setCustomCauses((current) => current.filter((cause) => cause.id !== causeId));
    setExcludedCauseIds((current) => current.filter((id) => id !== causeId));
    if (editingCustomCauseId === causeId) {
      setEditingCustomCauseId(null);
    }
  }

  function openInfoPage(page) {
    const url = new URL(window.location.href);
    url.searchParams.set("view", page);
    window.history.pushState({}, "", url);
    setInfoPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeInfoPage() {
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    window.history.pushState({}, "", url);
    setInfoPage(null);
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
    let imageFile = null;

    try {
      const imageBlob = await createResultImage(allocations, session.comparisonCount);
      imageFile = new File([imageBlob], "donatelo-results.png", { type: "image/png" });
    } catch {
      // Text and link sharing remain available if image generation fails.
    }

    if (navigator.share) {
      try {
        const shareData = {
          title: "Donatelo results",
          text,
          url: shareLink,
        };
        if (imageFile && navigator.canShare?.({ files: [imageFile] })) {
          shareData.files = [imageFile];
        }
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }
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

  async function downloadResultImage() {
    try {
      const blob = await createResultImage(allocations, session?.comparisonCount || 0);
      downloadBlob(blob, "donatelo-results.png");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the result image.");
    }
  }

  function resetAllocationStyle() {
    updateAllocationStyle(50);
    saveAllocationStyle(50);
  }

  const renderedComparison = session?.phase === "comparing" && leftCause && rightCause;
  const renderedResults = session?.phase === "results";

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

  if (infoPage) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <button type="button" className="brand-link" onClick={closeInfoPage} aria-label="Return to Donatelo">
            <p className="eyebrow">Donatelo</p>
            <h1>Minimal donation ranking.</h1>
          </button>
        </header>
        <InfoPage page={infoPage} onClose={closeInfoPage} />
        <SiteFooter onOpenPage={openInfoPage} />
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
              Drop any causes you do not care about, add an area we missed, then compare the rest two at a time. Donatelo will turn your choices into a donation allocation.
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
            {allCauses.map((cause) => {
              const isDropped = introExcludedCauseIds.includes(cause.id);
              if (cause.category === "custom") {
                const isEditing = editingCustomCauseId === cause.id;
                return (
                  <article key={cause.id} className={`custom-cause-card${isDropped ? " is-dropped" : " is-kept"}`}>
                    {isEditing ? (
                      <form className="custom-cause-card__edit" onSubmit={saveCustomCause}>
                        <label>
                          <span>Area name</span>
                          <input
                            type="text"
                            value={editCustomCauseName}
                            onChange={(event) => setEditCustomCauseName(event.target.value)}
                            maxLength={80}
                            autoFocus
                          />
                        </label>
                        <label>
                          <span>Short description</span>
                          <input
                            type="text"
                            value={editCustomCauseDescription}
                            onChange={(event) => setEditCustomCauseDescription(event.target.value)}
                            maxLength={240}
                          />
                        </label>
                        <div className="custom-cause-card__actions">
                          <button type="submit" disabled={!editCustomCauseName.trim()}>Save</button>
                          <button type="button" onClick={() => setEditingCustomCauseId(null)}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="custom-cause-card__toggle"
                          aria-pressed={isDropped}
                          onClick={() => toggleCauseExclusion(cause.id)}
                        >
                          <span className="cause-toggle__top">
                            <strong>{cause.name}</strong>
                            <span>{isDropped ? "Dropped" : "Will ask"}</span>
                          </span>
                          <span className="cause-toggle__description">{cause.description}</span>
                        </button>
                        <div className="custom-cause-card__actions">
                          <button type="button" onClick={() => beginEditingCustomCause(cause)}>Edit</button>
                          <button type="button" onClick={() => removeCustomCause(cause.id)}>Remove</button>
                        </div>
                      </>
                    )}
                  </article>
                );
              }
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

          <details className="custom-cause-form">
            <summary>
              <span>Missing an area?</span>
              <small>{customCauses.length ? `${customCauses.length} / 5 added` : "Add your own"}</small>
            </summary>
            <form className="custom-cause-form__body" onSubmit={addCustomCause}>
              <div className="custom-cause-form__fields">
                <label>
                  <span>Area name</span>
                  <input
                    type="text"
                    value={customCauseName}
                    onChange={(event) => setCustomCauseName(event.target.value)}
                    placeholder="e.g. Arts and culture"
                    maxLength={80}
                    disabled={customCauses.length >= 5}
                  />
                </label>
                <label>
                  <span>Short description <em>optional</em></span>
                  <input
                    type="text"
                    value={customCauseDescription}
                    onChange={(event) => setCustomCauseDescription(event.target.value)}
                    placeholder="What work does this include?"
                    maxLength={240}
                    disabled={customCauses.length >= 5}
                  />
                </label>
                <button
                  type="submit"
                  className="button button--ghost"
                  disabled={!customCauseName.trim() || customCauses.length >= 5}
                >
                  Add area
                </button>
              </div>
            </form>
          </details>

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
            {session?.editingReturnPhase ? (
              <button type="button" className="button button--ghost" onClick={cancelEditing} disabled={busyAction === "resume"}>
                {busyAction === "resume" ? "Returning…" : "Cancel editing"}
              </button>
            ) : null}
            {session?.id ? (
              <button type="button" className="button button--ghost" onClick={deleteCurrentSession} disabled={busyAction === "delete"}>
                {busyAction === "delete" ? "Deleting…" : "Delete session"}
              </button>
            ) : null}
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
                <p className="comparison-subcopy">Choose a side to continue.</p>
              </div>
              <ComparisonCard
                key={`${leftCause.id}-${rightCause.id}`}
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
                  The split is based on pairwise preferences. Adjust the allocation style if you want it flatter or sharper, or edit the history if you want to change an earlier answer.
                </p>
              </div>

              {resultExplanation.length > 0 ? (
                <section className="results-explanation" aria-label="Why this result">
                  <p className="eyebrow">Why this result?</p>
                  <ul>
                    {resultExplanation.map((item) => (
                      <li key={item.title}>
                        <strong>{item.title}</strong>
                        <span>{item.text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <div className="allocation-style-panel">
                <div className="allocation-style-panel__top">
                  <div>
                    <p className="eyebrow">Allocation style</p>
                    <strong>{allocationStyleInfo.label}</strong>
                  </div>
                  <div className="allocation-style-panel__value">
                    <span>{allocationStyleDraft}%</span>
                    <button type="button" onClick={resetAllocationStyle} disabled={allocationStyleDraft === 50}>Reset</button>
                  </div>
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

              <div className="results-actions results-actions--primary">
                <button type="button" className="button button--primary" onClick={shareResults} disabled={!session.id}>
                  Share results
                </button>
                {canAddMoreComparisons ? (
                  <button type="button" className="button button--ghost" onClick={addMoreComparisons} disabled={busyAction === "more"}>
                    {busyAction === "more" ? "Adding…" : "Add more comparisons"}
                  </button>
                ) : null}
              </div>

              {allPairsCompared ? (
                <p className="all-pairs-note">You’ve already compared every possible pair.</p>
              ) : null}

              <details className="results-more">
                <summary>More actions</summary>
                <div>
                  <button type="button" className="button button--ghost" onClick={undoLastChoice} disabled={!session.comparisons.length || busyAction === "undo"}>
                    {busyAction === "undo" ? "Undoing…" : "Undo last choice"}
                  </button>
                  <button type="button" className="button button--ghost" onClick={editCauses} disabled={busyAction === "edit-causes"}>
                    {busyAction === "edit-causes" ? "Opening…" : "Edit causes"}
                  </button>
                  <button type="button" className="button button--ghost" onClick={deleteCurrentSession} disabled={busyAction === "delete"}>
                    {busyAction === "delete" ? "Deleting…" : "Delete session"}
                  </button>
                  <button type="button" className="button button--ghost" onClick={downloadResultImage}>
                    Download result image
                  </button>
                </div>
              </details>

              <details className="comparison-history">
                <summary>Answer history</summary>
                <div className="comparison-history__body">
                  <p className="comparison-history__note">
                    Edit or remove a prior answer and Donatelo will replay the remaining history from that point.
                  </p>
                  <ol className="comparison-history__list">
                    {session.comparisons.map((comparison, index) => {
                      const left = allCauses.find((cause) => cause.id === comparison.leftId);
                      const right = allCauses.find((cause) => cause.id === comparison.rightId);
                      const isEditing = editingComparisonId === comparison.id;
                      const choiceLabel = comparison.choice === "left"
                        ? left?.name
                        : comparison.choice === "right"
                          ? right?.name
                          : comparison.choice === "tie"
                            ? "Both equally important"
                            : "Skipped";

                      return (
                        <li key={comparison.id} className="comparison-history__item">
                          <div className="comparison-history__meta">
                            <span className="comparison-history__index">{String(index + 1).padStart(2, "0")}</span>
                            <div className="comparison-history__copy">
                              <strong>{left?.name || comparison.leftId} vs {right?.name || comparison.rightId}</strong>
                              <span>{choiceLabel}</span>
                            </div>
                          </div>

                          {isEditing ? (
                            <div className="comparison-history__editor">
                              <label>
                                <span>Change answer</span>
                                <select value={editingComparisonChoice} onChange={(event) => setEditingComparisonChoice(event.target.value)}>
                                  <option value="left">{left?.name || "Left cause"}</option>
                                  <option value="right">{right?.name || "Right cause"}</option>
                                  <option value="tie">Both equally important</option>
                                  <option value="skip">Skip</option>
                                </select>
                              </label>
                              <div className="comparison-history__actions">
                                <button type="button" className="button button--ghost button--small" onClick={saveComparisonEdit} disabled={busyAction === "edit-history"}>
                                  {busyAction === "edit-history" ? "Saving…" : "Save"}
                                </button>
                                <button type="button" className="button button--ghost button--small" onClick={cancelEditingComparison} disabled={busyAction === "edit-history"}>
                                  Cancel
                                </button>
                                <button type="button" className="button button--ghost button--small" onClick={() => removeComparison(comparison.id)} disabled={busyAction === "remove-history"}>
                                  {busyAction === "remove-history" ? "Removing…" : "Remove"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="comparison-history__actions">
                              <button type="button" className="button button--ghost button--small" onClick={() => beginEditingComparison(comparison)}>
                                Edit
                              </button>
                              <button type="button" className="button button--ghost button--small" onClick={() => removeComparison(comparison.id)} disabled={busyAction === "remove-history"}>
                                {busyAction === "remove-history" ? "Removing…" : "Remove"}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </details>

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

              {allocations.some((allocation) => allocation.share > 0) ? (
                <section className="organisation-suggestions" aria-labelledby="organisation-suggestions-title">
                  <div className="organisation-suggestions__heading">
                    <div>
                      <p className="eyebrow">Next step</p>
                      <h2 id="organisation-suggestions-title">Find an effective organisation</h2>
                    </div>
                    <p>Recommendations are maintained independently by Giving What We Can. Check current eligibility and tax status before donating.</p>
                  </div>
                  <a className="button button--ghost organisation-suggestions__link" href={EFFECTIVE_GIVING_GUIDE.url} target="_blank" rel="noreferrer">
                    Browse {EFFECTIVE_GIVING_GUIDE.name} recommendations <span aria-hidden="true">↗</span>
                  </a>
                  <p className="organisation-suggestions__description">{EFFECTIVE_GIVING_GUIDE.description}</p>
                </section>
              ) : null}

              <div className="results-meta">
                <div>
                  <span>Causes kept</span>
                  <strong>{activeCauseCount}</strong>
                </div>
                <div>
                  <span>Comparisons</span>
                  <strong>{session.comparisonCount}</strong>
                </div>
                <div>
                  <span>Allocation style</span>
                  <strong>{allocationStyleInfo.label}</strong>
                </div>
                <div>
                  <span>Result signal</span>
                  <strong>{confidence?.label || "—"} · {confidence?.score?.toFixed?.(1) || "0.0"} / 100</strong>
                </div>
              </div>
            </section>
          ) : null}
        </main>
      ) : null}
      <SiteFooter onOpenPage={openInfoPage} />
    </div>
  );
}
