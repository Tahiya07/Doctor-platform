# The administrator system

Administrators run Carewell: they verify doctors, publish profiles, look after patients and read support requests. Because
an administrator account can see patient information, it is protected more strongly than the others.

## How an administrator signs in

- There is **no link** to the administrator sign-in anywhere on the website. It lives at an unlisted address that you
  choose: `<website>/#<VITE_ADMIN_LOGIN_PATH>`, for example `https://<your-site>.vercel.app/#/staff-xxxxxxxx`.
  Anyone else who types an admin page address sees "Page not found".
- That address only hides the page from casual visitors. The real protection is on the server: it checks the role, limits
  attempts and locks the account (below).
- The administrator sign-in page has **no "show password" eye** (patients and doctors do).
- A patient or doctor cannot use it: the server answers "not authorised for the administrator portal".

## Creating the first administrator

`npm --prefix server run seed` creates the administrator from `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (10 or more
characters) together with the specialties and a few clinics. It is safe to run again, but note that running it for an
email that already exists **resets that administrator's password** to `SEED_ADMIN_PASSWORD` (it does not lift a sign-in
lock; use a password reset for that). To add another administrator, run it with a different `SEED_ADMIN_EMAIL`; there is
no screen for adding administrators yet.

## The 4-try lock

| What happens | Result |
| --- | --- |
| 1st to 3rd wrong password | "Wrong email or password." |
| **4th wrong password in a row** | The account is **locked for 30 minutes**. Even the correct password is refused while it is locked |
| The lock starts | The administrator gets an email (in their language) saying who tried from which address |
| A correct password before the 4th mistake | The count starts again from zero |
| **Reset password** from the emailed link | Unlocks the account immediately (opening the link proves the mailbox is theirs) |

Details worth knowing:

- Wrong guesses made through the **patient or doctor** sign-in pages count against an administrator account too, so the
  password cannot be guessed from there.
- Typing any other email into the administrator page behaves **exactly the same** (also locked after 4 tries), so the lock
  cannot be used to discover which emails are administrators.
- Patients and doctors are not locked after 4 tries. They have the general limit of 10 tries per 15 minutes.
- The lock is stored in the database (`users.failed_login_count`, `users.locked_until`), so it survives a restart.
  An administrator who is locked out and cannot use their email can be unlocked by someone with database access:
  `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE email = '...';`

## Passwords

Every **new** password (sign-up, reset, change, doctor invitation) must have 10 or more characters with a lowercase letter, a
capital letter, a number and a symbol, and must not contain obvious words such as "password" or "123456". The forms show the
rules ticking off while typing. Older passwords keep working until their owner changes them.

## What an administrator can do

Dashboard · invite doctors by email · review doctor applications (compare the BMDC certificate with the BMDC register, then
approve, ask for changes or reject; rejected doctors may reapply after 30 days) · publish or hide doctors · manage clinics and
specialties · see and manage every appointment and availability · manage patients (search, suspend, restore) · moderate reviews
· answer support requests (the reply is emailed) · decide doctor deactivation requests · message any doctor. Important changes
are written to the audit log.

## Not built yet (recommended before real patients)

**Two-step verification** for administrators (and doctors). The best fit is an authenticator app (Google or Microsoft
Authenticator): after the password the person enters a 6-digit code that changes every 30 seconds, with a set of single-use
backup codes. Email codes can be the fallback because email already works. SMS codes need an SMS provider account and are the
weakest option (SIM swapping). The password lock above stays in place alongside it.
