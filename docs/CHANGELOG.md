# Changelog

## 2026-10-26

### Website
- **Bengali (বাংলা) for the whole website** with a language button in the top bar. Every screen, form, message and
  notification is translated, numbers and times are written the Bengali way (`৳১,১০০`, `বিকাল ৩:০০`), the choice is
  remembered, and text people wrote is never changed. Font: **Noto Sans Bengali** (bundled). See "Bengali" in ARCHITECTURE.md.
- **New home page.** A full-width banner photo with live counts, then browse by specialty, six featured doctors, how it
  works, hospitals and clinics, six reasons to trust Carewell, an invitation for doctors, common questions and the closing
  banner. All of it in Bengali too.
- **Doctor cards** show the head and shoulders on every card (a 3:2 photo frame instead of a wide strip), on desktop,
  tablet and phone. Three portraits were re-cropped (Tanvir Hossain, Lamia Parvin, Anika Tabassum).
- **Notification panel** is opaque so it can be read clearly; notifications open the page they are about.
- **Landing page** heading fixed ("with with") and a larger, clearer doctor photo.
- **Show password** eye on the patient and doctor sign-in pages and every "choose a password" form (not the administrator's).
- **Strong-password checklist** on sign-up, doctor registration, reset, change and invitation.

### Security
- **Strong passwords required** for every new password (10+ characters, lowercase, capital, number, symbol, no obvious words).
- **Administrator lock:** 4 wrong passwords lock the account for 30 minutes; the owner is emailed; a password reset unlocks it.
  See [ADMIN_GUIDE.md](ADMIN_GUIDE.md).
- During development the API accepts any `localhost` port, so a second copy of the website (port 5174) no longer fails with
  "This request did not come from the Carewell website." Production still trusts only `CLIENT_ORIGINS`.

### Emails
- **Every email is written in the recipient's language** (English or Bengali): verification code, password reset, doctor
  invitation, application received / approved / changes needed / rejected, profile published, support replies. An invited
  doctor, whose language is not known yet, gets both languages in one email.
- **New appointment emails:** request received, accepted, not accepted and cancelled (to the patient); new request and patient
  cancelled (to the doctor). The reason for a visit is never put in an email.
- The website sends its language with every request and the server remembers it per person (`users.language`).

### Demo data
- **Realistic experience:** each demo doctor's years of experience, degrees and fee now match how old they look in their photo.
  (An MBBS finishes at about 24; an MD or FCPS takes about 4 more years.)
- **Dr. Mahbub Alam** has a Bangladeshi photo and is an early-career general practitioner (2 years).
- Bangladeshi doctor, hospital and clinic photos for all demo data (credits in IMAGE_CREDITS.md).

### Infrastructure
- **Database moved to Neon Singapore** (faster for Bangladesh). The old Ohio project is kept untouched for rollback.
- New migration `20261026120000_login_lockout_and_language` (adds `users.failed_login_count`, `locked_until`, `language`).
- Tests: 249 server tests (15 new for passwords, the lock and email languages) and 176 client tests.
- New docs: [DEPLOYMENT.md](DEPLOYMENT.md), [ADMIN_GUIDE.md](ADMIN_GUIDE.md) and this file.

### Not built yet
SMS messages (needs a Bangladeshi SMS provider account), two-step verification, online payment, appointment reminders.
