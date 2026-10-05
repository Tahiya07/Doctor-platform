# Carewell 

A healthcare discovery and care coordination prototype. The current data source is an async-shaped in-memory mock service; no API server, persistence, authentication, messaging transport, file storage, or payment processing is included.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Create a production bundle with `npm run build`.

## Frontend structure

- `src/App.jsx` contains the application shell, reusable interface pieces, hash-based views, and simulated user/admin interactions.
- `src/data/contracts.js` documents the information shapes consumed by the UI.
- `src/data/mockData.js` contains the demo fixtures.
- `src/data/careService.js` is the replaceable async data/action boundary for future API integration.
- `src/styles.css` defines semantic light/dark tokens and responsive shared components.

## Included views

Discovery, doctor directory and profile, clinic/hospital discovery, booking with patient details and confirmation, patient appointments, messages, assistance, admin overview, doctor management, verification review, facility management, appointment management, specialty management, and availability management.

All mutations are simulated in browser memory. Refreshing resets demo changes. Theme preference is stored locally; System follows the OS theme.
