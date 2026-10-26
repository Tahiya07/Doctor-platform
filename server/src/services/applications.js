import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { ApiError } from "../utils/errors.js";
import { dayText } from "./language.js";
import { sha256 } from "./auth.js";
import { discardUpload, saveUpload } from "./files.js";
import { sendDoctorInvitationEmail, sendNewApplicationEmail } from "./mail.js";
import { LINKS, notifyAdmins } from "./notifications.js";

/**
 * Rules shared by the doctor's side of an application and the administrator's review.
 *
 *   Self-application: register → confirm email (6-digit code) → profile + BMDC certificate → submit
 *   Invitation:       admin adds the doctor → emailed link (48 h) → password → profile + BMDC certificate → submit
 *   Review:           admin compares the BMDC certificate with the BMDC register → approve, ask for changes or reject
 */

export const INVITATION_HOURS = 48;
export const REAPPLY_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** Where an application can still be edited by the doctor. */
export const EDITABLE = ["in_progress", "changes_requested", "approved"];

/** Profile and certificate changes are frozen while the administration reviews, and after a rejection. */
export function assertApplicationOpen(doctor) {
  if (doctor.onboardingStatus === "submitted")
    throw new ApiError(
      409,
      "APPLICATION_LOCKED",
      "Your application is with the administration. You can make changes if they ask for them.",
    );
  if (doctor.onboardingStatus === "rejected")
    throw new ApiError(
      409,
      "APPLICATION_LOCKED",
      "Your application was not approved. Start a new application when reapplying opens.",
    );
}

/** The first moment a rejected doctor may apply again (null when that does not apply). */
export const reapplyAt = (doctor) =>
  doctor.onboardingStatus === "rejected" && doctor.decidedAt
    ? new Date(doctor.decidedAt.getTime() + REAPPLY_DAYS * DAY)
    : null;

export const formatDay = (date, language = "en") => dayText(language, date);

/** Links inside emails (the website uses hash routing). */
export const appLink = (path) => `${env.appUrl}#${path}`;

export const toCertificate = (row) => ({
  id: row.id,
  fileName: row.fileName,
  kind: row.kind,
  uploadedAt: row.uploadedAt.toISOString(),
});

/** What the doctor sees about their own application. Administrator notes about the BMDC check stay private. */
export function toApplication(doctor, user, certificates) {
  const hasBmdcCertificate = certificates.some((row) => row.kind === "bmdc");
  return {
    status: doctor.onboardingStatus,
    emailVerified: Boolean(user.emailVerifiedAt),
    hasBmdcCertificate,
    canSubmit:
      ["in_progress", "changes_requested"].includes(doctor.onboardingStatus) &&
      Boolean(user.emailVerifiedAt) &&
      hasBmdcCertificate,
    submittedAt: doctor.submittedAt?.toISOString(),
    decidedAt: doctor.decidedAt?.toISOString(),
    note: doctor.decisionNote ?? undefined,
    reapplyAt: reapplyAt(doctor)?.toISOString(),
    certificates: certificates.map(toCertificate),
  };
}

/** Loads the signed-in doctor's application. */
export async function loadApplication(doctorId) {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: { user: true, certificates: { orderBy: { uploadedAt: "asc" } } },
  });
  return toApplication(doctor, doctor.user, doctor.certificates);
}

