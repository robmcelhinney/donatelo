import { useEffect, useMemo, useRef, useState } from "react";

const SWIPE_THRESHOLD = 96;
const EXIT_DISTANCE = 460;
const SPRING = 0.14;
const FRICTION = 0.78;
const RELEASE_DELAY = 140;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizePointer(event) {
  return {
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
  };
}

export default function ComparisonCard({ leftCause, rightCause, onChoose, disabled = false }) {
  const [visual, setVisual] = useState({ x: 0, y: 0 });
  const targetRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const pointerRef = useRef(null);
  const draggingRef = useRef(false);
  const pointerMovedRef = useRef(false);
  const commitLockRef = useRef(false);
  const clickSuppressedRef = useRef(false);
  const scheduleCommitRef = useRef(null);
  const resetDragRef = useRef(null);
  const timeoutRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    targetRef.current = { x: 0, y: 0 };
    currentRef.current = { x: 0, y: 0 };
    velocityRef.current = { x: 0, y: 0 };
    pointerRef.current = null;
    draggingRef.current = false;
    pointerMovedRef.current = false;
    commitLockRef.current = false;
    clickSuppressedRef.current = false;
    setVisual({ x: 0, y: 0 });
  }, [leftCause.id, rightCause.id]);

  useEffect(() => {
    scheduleCommitRef.current = scheduleCommit;
    resetDragRef.current = resetDrag;
  });

  useEffect(() => {
    const animate = () => {
      const target = targetRef.current;
      const current = currentRef.current;
      const velocity = velocityRef.current;

      const deltaX = target.x - current.x;
      const deltaY = target.y - current.y;

      velocity.x = (velocity.x + deltaX * SPRING) * FRICTION;
      velocity.y = (velocity.y + deltaY * SPRING) * FRICTION;

      current.x += velocity.x;
      current.y += velocity.y;

      const settled =
        Math.abs(deltaX) < 0.1 &&
        Math.abs(deltaY) < 0.1 &&
        Math.abs(velocity.x) < 0.1 &&
        Math.abs(velocity.y) < 0.1;

      if (!draggingRef.current && settled) {
        current.x = target.x;
        current.y = target.y;
        velocity.x = 0;
        velocity.y = 0;
      }

      setVisual({ x: current.x, y: current.y });
      rafRef.current = window.requestAnimationFrame(animate);
    };

    rafRef.current = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    function handleWindowPointerMove(event) {
      if (disabled || !pointerRef.current || pointerRef.current.pointerId !== event.pointerId) {
        return;
      }

      const now = normalizePointer(event);
      const deltaX = now.x - pointerRef.current.origin.x;
      const deltaY = now.y - pointerRef.current.origin.y;

      if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
        pointerMovedRef.current = true;
      }

      targetRef.current = {
        x: deltaX,
        y: deltaY * 0.16,
      };
    }

    function handleWindowPointerUp(event) {
      if (disabled || !pointerRef.current || pointerRef.current.pointerId !== event.pointerId) {
        return;
      }

      const current = normalizePointer(event);
      const origin = pointerRef.current.origin;
      const deltaX = current.x - origin.x;
      const deltaY = current.y - origin.y;
      const elapsed = Math.max(current.time - origin.time, 1);
      const velocity = Math.abs(deltaX) / elapsed;
      const horizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.1;
      const strongEnough = Math.abs(deltaX) > SWIPE_THRESHOLD || velocity > 0.8;

      draggingRef.current = false;

      if (horizontal && strongEnough) {
        clickSuppressedRef.current = true;
        scheduleCommitRef.current?.(deltaX > 0 ? "right" : "left");
        window.setTimeout(() => {
          clickSuppressedRef.current = false;
        }, RELEASE_DELAY + 40);
      } else {
        targetRef.current = { x: 0, y: 0 };
        velocityRef.current = { x: 0, y: 0 };
        setVisual((currentVisual) => ({ ...currentVisual }));
        pointerRef.current = null;
        pointerMovedRef.current = false;
      }
    }

    function handleWindowPointerCancel(event) {
      if (!pointerRef.current || pointerRef.current.pointerId !== event.pointerId) {
        return;
      }

      resetDragRef.current?.();
    }

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
    };
  }, [disabled]);

  const leftActive = visual.x < -24;
  const rightActive = visual.x > 24;
  const scale = 1 - clamp(Math.abs(visual.x) / 2400, 0, 0.02);
  const rotation = clamp(visual.x / 26, -12, 12);

  const cardStyle = useMemo(
    () => ({
      transform: `translate3d(${visual.x}px, ${visual.y}px, 0) rotate(${rotation}deg) scale(${scale})`,
    }),
    [rotation, scale, visual.x, visual.y],
  );

  function scheduleCommit(choice) {
    if (commitLockRef.current || disabled) {
      return;
    }

    commitLockRef.current = true;

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (choice === "left") {
      targetRef.current = { x: -EXIT_DISTANCE, y: currentRef.current.y * 0.18 };
    } else if (choice === "right") {
      targetRef.current = { x: EXIT_DISTANCE, y: currentRef.current.y * 0.18 };
    } else {
      targetRef.current = { x: 0, y: 0 };
      currentRef.current = { ...currentRef.current };
      velocityRef.current = { x: 0, y: 0 };
      setVisual((current) => ({ ...current }));
    }

    pointerRef.current = null;
    draggingRef.current = false;
    pointerMovedRef.current = false;

    timeoutRef.current = window.setTimeout(() => {
      onChoose(choice);
      commitLockRef.current = false;
      timeoutRef.current = null;
    }, choice === "left" || choice === "right" ? RELEASE_DELAY : 60);
  }

  function resetDrag() {
    draggingRef.current = false;
    pointerRef.current = null;
    pointerMovedRef.current = false;
    targetRef.current = { x: 0, y: 0 };
    velocityRef.current = { x: 0, y: 0 };
  }

  function handlePointerDown(event) {
    if (disabled || commitLockRef.current || event.button !== 0) {
      return;
    }

    pointerRef.current = {
      pointerId: event.pointerId,
      origin: normalizePointer(event),
    };
    draggingRef.current = true;
    pointerMovedRef.current = false;
  }

  function handleTap(choice) {
    if (disabled) {
      return;
    }

    if (commitLockRef.current) {
      return;
    }

    if (clickSuppressedRef.current) {
      return;
    }

    scheduleCommit(choice);
  }

  return (
    <div className="comparison-shell">
      <div className="comparison-card-wrap">
        <div className="comparison-card" style={cardStyle} onPointerDown={handlePointerDown}>
          <button
            type="button"
            className={`comparison-side comparison-side--left ${leftActive ? "is-active" : ""}`}
            onClick={() => handleTap("left")}
            disabled={disabled}
          >
            <span className="comparison-side__label">Left</span>
            <h3>{leftCause.name}</h3>
            <p>{leftCause.description}</p>
          </button>

          <button
            type="button"
            className={`comparison-side comparison-side--right ${rightActive ? "is-active" : ""}`}
            onClick={() => handleTap("right")}
            disabled={disabled}
          >
            <span className="comparison-side__label">Right</span>
            <h3>{rightCause.name}</h3>
            <p>{rightCause.description}</p>
          </button>
        </div>
      </div>

      <div className="comparison-actions">
        <button type="button" className="button button--ghost button--small" onClick={() => handleTap("skip")} disabled={disabled}>
          Skip
        </button>
        <button type="button" className="button button--ghost button--small" onClick={() => handleTap("tie")} disabled={disabled}>
          Equal
        </button>
      </div>
    </div>
  );
}
