# Donatelo

Minimal donation ranking app built with React, Vite, and a small Node backend.

## Run locally

```bash
npm install
npm run dev
```

## Test the ranking logic

```bash
npm test
```

## Build

```bash
npm run build
```

If you want to serve the built app with the backend:

```bash
NODE_ENV=production npm start
```

## Notes

- The UI is intentionally minimalist: neutral background, thin borders, no gradients.
- Comparisons use direct button choices with a short, polished card transition.
- Users can add up to five custom cause areas before starting or while editing a session.
- Custom cause areas can be edited or removed; removing one also cleans up comparisons that referenced it.
- Allocation results are based on pairwise preferences and tuned so a clearly preferred cause can dominate much more strongly.
- Results link to Giving What We Can’s independently maintained recommendations catalogue.
- Results can be shared with a generated PNG where supported or downloaded as an image.
- Confidence is presented as a light, moderate, or strong result signal rather than a statistical claim.
- Methodology and privacy views are available from the site footer.
- Sessions are saved on the backend, so share links can open the same session in another browser.
