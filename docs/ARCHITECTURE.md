# Client architecture

React 19 + Vite 8 single-page app, JavaScript with JSDoc types, `react-router-dom` (hash routing), plain CSS with
design tokens. Tested with Vitest + Testing Library; linted with ESLint; formatted with Prettier.

The layout is the classic React one: `components/`, `pages/`, `hooks/`, `context/`, `services/`, `utils/`, `styles/`.
The rule of thumb: **one page = one file in `pages/`**, **one component = one file in `components/`**.

## Folder map (`client/src`)

```text
main.jsx                 entry point: mounts <App/> in the router and loads the 4 stylesheets
App.jsx                  the route table and the app-wide providers
constants.js             roles, status vocabularies, every URL (PATHS), booking/attachment limits, env config
types.js                 JSDoc typedefs for every API shape (no runtime code)

pages/                   one file per screen, grouped by who uses it
  public/                  DiscoverPage, DirectoryPage, DoctorProfilePage, FacilitiesPage, AssistancePage
  auth/                    LoginPage, SignUpPage, VerifyEmailPage, ForgotPasswordPage, ResetPasswordPage, DoctorRegisterPage,
                           DoctorInvitationPage
  patient/                 AppointmentsPage, ProfilePage
  doctor/                  DoctorApplicationPage (until approved), DoctorDashboardPage
  admin/                   AdminOverviewPage, DoctorManagementPage, VerificationPage, FacilityManagementPage,
                           AppointmentManagementPage, SpecialtiesPage, AdminAvailabilityPage,
                           SupportRequestsPage, DeactivationRequestsPage
  MessagesPage.jsx         used by patients, doctors and administrators
  NotFoundPage.jsx

components/              reusable pieces, one component per file
  ui/                      Button, Field, Modal, DataTable, Tabs, ... (import them from components/ui/index.js)
  layout/                  AppShell, Topbar, NotificationBell, AccountMenu, Sidebar, MobileDrawer, Footer, navigation.js
  doctors/                 DoctorCard, DoctorGrid, FacilityCard, DoctorProfileFields
  booking/                 BookingDialog and its four steps
  availability/            AvailabilityManager (doctor workspace and admin)
  discovery/               home page pieces and the doctor filters
  messaging/               ConversationList, ChatThread, MessageComposer, StartConversation
  patient/ doctor/ admin/  pieces that belong to one area
  RequireRole.jsx          the route guard

hooks/                   useResource (load data, optional quiet refresh), useAction, useDebouncedValue,
                         useDocumentTitle, useModalBehavior, useDismiss, useDoctorFilters
context/                 Theme, Toast, Confirm, Auth, Realtime (live-update stream), Catalog (clinics + specialties) and Booking providers

services/                the ONLY layer that touches data
  index.js                 picks the real API or the demo from VITE_CAREWELL_DATA_MODE
  httpClient.js            fetch wrapper, ApiError, 401 handling
  api.js                   every real HTTP call, one section per resource
  demoBackend.js           in-memory backend with the business rules (delete when the real API is done)
  demoData.js              fictional fixtures for the demo

utils/                   pure helpers: dates.js, format.js, validation.js, forms.js, placeholders.js
i18n/                    Bengali: bn.js + bn.extra.js + bn.server.js (the words), translate.js (rules for numbers, times and sentences), domTranslator.js (applies it to the page)
styles/                  base.css (tokens, reset, layout) · components.css · pages.css · responsive.css
*.test.js(x)             tests sit next to what they test; test/setup.js configures them
```

## Rules of the road

1. **Data access only through `services/`.** Components never call `fetch`. They import `xxxService` from
   `services/index.js`, which resolves to the API or the demo. Both expose identical methods and return identical
   shapes, so switching is a single env var.
2. **Errors are `ApiError`s** with `status`, `code`, `message` and optional `details`. UI shows `error.message`.
3. **Pages fetch their own data** with `useResource(loader, deps)`; mutations go through `useAction` (toast on result)
   or a form's own try/catch. Shared reference data (clinics, specialties) comes from `useCatalog()`.
