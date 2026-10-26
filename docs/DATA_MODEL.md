# Data model

The source of truth is [`server/prisma/schema.prisma`](../server/prisma/schema.prisma) (PostgreSQL on Neon). This page
explains the design, how it lines up with the API contract in [`API_CONTRACT.md`](API_CONTRACT.md), and the rules to
follow when changing it.

## Principles

- **Names match the API.** Field and enum names follow the contract, so the server can return rows with little or no
  renaming and the React client needs no changes.
- **Lower-case enum values** (`pending`, `accepted`, …). Prisma returns exactly what the API sends: no case conversion.
- **Derived values are not stored:** `nextAvailable`, the `Today / Tomorrow / This week` buckets, the `booked` slot
  state, unread counts, `emailVerified`. Storing them would let them drift out of sync.
- **The database refuses bad data.** Rules that must hold under concurrency (no double booking, no overlapping slots,
  consistent slot / doctor / clinic) are constraints, not just application checks.

## Entities and relationships

```text
User ──1:0..1── Doctor ──N:1── Specialty
  │                │
  │                ├──N:M── Clinic            (via DoctorClinic: optional per-clinic fee)
  │                │
  │                └──1:N── AvailabilitySlot ──(doctor + clinic must be a DoctorClinic pair)
  │                              │
  │ (patient)                    └──1:N── Appointment ──N:1── User (patient)
  │                                          doctorId + clinicId must match the slot
  │
  ├──1:N── Session · EmailVerification · PasswordReset · SupportRequest · AuditLog (actor)
  │
  └── Conversation (patient + doctor, or doctor + admin) ──1:N── Message ──1:N── MessageAttachment

Doctor ──1:N── DoctorCertificate · DeactivationRequest · Review ──N:1── User (patient)
Doctor ──1:N── DoctorInvitation (single-use, 48-hour links for doctors an administrator adds)
```

**Joining (doctor applications).** `Doctor.onboardingStatus` tracks the application: `invited → in_progress →
submitted → approved`, or `submitted → changes_requested → submitted`, or `→ rejected` (reapply 30 days after
`decidedAt`). Only `approved` doctors reach appointments and availability. `decisionNote` is the message shown to the
doctor. `bmdcCheck` (+ `bmdcCheckNote`, `bmdcCheckedAt`, `bmdcCheckedById`) records an administrator's manual
comparison of the BMDC certificate (`DoctorCertificate.kind = bmdc`) with the BMDC register; approval needs `matched`.
The migration marks existing verified or suspended doctors `approved`, rejected ones `rejected`, and pending ones
`submitted`.

| Relationship | Delete behaviour | Why |
| --- | --- | --- |
| User → Doctor | cascade | A doctor profile cannot exist without its account. |
| Doctor → DoctorClinic, slots, certificates, requests | cascade | Owned data. |
| Doctor → Appointment | **restrict** | History must not vanish. Deactivate (`accountStatus`, `publicationStatus: inactive`) instead of deleting. |
| Patient (User) → Appointment | **restrict** | Same. |
| Slot → Appointment | **restrict** | A slot with requests cannot be deleted. |
| DoctorClinic → Slot | **no action** | A clinic link cannot be removed while the doctor still has slots there. |
| Clinic → anything | **restrict** | Deactivate clinics (`active = false`) instead of deleting. |
| Conversation → Message → Attachment | cascade | Owned data. |
| Doctor / patient → Review | cascade | A review belongs to the visit's patient and doctor; deleting an account removes its reviews. |
| User → Session / codes / tokens | cascade | Owned data. |
| Actor / decider on AuditLog, DeactivationRequest, SupportRequest | set null | Keep the record if the user is removed. |

### The booking chain

`Appointment (slotId, doctorId, clinicId) → AvailabilitySlot (id, doctorId, clinicId)` is a **composite foreign key**, and
`AvailabilitySlot (doctorId, clinicId) → DoctorClinic`. Together they guarantee an appointment can only reference a slot
that belongs to that doctor, at a clinic where that doctor actually practises. `doctorId` and `clinicId` repeat the
slot's values only so lists can filter without a join. Date and time are **not** copied: they come from the slot.

Consequence for the product: **patients can only book slots that a doctor (or an admin) has created.** The demo's fixed
"4:30 PM / 5:30 PM …" times exist only in demo mode.

## Rules enforced by the database

Written as SQL in the migration, because Prisma cannot express them in the schema file.

| Rule | Mechanism | API error to map it to |
| --- | --- | --- |
| At most one **accepted** request per slot (pending requests can queue) | partial unique index `appointments_one_accepted_per_slot` | `409 APPOINTMENT_CONFLICT` |
| No overlapping bookable slots for one doctor at one clinic (blocked slots may overlap) | exclusion constraint `slots_no_overlap` | `409 SLOT_OVERLAP` |
| A slot starts before it ends | check `slots_time_order` | `422` |
| Only verified profiles can be published | check `doctors_published_requires_verified` | `409 NOT_VERIFIED` |
| Fee ≥ 0, experience 0–60 years | checks | `422` |
| A patient thread has a patient; the admin thread has none; one admin thread per doctor | check + partial unique index | `409` |
| One thread per patient and doctor | unique `(doctorId, patientId)` | handled by "find or create" |
| Message ≤ 2000 characters, attachment ≤ 10 MB | checks | `422` |
| Review rating 1–5, comment ≤ 1000 characters, one review per patient and doctor | checks + unique `(patientId, doctorId)` | `422` / `409 ALREADY_REVIEWED` |

