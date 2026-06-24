export default function SiteFooter({ onOpenPage, onBrandClick, turtleMode = false }) {
  return (
    <footer className="site-footer">
      <button type="button" className="site-footer__brand" onClick={onBrandClick} aria-label="Donatelo">
        Donatelo
      </button>
      <nav aria-label="About">
        <button type="button" onClick={() => onOpenPage("methodology")}>Methodology</button>
        <button type="button" onClick={() => onOpenPage("privacy")}>Privacy</button>
      </nav>
      {turtleMode ? (
        <>
          <div className="turtle-mask-marks" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="turtle-easter-egg" aria-hidden="true">
            <div className="turtle-streaks">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="rolling-pizza"><span /></div>
          </div>
        </>
      ) : null}
      <span className="visually-hidden" aria-live="polite">
        {turtleMode ? "Heroes in a half shell. Donations in a full pie." : ""}
      </span>
    </footer>
  );
}
