export default function SiteFooter({ onOpenPage }) {
  return (
    <footer className="site-footer">
      <span>Donatelo</span>
      <nav aria-label="About">
        <button type="button" onClick={() => onOpenPage("methodology")}>Methodology</button>
        <button type="button" onClick={() => onOpenPage("privacy")}>Privacy</button>
      </nav>
    </footer>
  );
}
