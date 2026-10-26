# Carewell

Find trusted doctors, request appointments and talk to your doctor online, in English or Bengali (বাংলা). Carewell is a
doctor-booking platform for Bangladesh with three kinds of users (patients, doctors and administrators), built with the PERN
stack: **P**ostgreSQL · **E**xpress · **R**eact · **N**ode.

| Part | What it is |
| --- | --- |
| [`client/`](client) | The website (React 19 + Vite). Runs on built-in demo data, or against the real API. |
| [`server/`](server) | The API (Express 5 + Prisma + PostgreSQL on Neon, with file storage and email). |
| [`docs/`](docs) | Deployment, administrator guide, changelog, API contract, data model, architecture and backend guide. |
| [`scripts/`](scripts) | `npm run setup` and `npm run dev` (see below). |

**Live setup:** the website runs on Vercel, the API on Render and the data on Neon. Everything a teammate needs to deploy it
is in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. How the administrator side works is in
**[docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)**. What changed recently is in **[docs/CHANGELOG.md](docs/CHANGELOG.md)**.

## What the website does

- **Patients:** search doctors by specialty, name or area; compare fees, experience and clinics; sign up with an emailed 6-digit
  code; ask for an appointment for yourself or a family member (a request is not a booking until the doctor accepts it);
  follow and cancel requests; message your doctor after they accept; rate a doctor after a completed visit; get notifications
  and emails; contact support.
- **Doctors:** apply to join (*Join as a doctor*: account, emailed code, profile, BMDC registration certificate, submit) or
  accept an administrator's emailed invitation (48-hour link). Once approved: accept or reject requests, manage availability
  and profile (with a photo), message patients and the administration, ask to deactivate the account.
- **Administrators:** dashboard; review doctor applications (compare the BMDC certificate with the BMDC register, then approve,
  ask for changes or reject; rejected doctors may reapply after 30 days); invite and publish doctors; manage clinics,
  specialties, appointments, availability, patients, reviews, support and deactivation requests; message any doctor.
- **Bengali:** one button in the top bar switches the whole website, and the emails it sends you, to Bengali.
- **Instant updates:** messages and notifications arrive immediately (Server-Sent Events).
- **Emails** (English or Bengali, whichever the person uses): verification code, password reset, doctor invitation,
  application decisions, appointment requests, answers and cancellations, support replies.

### Security in short

- New passwords must have 10+ characters with a lowercase letter, a capital, a number and a symbol. Patients and doctors can
  show their password while typing; the administrator sign-in cannot.
- The administrator sign-in page is unlisted, and an administrator account is **locked for 30 minutes after 4 wrong
  passwords** (the owner is emailed; a password reset unlocks it). See [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md).
- Sign-in uses an HttpOnly cookie session; the database enforces the important rules (no double-booked times, only verified
  doctors can be published) so they cannot be bypassed.

## 1. Get the code

You need [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org) **20.19 or newer** (22 is fine). Check with
`node --version`.

```sh
git clone https://github.com/Tahiya07/Doctor-platform.git
cd Doctor-platform
```

No Git? Open the repository on GitHub, click **Code → Download ZIP**, unzip it and open a terminal in the unzipped folder.
Clone it into its own folder, not inside another copy of the project.

## 2. Just try the website (2 minutes, no accounts needed)

```sh
cd client
npm install
npm run dev
```

Open <http://localhost:5173/Doctor-platform/>. This **demo mode** uses made-up data that resets when you reload, and any email
and password signs in (choose *Doctor sign in* in the sidebar). Nothing is saved. The administrator sign-in is not linked
anywhere: set `VITE_ADMIN_LOGIN_PATH` in the project-root `.env.local` (for example `/staff-demo`) and open
<http://localhost:5173/Doctor-platform/#/staff-demo>.

## 3. Run the full app (real database, real accounts)

The full app needs these services. Ask whoever runs the project for the values, or create your own free ones:

| You need | What for | Where to get it |
| --- | --- | --- |
| A **PostgreSQL database** | users, doctors, appointments, messages | [Neon](https://neon.tech): create a project (choose **Singapore** for Bangladesh), then copy the *pooled* and the *direct* connection strings from **Connection details** |
| An **S3-compatible bucket** (private) | certificates, message attachments and profile photos | Neon Object Storage (see `neon.ts`): endpoint URL, access key, secret key, region and bucket name |
| An email account *(optional)* | verification codes, reset links, appointment emails and copies of help-page messages | Any SMTP server. For Gmail, turn on 2-Step Verification and create an *App Password*. Without it, emails are printed in the terminal instead |

Then, from the project folder:

```sh
npm run setup      # asks for the values once, installs everything, prepares the database
npm run dev        # starts the API (port 3000) and the website (port 5173) and opens your browser
```

`npm run setup`:

1. checks your Node.js version,
2. asks for the values above and writes them to **`.env.local`** (secrets are typed hidden),
3. installs the packages of `server/` and `client/`,
4. checks the database and the bucket, applies the migrations, and creates the first **administrator**, the specialties and a
   few clinics,
5. switches the website to use the real API (`client/.env.local`) and gives the administrator sign-in page a hard-to-guess
   address (`VITE_ADMIN_LOGIN_PATH` in `.env.local`), which it prints at the end.

If a teammate sent you their `.env.local`, put it in the project root first and setup will not ask anything. It is safe to run
again at any time. When `npm run dev` is ready, the website opens at <http://localhost:5173/Doctor-platform/> (use
`npm run dev -- --no-open` to stop it from opening the browser). Press **Ctrl+C** once to stop both services.

**After pulling new code**, apply any new database migration: `cd server && npx prisma migrate deploy` (never `prisma db push`).

