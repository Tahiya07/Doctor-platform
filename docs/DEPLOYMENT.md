# Deploying Carewell (Vercel + Render + Neon)

```text
Browser ──▶ Vercel (the website, plus a rewrite of /api/* ) ──▶ Render (the API) ──▶ Neon (database + file storage)
                                                                         └──────────▶ an SMTP mailbox (emails)
```

The browser only ever talks to Vercel. Vercel serves the website and forwards every `/api/...` request to the API on
Render (`vercel.json`). That keeps the login cookie on one address, so there is no cross-site cookie trouble.

> **Never put secrets in the repository, in a chat or in a screenshot.** Send the values below to your teammate
> privately (a password manager, or a one-time secret link). Anything that was ever pasted into a chat should be
> changed before the real launch.

## 0. What your teammate needs from you

| Item | Where it is used | Where you find it |
| --- | --- | --- |
| Repository access (GitHub, `main` branch) | Vercel and Render both build from it | GitHub → Settings → Collaborators |
| **Database URL** (pooled) | Render `DATABASE_URL` | Neon → your project → *Connection details* (the one with `-pooler` in the host) |
| **Storage** values: endpoint, access key, secret key, region, bucket | Render `AWS_*`, `S3_BUCKET` | Neon → Object Storage (or `.env.local`) |
| **SMTP** values: host, port, user, app password, from-address | Render `SMTP_*`, `MAIL_FROM` | Gmail → Google Account → Security → *App passwords* |
| **Administrator** email and password | Render `SEED_ADMIN_*` (first run only) | You choose them (password: 10+ characters) |
| **Unlisted admin sign-in path**, e.g. `/staff-xxxxxxxx` | Vercel `VITE_ADMIN_LOGIN_PATH` | `VITE_ADMIN_LOGIN_PATH` in your `.env.local` (path only) |
| The **Vercel address** of the website | Render `CLIENT_ORIGINS` and `APP_URL` | Vercel → project → Domains |
| The **Render address** of the API | `vercel.json` rewrite | Render → service → URL |

## 1. The database (do this first)