/** The administrator's view: everything above plus the BMDC check and the invitation. */
export async function adminApplications(doctorIds) {
  const rows = await prisma.doctor.findMany({
    where: { id: { in: doctorIds } },
    include: {
      user: true,
      bmdcCheckedBy: { select: { name: true } },
      invitations: { where: { usedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return new Map(
    rows.map((doctor) => [
      doctor.id,
      {
        status: doctor.onboardingStatus,
        emailVerified: Boolean(doctor.user.emailVerifiedAt),
        submittedAt: doctor.submittedAt?.toISOString(),
        decidedAt: doctor.decidedAt?.toISOString(),
        note: doctor.decisionNote ?? undefined,
        reapplyAt: reapplyAt(doctor)?.toISOString(),
        bmdcCheck: {
          result: doctor.bmdcCheck,
          note: doctor.bmdcCheckNote ?? undefined,
          checkedAt: doctor.bmdcCheckedAt?.toISOString(),
          checkedBy: doctor.bmdcCheckedBy?.name,
        },
        invitationExpiresAt:
          doctor.onboardingStatus === "invited" ? doctor.invitations[0]?.expiresAt.toISOString() : undefined,
      },
    ]),
  );
}

/**
 * Emails a fresh single-use invitation link to an invited doctor; older links stop working.
 * Resolves the expiry time.
 */
export async function issueInvitation({ doctorId, user, invitedById }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_HOURS * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.doctorInvitation.updateMany({
      where: { doctorId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.doctorInvitation.create({
      data: { doctorId, tokenHash: sha256(token), expiresAt, invitedById },
    }),
  ]);
  void sendDoctorInvitationEmail({
    to: user.email,
    name: user.name,
    link: appLink(`/doctor/invitation?token=${token}`),
    hours: INVITATION_HOURS,
  });
  return expiresAt;
}

/** Bell notification and email for every active administrator: a new application is waiting. */
export async function announceApplication(doctorName) {
  await notifyAdmins({
    kind: "doctor",
    title: "New doctor application",
    body: `${doctorName} submitted an application. Check their BMDC certificate.`,
    link: LINKS.adminVerification,
  });
  try {
    const admins = await prisma.user.findMany({
      where: { role: "admin", accountStatus: "active" },
      select: { email: true, language: true },
    });
    for (const admin of admins)
      void sendNewApplicationEmail({
        to: admin.email,
        doctorName,
        link: appLink(LINKS.adminVerification),
        language: admin.language,
      });
  } catch (error) {
    console.error(`[applications] could not email administrators: ${error.message}`);
  }
}

// ── Certificates ───────────────────────────────────────────────────────────────────────────
export const MAX_CERTIFICATES = 5;
export const CERTIFICATE_KINDS = ["bmdc", "degree", "other"];

/** The multipart text field `kind` (default "other"). */
export function certificateKind(value) {
  const kind = value ?? "other";
  if (!CERTIFICATE_KINDS.includes(kind))
    throw new ApiError(422, "VALIDATION_FAILED", "Choose what kind of certificate this is.", {
      kind: "Choose BMDC registration, degree or other.",
    });
  return kind;
}

/** A new or removed BMDC certificate means the earlier comparison no longer applies. */
export const resetBmdcCheck = (doctorId) =>
  prisma.doctor.update({
    where: { id: doctorId },
    data: { bmdcCheck: "unchecked", bmdcCheckNote: null, bmdcCheckedAt: null, bmdcCheckedById: null },
  });

/** Stores one uploaded certificate (PDF or image) for a doctor and resolves the database row. */
export async function storeCertificate(doctor, file, kind) {
  if ((await prisma.doctorCertificate.count({ where: { doctorId: doctor.id } })) >= MAX_CERTIFICATES)
    throw new ApiError(
      409,
      "TOO_MANY_FILES",
      `You can upload at most ${MAX_CERTIFICATES} certificate files. Remove one first.`,
    );
  const stored = await saveUpload(`certificates/${doctor.id}`, file);
  try {
    const row = await prisma.doctorCertificate.create({
      data: { doctorId: doctor.id, storageKey: stored.storageKey, fileName: stored.fileName, kind },
    });
    if (kind === "bmdc" && doctor.onboardingStatus !== "approved") await resetBmdcCheck(doctor.id);
    return row;
  } catch (error) {
    await discardUpload(stored.storageKey); // never leave a file nobody can find
    throw error;
  }
}

// ── The administrator's doctor list ────────────────────────────────────────────────────────
const certificateUrl = (doctorId, id) => `/api/v1/admin/doctors/${doctorId}/certificates/${id}`;

/**
 * Adds what only administrators see to doctors from models/doctor.js: `certificateFiles` (with a
 * download URL) and `application` (status, BMDC check, invitation).
 */
export async function withReviewDetails(doctors) {
  const ids = doctors.map((doctor) => doctor.id);
  const [rows, applications] = await Promise.all([
    prisma.doctorCertificate.findMany({ where: { doctorId: { in: ids } }, orderBy: { uploadedAt: "asc" } }),
    adminApplications(ids),
  ]);
  const files = new Map();
  for (const row of rows)
    files.set(row.doctorId, [
      ...(files.get(row.doctorId) ?? []),
      { ...toCertificate(row), url: certificateUrl(row.doctorId, row.id) },
    ]);
  return doctors.map((doctor) => ({
    ...doctor,
    certificateFiles: files.get(doctor.id) ?? [],
    application: applications.get(doctor.id),
  }));
}