**Sign in as the administrator** at `http://localhost:5173/Doctor-platform/#<VITE_ADMIN_LOGIN_PATH>` (the value in `.env.local`;
the page is deliberately not linked from the site) with `SEED_ADMIN_EMAIL` (default `admin@carewell.test`) and
`SEED_ADMIN_PASSWORD`, both in `.env.local`. A good first tour:

1. As admin, **Doctor management → Invite doctor**. The invitation email (or the `[api]` window without SMTP) has the link to
   set a password. As that doctor, upload a BMDC certificate and submit; back as admin, open **Verification**, record the BMDC
   check, **Approve**, then **Publish** in Doctor management.
2. Open the site in a private window, **Create account** as a patient, enter the emailed code and ask that doctor for a time.
3. Sign in as the doctor, accept the request and send a message. Watch the bell and the Messages page update on the patient's side.

For realistic fictional data (15 specialties, 11 clinics and hospitals, 16 published doctors with open times, patients,
requests in every status, conversations and support requests), run `npm run seed:demo` with `SEED_DEMO_PASSWORD` set in
`.env.local` (the password of every demo account).

> **Never commit or post `.env.local`.** It gives full access to the database and the files. It is already ignored by Git. Share
> it only privately, and change the passwords if it ever leaks. Everyone who uses the same `.env.local` shares one database, so
> deleting data in one browser deletes it for everybody.

## Everyday commands

Run from the project folder unless noted.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the API and the website together |
| `npm run setup` | First-time setup (safe to repeat) |
| `npm test` | Server tests (a long run: they use a temporary schema in your database) and client tests |
| `npm --prefix client test -- --run` | Client tests only (under a minute) |
| `npm --prefix client run check` | What CI runs: lint, format check, tests and a production build |
| `npm --prefix server run seed` | Create or update the administrator, specialties and clinics |
| `npm run seed:demo` | Fill the database with realistic fictional data (see above). Safe to repeat |
| `npm run seed:images` | Give the demo doctors and facilities their photos (stored in `client/public/images`, credited in [docs/IMAGE_CREDITS.md](docs/IMAGE_CREDITS.md)) |
| `npm --prefix server run verify:services` | Check that the database and the bucket can be reached |

The API's tests build a throw-away schema from the migrations and delete it afterwards, so real data is never touched.

## If something goes wrong

| Problem | Fix |
| --- | --- |
| *Missing required environment variables* | `.env.local` is missing or not in the project root. Run `npm run setup`. |
| The page loads but shows errors or empty lists | The API is not running or the website is in demo mode. Run `npm run dev`; `client/.env.local` must contain `VITE_CAREWELL_DATA_MODE=api`. |
| *This request did not come from the Carewell website.* | Locally any `localhost` port works. On a deployed site `CLIENT_ORIGINS` must contain the exact website address (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). |
| *Port 3000 or 5173 is already in use* | Close the other terminal running the project. Vite moves to 5174 by itself, but the API needs 3000. |
| `prisma generate` fails with `EPERM` on Windows | The API is still running and holds a file open. Stop `npm run dev`, run the command again, then restart. |
| *Node.js 20.19 or newer is required* | Install a newer Node.js from <https://nodejs.org>. |
| No email arrives | Without `SMTP_*` settings emails are printed in the `npm run dev` window under `[api]`. |
| Your administrator account is locked | Wait 30 minutes, or use *Forgot your password?* (see [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)). |
| Database errors after pulling | Apply new migrations: `cd server && npx prisma migrate deploy`. |

## How it is built

```text
client/   React app: pages/, components/, hooks/, context/, services/ (real API or demo data), utils/, styles/, i18n/
server/   Express API: routes/ → controllers/ → services/ → models/ (+ middleware/, utils/), prisma/ (schema + migrations), tests/
docs/     DEPLOYMENT · ADMIN_GUIDE · CHANGELOG · API_CONTRACT · DATA_MODEL · ARCHITECTURE · BACKEND_GUIDE · PRD_TRACEABILITY · IMAGE_CREDITS
scripts/  setup.mjs · dev.mjs
.github/  CI and GitHub Pages deployment (a demo-mode copy of the website)
```

- The website talks to the API only through `client/src/services/`. A switch (`VITE_CAREWELL_DATA_MODE`) chooses the real API
  or the in-memory demo, and the demo tests double as an executable specification of the API.
- **Bengali:** `client/src/i18n/` translates every piece of text and the emails are written in both languages by
  `server/src/services/mailCopy.js`. See "Bengali" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how to add words.
- Administrators manage patients (search, suspend, restore) and moderate reviews. Messages sent through the help page are also
  emailed to `SUPPORT_EMAIL` (the `SMTP_USER` mailbox by default).
- Never run `prisma db push`. Change `server/prisma/schema.prisma`, then create a migration.
- To add an API feature: create `server/src/controllers/<name>.js` (handlers) and `server/src/routes/<name>.js` (URLs), mount
  the router with one line in `server/src/routes/index.js`, and add `server/tests/<name>.test.js`. See
  [docs/BACKEND_GUIDE.md](docs/BACKEND_GUIDE.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Not built yet

SMS messages (needs a Bangladeshi SMS provider account), two-step verification for administrators and doctors, online payment
(the fee is paid at the clinic), appointment reminders.

## Contributing

- Follow the conventions in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Run `npm --prefix client run check` before opening a pull request, and the server tests when you touch `server/`.
- Keep the API contract and the demo adapter in sync: the demo tests are the executable specification.
- Image credits live in [docs/IMAGE_CREDITS.md](docs/IMAGE_CREDITS.md); the demo doctors and clinics are fictional.