The code in this repository needs one new migration (`20261026120000_login_lockout_and_language`: the administrator
lock and each person's language). It only **adds** columns with defaults, so nothing is lost. Apply it to the database
that Render uses, from a computer that has the Render `DATABASE_URL`:

```sh
cd server
npm ci
DATABASE_URL="<the database url Render uses>" npx prisma migrate deploy
```

(PowerShell: `$env:DATABASE_URL="..."; npx prisma migrate deploy`.) Or let Render do it on every deploy with the
*Pre-Deploy Command* below. Never run `prisma db push`.

**Which database?** Two Neon projects exist: the old one in Ohio (`us-east-2`) and the new one in Singapore
(`ap-southeast-1`), which is faster for Bangladesh and holds the latest demo data. For the live site, point Render at
the **Singapore** project: change `DATABASE_URL` *and* the storage values together (files such as photos and
certificates live in that project's bucket). Everybody on the team should then use the same database, otherwise each
person sees different data.

On a brand-new, empty database, run once (Render → *Shell*, or locally with that `DATABASE_URL`):

```sh
npm --prefix server run seed        # first administrator + specialties + a few clinics
npm --prefix server run seed:demo   # optional: realistic fictional doctors, patients and appointments
```

## 2. Render (the API)

Create a **Web Service** from the GitHub repository (`main`), runtime **Node** (20.19 or newer; 22 is fine).

| Setting | Value |
| --- | --- |
| Root Directory | *(leave empty: the repository root)* |
| Build Command | `cd server && npm ci && npx prisma generate` |
| Pre-Deploy Command | `cd server && npx prisma migrate deploy` |
| Start Command | `cd server && npm start` |
| Health Check Path | `/api/v1/health` |
| Region | Singapore (closest to Bangladesh and to the Singapore database) |

Environment variables (Render → *Environment*):

| Variable | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Turns on secure cookies and the strict origin check. **Required.** |
| `DATABASE_URL` | pooled Neon URL | secret |
| `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET` | from Neon storage | secret. The server refuses to start if the first four are missing |
| `CLIENT_ORIGINS` | `https://<your-site>.vercel.app` | The exact Vercel address(es), comma separated, no trailing slash. Without it every sign-in fails with "This request did not come from the Carewell website." |
| `APP_URL` | `https://<your-site>.vercel.app/` | Used for the links inside emails. Keep the trailing slash |
| `TRUST_PROXY` | `2` | Two proxies sit in front (Vercel, then Render), so sign-in limits count each visitor |
| `BCRYPT_COST` | `12` | |
| `SESSION_DAYS` | `7` | |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | your mailbox | secret. Without them no email is sent (it is only logged) |
| `SUPPORT_EMAIL` | where help-page messages go | optional |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | the administrator | only for the first `seed` run; remove afterwards |

`PORT` is set by Render itself.

## 3. Vercel (the website)

Import the same repository. Vercel reads `vercel.json` (Vite, `npm ci --prefix client`, `npm --prefix client run build`,
output `client/dist`), so the build settings need no changes.

Environment variables (Vercel → *Settings → Environment Variables*). These are baked in **when the site is built**, so
**redeploy after changing any of them**, and never put a secret here: they are visible in the browser.

| Variable | Value |
| --- | --- |
| `VITE_CAREWELL_DATA_MODE` | `api` (without it the site shows made-up demo data) |
| `VITE_API_BASE_URL` | `/api/v1` |
| `VITE_API_SEND_CREDENTIALS` | `true` |
| `VITE_ADMIN_LOGIN_PATH` | the unlisted admin path, e.g. `/staff-xxxxxxxx` (path only) |

`vercel.json` also holds the address of the API: the first rewrite sends `/api/*` to
`https://<your-service>.onrender.com/api/*`. If the Render service gets a new address, change it there and push.
The site uses hash links, so pages look like `https://<your-site>.vercel.app/#/doctors`.

## 4. Check that it works

1. `https://<render-address>/api/v1/health` shows `{"status":"ok", ...}` (the first call after a quiet period can take
   about a minute on Render's free plan).
2. Open the Vercel address. Doctors and clinics appear (not "demo" data you do not recognise).
3. Create a patient account: the verification email arrives. Switch to বাংলা, ask for a password reset: it arrives in Bengali.
4. Open `https://<your-site>.vercel.app/#<admin path>` and sign in as the administrator (see [ADMIN_GUIDE.md](ADMIN_GUIDE.md)).
5. Request an appointment as a patient, accept it as a doctor: both people get an email.

## 5. When something is wrong

| What you see | Cause |
| --- | --- |
| "This request did not come from the Carewell website." | `CLIENT_ORIGINS` on Render does not contain the exact Vercel address, or `NODE_ENV` is not `production` and the address is not localhost |
| Every page is empty or shows 502 | The Render service is asleep or crashed: open its logs. Check `DATABASE_URL` |
| Sign-in works but you are signed out on reload | Cookies blocked: `NODE_ENV=production` needs HTTPS (Vercel and Render both are), and `VITE_API_BASE_URL` must be `/api/v1` (not the Render address) |
| Emails never arrive | `SMTP_*` missing or wrong; look for `[mail]` lines in the Render logs. Gmail needs an *App password* |
| Links in emails open the wrong site | `APP_URL` |
| The site shows demo data | `VITE_CAREWELL_DATA_MODE` is not `api`, or Vercel was not redeployed after setting it |
| Database errors after a deploy | A migration was not applied: run `npx prisma migrate deploy` (section 1) |

## 6. Before the real launch

- Change every password and key that was ever pasted into a chat (database, storage, SMTP app password, administrator).
- Keep `.env.local` private; it is ignored by Git.
- Plan two-step verification for administrators (see [ADMIN_GUIDE.md](ADMIN_GUIDE.md)).
- Decide where the Ohio project goes: keep it as a backup for a while, then delete it.