4. **Reusable means feature-agnostic.** `components/ui/` knows nothing about doctors or appointments. Pieces shared
   by several screens (`DoctorProfileFields`, `AvailabilityManager`, `DoctorCard`) live in a folder named after their area.
5. **Status strings and URLs come from `constants.js`.** Do not type `"pending"` or `"/admin/doctors"` inline.
6. **The UI is not a security boundary.** `RequireRole` only chooses what to show; the server authorises.
7. **Server state is authoritative.** After a mutation, use the record the API returns.
8. **Where things go:** a screen goes in `pages/`; anything a second screen needs becomes a component in `components/`;
   logic with React state becomes a hook in `hooks/`; shared state becomes a provider in `context/`.

## Bengali (বাংলা)

The language button in the top bar (and the footer) switches the whole website between English and Bengali. The choice is
remembered in the browser. In Bengali mode:

- **`i18n/domTranslator.js`** translates every piece of text on the page, and the `placeholder`, `aria-label`, `title`
  and `alt` attributes, including text that appears later (dialogs, loaded data, toasts, messages from the server).
  The English is remembered per node, so switching back restores it exactly, and React keeps working normally.
- **`i18n/translate.js`** decides what a text becomes: an exact entry in the dictionary, a number or time (`৳1,100` → `৳১,১০০`,
  `3:00 PM` → `বিকাল ৩:০০`), or a sentence pattern with a name or count in it (`14 years experience`). Names, emails and
  anything with no Bengali entry stay as written. The dictionary files hold the words: `bn.js` (earlier screens),
  `bn.extra.js` (the rest of the interface) and `bn.server.js` (messages the API sends).
- **Font:** Hind Siliguri (`@fontsource/hind-siliguri`, bundled, no Google request). `<html lang>` and `data-language`
  follow the choice, and negative letter-spacing is switched off because it breaks Bengali letters.
- **Text people wrote** (chat messages, review comments, support messages) carries `translate="no"` and is never changed.

**Adding a new screen:** write the English as usual. If a new sentence is missing in Bengali, add it to `bn.extra.js`
(keys are the English text exactly as shown). Sentences with a name or number go in the pattern list in `translate.js`.
`i18n/translate.test.js` shows the expected results.

## Data flow

```text
Screen ──useResource──▶ services/index.js ──▶ api.js ──▶ httpClient.js ──▶ Express
                                 └──(demo mode)──▶ demoBackend.js (memory)
```

Routing: `HashRouter` (works on static hosts). Doctor-directory filters live in the URL query string
(`#/doctors?specialty=cardiology`), so searches are shareable and survive refresh. Role-restricted routes are
lazy-loaded, so patients never download admin code.

Live updates: after sign-in, `RealtimeProvider` opens one `EventSource` to `GET /events` (API mode only). The bell and the Messages page subscribe with `useRealtimeEvent` and call `useResource`'s quiet `refresh()` when an event arrives, so new messages and notifications show instantly. While the stream is down they fall back to their old polling intervals.

Sessions: `AuthProvider` calls `GET /auth/me` on load. Any protected request that returns 401 clears the local user
(`setUnauthorizedHandler`).

## Adding a feature

1. Add the endpoint to `docs/API_CONTRACT.md` and a method to the matching section of `services/api.js`.
2. Mirror it in `services/demoBackend.js` (including validation and role checks) and add a test in
   `services/demoBackend.test.js`.
3. Create `pages/<area>/XPage.jsx`, reuse `components/ui/`, register the route in `App.jsx` and the URL in
   `constants.js`. Add navigation in `components/layout/navigation.js` if needed.
4. Add an integration test in `App.test.jsx`.

## Quality gates

`npm run check` = ESLint (React, hooks, a11y) → Prettier check → Vitest → production build. CI runs it on every pull
request ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).

## Known limitations and placeholders

- Several visuals are static placeholders pending real data: hero/testimonial stats and photos (in
  `components/discovery/`), the clinics "Map" toggle.
- Images are hot-linked from Unsplash; host them in `client/public/images` before launch.
- No i18n, no analytics, no error-reporting hook beyond `ErrorBoundary.componentDidCatch`.
- JavaScript with JSDoc; migrating to TypeScript would be a natural next step (`types.js` is the seed).
