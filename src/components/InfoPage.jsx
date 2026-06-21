export default function InfoPage({ page, onClose }) {
  const isMethodology = page === "methodology";

  return (
    <main className="panel info-page">
      <div className="info-page__heading">
        <div>
          <p className="eyebrow">About Donatelo</p>
          <h1>{isMethodology ? "Methodology" : "Privacy"}</h1>
        </div>
        <button type="button" className="button button--ghost" onClick={onClose}>Close</button>
      </div>

      {isMethodology ? (
        <div className="info-page__content">
          <section>
            <h2>How ranking works</h2>
            <p>Donatelo shows two cause areas at a time. Choosing one gives it an Elo win and gives the other a loss. “Both equally important” records a draw. Skip changes no rating and does not count towards progress.</p>
          </section>
          <section>
            <h2>How pairs are selected</h2>
            <p>Pairs are chosen to improve coverage while avoiding immediate repeats. The selector also revisits plausible leaders so the final ordering is informed by useful comparisons rather than presentation order.</p>
          </section>
          <section>
            <h2>How allocations are calculated</h2>
            <p>Ratings are converted into positive weights using an exponential curve, then normalised to 100%. The allocation-style control blends that result with an even split: Balanced applies more of the even split; Decisive applies more of the rating-based result.</p>
          </section>
          <section>
            <h2>Important limitations</h2>
            <p>The result reflects your answers, not objective need or charity effectiveness. Confidence is a heuristic based on the number of completed comparisons and the gap between the leading allocations. It is not a statistical confidence interval.</p>
          </section>
        </div>
      ) : (
        <div className="info-page__content">
          <section>
            <h2>What is stored</h2>
            <p>A saved session contains its random identifier, selected and custom cause areas, comparison answers, ratings, allocation settings, and timestamps. The application does not ask for your name, email address, or payment details.</p>
          </section>
          <section>
            <h2>Where it is stored</h2>
            <p>Sessions are stored by the Donatelo server. Your browser stores only the active session identifier in local storage so you can resume. The application code does not set advertising cookies or include analytics trackers.</p>
          </section>
          <section>
            <h2>Shared links</h2>
            <p>Anyone with a session link can view that session’s answers and results. Treat the link as private if you do not want others to see your choices, and avoid putting sensitive personal information in custom cause fields.</p>
          </section>
          <section>
            <h2>Retention and deletion</h2>
            <p>Sessions remain on the server until they are deleted. You can delete the saved copy from the session screen, which also makes the share link stop working. Clearing or restarting in your browser does not delete an existing server copy. If you no longer have access to the session, contact the site operator.</p>
          </section>
          <p className="info-page__updated">Last updated 21 June 2026.</p>
        </div>
      )}
    </main>
  );
}
