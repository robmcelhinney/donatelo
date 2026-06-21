import { useEffect, useRef, useState } from "react";

const TRANSITION_DURATION = 260;

export default function ComparisonCard({ leftCause, rightCause, onChoose, disabled = false }) {
  const [pendingChoice, setPendingChoice] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  function handleChoice(choice) {
    if (disabled || pendingChoice) {
      return;
    }

    setPendingChoice(choice);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      onChoose(choice);
    }, TRANSITION_DURATION);
  }

  const interactionDisabled = disabled || Boolean(pendingChoice);
  const cardClassName = [
    "comparison-card",
    pendingChoice ? "is-exiting" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="comparison-shell">
      <div className="comparison-card-wrap">
        <div className={cardClassName}>
          <button
            type="button"
            className={`comparison-side comparison-side--left ${pendingChoice === "left" ? "is-selected" : ""}`}
            onClick={() => handleChoice("left")}
            disabled={interactionDisabled}
          >
            <span className="comparison-side__label">Left</span>
            <h3>{leftCause.name}</h3>
            <p>{leftCause.description}</p>
          </button>

          <button
            type="button"
            className={`comparison-side comparison-side--right ${pendingChoice === "right" ? "is-selected" : ""}`}
            onClick={() => handleChoice("right")}
            disabled={interactionDisabled}
          >
            <span className="comparison-side__label">Right</span>
            <h3>{rightCause.name}</h3>
            <p>{rightCause.description}</p>
          </button>
        </div>
      </div>

      <div className="comparison-actions">
        <button type="button" className="button button--ghost button--small" onClick={() => handleChoice("skip")} disabled={interactionDisabled}>
          Skip
        </button>
        <button type="button" className="button button--ghost button--small" onClick={() => handleChoice("tie")} disabled={interactionDisabled}>
          Both equally important
        </button>
      </div>
    </div>
  );
}
