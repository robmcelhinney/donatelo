# Donatelo Product Plan

## Product definition

Donatelo helps a user turn subjective cause preferences into a suggested donation allocation. It presents two cause areas at a time, records direct choices or ties, applies an Elo-style rating model, and converts those ratings into percentages.

The interaction is intentionally click/tap based. Swipe gestures were removed because they made the comparison flow feel less smooth and predictable.

## Current status

The MVP and the first follow-up slice are complete.

### Completed experience

- [x] Start with ten built-in cause areas.
- [x] Keep or drop cause areas before ranking.
- [x] Add, edit, remove, keep, or drop up to five custom areas.
- [x] Compare two causes using direct buttons.
- [x] Record left choice, right choice, equal importance, or skip.
- [x] Explain the distinction between a tie and a skipped pair.
- [x] Use a smooth non-swipe card transition.
- [x] Show progress and a softer result-signal indicator.
- [x] Allow early completion and additional comparisons.
- [x] Prevent duplicate pairs and explain when every pair is exhausted.
- [x] Undo the latest recorded choice.
- [x] Return to cause editing and cancel editing without losing results.
- [x] Rebuild progress correctly after changing the active cause set.

### Completed ranking and results

- [x] Initialise each active cause with an equal Elo rating.
- [x] Apply Elo-style wins, losses, and draws.
- [x] Convert ratings to allocations with a weighted exponential transformation.
- [x] Keep allocations normalised to 100%.
- [x] Let users choose a more balanced or decisive allocation style.
- [x] Provide a one-click reset to the default allocation style.
- [x] Rank causes and display allocation percentages and bars.
- [x] Explain why the leading causes ranked where they did.
- [x] Summarise causes kept, comparisons, allocation style, and result signal.

### Completed persistence and sharing

- [x] Save sessions through the Node backend.
- [x] Restore the active session automatically from local browser storage.
- [x] Create shareable session URLs.
- [x] Share results through the native share sheet when available.
- [x] Fall back to copying a text summary and link.
- [x] Generate and download a PNG result image.
- [x] Include the PNG in native sharing when the browser supports file sharing.

### Completed trust and guidance

- [x] Publish methodology and privacy views.
- [x] State that the allocation is guidance rather than an objective prescription.
- [x] Describe result confidence as a light, moderate, or strong signal rather than statistical certainty.
- [x] Link to Giving What We Can’s independently maintained recommendations catalogue.
- [x] Avoid maintaining an unsupported in-house list of recommended charities.

### Completed follow-up work

- [x] Delete saved sessions from the product itself.
- [x] Replay stored answers after editing or removing a prior comparison.
- [x] Surface answer history with per-item edit and remove controls.

### Completed quality work

- [x] Responsive desktop and mobile layouts.
- [x] Reduced-motion support for comparison transitions.
- [x] Validation and normalisation for custom cause input.
- [x] Automated ranking, session, persistence-edge-case, and recommendation-link tests.
- [x] Production build verification.

## Decisions already made

- Allocations always sum to 100%; there is currently no unallocated portion.
- The initial taxonomy contains ten causes and users can add custom causes.
- Ties affect ratings and count as completed comparisons.
- Skips do not affect ratings or progress, but prevent the same pair being shown again.
- Comparison count scales with the number of active causes and available unique pairs.
- Results may be generated early, with a correspondingly lighter result signal.
- Donatelo recommends cause allocations, while current organisation research remains external.
- Sessions are anonymous but accessible to anyone holding their share URL.
- The comparison question should blend personal values with expected impact.
- Users should be able to manually adjust the final percentages.
- Community benchmarking is out of scope for now.
- Personalisation stays cause-only for now; an optional donation amount can be entered later to convert percentages into amounts, but it should not affect ranking.

## Personalisation note

Optional donation amount means the user can enter a total gift amount if they want the app to show the ranked percentages as concrete currency amounts. That input should be purely presentational and should not change the ranking or the cause model.

## Candidate phase-two work

These items are not part of the completed MVP. They should only be scheduled once the product chooses which of them, if any, belong in the next phase.

### Personalisation

- Optional donation amount and currency for converting percentages into amounts.
- Optional country or region for tax and organisation relevance.
- Explicit global-versus-local preference controls.
- Clearer distinction between personal values and beliefs about expected impact.

### Comparison review

- Optional expanded cause information or impact summaries.

### Result control

- Optional manual adjustment of final percentages.
- Clear separation between the model suggestion and a user-adjusted allocation.
- Optional unallocated or reserve percentage.

### Organisation guidance

- Build a maintained native directory with geography, tax status, evidence source, review date, and disclosure fields.

### Measurement and experimentation

- Privacy-conscious completion, abandonment, sharing, and return-visit analytics.
- Result-stability measurement.
- User satisfaction feedback.
- A/B testing of pair-selection strategies.
- Evaluation of alternative models such as Bradley–Terry.
- Community benchmarking only if a defensible privacy and sampling model exists.

### Data and operations

- An explicit retention period and operator contact route.
- Optional storage of rating-before and rating-after snapshots for auditability.
- Durable database storage if the application moves beyond a single-instance deployment.

## Resolved phase-two decisions

- Donatelo remains cause-only for ranking, with an optional amount input only for translating percentages into concrete amounts.
- The comparison question blends personal values and expected impact.
- Users may manually adjust the final percentages.
- Allocations must total 100%.
- Organisation guidance stays external for now.
- Privacy/deletion controls and answer-history editing are implemented; analytics comes next only if it proves useful.
- Community benchmarking stays out of scope.

## Proposed next milestone

Decide whether to keep the next phase narrow with analytics and retention controls, or expand the product with optional amount-to-allocation display and more detailed cause guidance.