When one of these fires, catch the Prisma error (`P2002` unique, `P2003` foreign key, or a raw constraint name from the
error message) and translate it to the API error above.

## How API fields map to the database

| API (contract) | Database | Notes |
| --- | --- | --- |
| `user.name`, `user.email`, `user.phone` | `users.name / email / phone` | Store email lower-cased. |
| `user.emailVerified` | `users.emailVerifiedAt IS NOT NULL` | |
| `user.accountStatus`, `doctor.accountStatus` | `users.accountStatus` | |
| `doctor.name`, `doctor.email` | the doctor's `User` row | Join `doctor.user`. |
| `doctor.specialtyId` / `doctor.specialty` | `doctors.specialtyId` / `specialties.name` | `Specialty.id` is the slug, e.g. `cardiology`. |
| `doctor.qualifications` | `doctors.qualifications` (`text[]`) | |
| `doctor.fee`, `doctor.feesByFacility` | `doctors.fee`, `doctor_clinics.fee` | Whole BDT; map `{ [clinicId]: fee }` for non-null fees. |
| `doctor.facilityIds` | `doctor_clinics.clinicId` | |
| `doctor.verificationStatus`, `publicationStatus`, `profileReviewRequired` | same columns | |
| `doctor.nextAvailable`, `doctor.availability` | **derived** from future slots without an accepted appointment | |
| `facility.*` | `clinics` | API path is `/clinics`. `distanceKm` is optional/derived from `latitude`/`longitude`. |
| `slot.date`, `startTime`, `endTime` | `availability_slots.date / startTime / endTime` | Clinic local time (Asia/Dhaka). Format `YYYY-MM-DD` and `HH:mm`. |
| `slot.status` (`available`/`booked`/`unavailable`) | stored `available`/`unavailable`; `booked` = has an accepted appointment | |
| `appointment.date`, `time` | the slot's date and start time | `time` is shown as `5:30 PM`. |
| `appointment.doctor`, `appointment.facility` | joins on `doctor.user` and `clinic` | |
| `appointment.relationship`, `patientName`, `phone`, `email`, `reason` | same columns on `appointments` | |
| `conversation.canMessage` | an `accepted` appointment exists for this patient and doctor (always true for the admin thread) | Computed, not stored. |
| `conversation.unread` | count of messages from others with `readAt IS NULL` | |
| `message.sender`, `isMine` | `message.sender.role`, `senderId = current user` | |
| `message.sentAt`, `readAt` | `createdAt`, `readAt` | |
| `attachmentUrl` | signed URL built from `message_attachments.storageKey` | Bucket is private. |
| *(not in the API)* | `users.language` (`en` or `bn`) | The language of the emails this person receives; kept in step with the website's language button (`X-Language` header). |
| *(not in the API)* | `users.failedLoginCount`, `users.lockedUntil` | Administrator sign-in lock: the 4th wrong password sets `lockedUntil` 30 minutes ahead (see docs/ADMIN_GUIDE.md). |
| `user.photoUrl` | `users.photoKey` (storage key) + `users.photoUpdatedAt` | URL is built as `/api/v1/photos/users/<id>?v=<photoUpdatedAt>`; the file is in the private bucket. |
| `doctor.rating`, `doctor.reviewCount` | `AVG(reviews.rating)` / `COUNT(*)` over `reviews` where `status = visible` | Computed per request; 0 when there are none. |
| `review.*` | `reviews` (`rating`, `comment`, `status` visible\|hidden) | `author` is shown as the patient's first name and last initial. |
| `adminSummary.*` | counts and a monthly `GROUP BY` | No table needed. |

## Working with the schema

- **Always use migrations.** Change `schema.prisma`, run `npx prisma migrate dev --name <change>` locally, review the SQL,
  commit it, and deploy with `npx prisma migrate deploy`. **Never** use `prisma db push`: it would drop the SQL-only rules
  above because Prisma does not know about them. If you add another SQL-only rule, append it to the migration by hand.
- **IDs are generated by Prisma Client**, not the database. Raw SQL inserts (the Neon console, seed scripts) must supply an
  id, e.g. `gen_random_uuid()`.
- **Do not edit an applied migration.** Add a new one.
- **Develop against a Neon branch, not `production`.** `neon.ts` already supports per-branch settings.
- **Dates:** timestamps are `timestamptz` (UTC). Slot `date` / `startTime` / `endTime` are clinic-local on purpose, so the
  UI and the database agree and no time-zone conversion is needed.

## Decisions to revisit

- One specialty per doctor (the UI shows one). Supporting several means adding a join table back.
- One conversation per patient and doctor, shared across visits.
- No doctor languages (removed from the product).
- `Session` serves both cookie sessions and refresh tokens, so the cookie-versus-JWT choice does not change the schema.
