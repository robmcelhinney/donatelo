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
- Swipe interactions use a springy draggable comparison card with tap fallback buttons.
- Allocation results are based on pairwise preferences and tuned so a clearly preferred cause can dominate much more strongly.
- Sessions are saved on the backend, so share links can open the same session in another browser.
