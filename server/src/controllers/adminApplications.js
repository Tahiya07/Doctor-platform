import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { findDoctor } from "../models/doctor.js";
import {
  appLink,
  certificateKind,
  formatDay,
  issueInvitation,
  reapplyAt,
  storeCertificate,
  withReviewDetails,
} from "../services/applications.js";
import { audit } from "../services/audit.js";
import { sendApplicationDecisionEmail } from "../services/mail.js";
import { LINKS, notifyDoctor } from "../services/notifications.js";
import { ApiError, conflict, notFound, parse, uuid } from "../utils/errors.js";

/**
 * The administrator's review of doctor applications: comparing the BMDC certificate with the BMDC
 * register, then approving, asking for changes or rejecting; resending invitations; and adding a
 * certificate on a doctor's behalf. Mounted at /admin.
 *
 * BMDC offers no API, so the comparison is done by a person: the screen links to the BMDC search,
 * and the result is recorded here with who checked and when. Approval needs a "matched" result.
 */

async function loadDoctor(request) {
  const id = uuid(request.params.id, "This doctor profile");
  const doctor = await prisma.doctor.findUnique({
    where: { id },
    include: { user: true, certificates: true },
  });
  if (!doctor) throw notFound("This doctor profile");
  return doctor;
}

/** The doctor as the administrator screens show it. */
const adminDoctor = async (id) => (await withReviewDetails([await findDoctor(id)]))[0];

const note = (message) => z.string().trim().min(5, message).max(2000);

// ── PATCH /admin/doctors/:id/bmdc-check { result, note? } ─────────────────────────────────
const checkSchema = z.object({
  result: z.enum(["matched", "not_found", "mismatch"], {
    error: "Choose matched, not found or details don't match.",
  }),
  note: z.string().trim().max(2000).optional(),
});

export const recordBmdcCheck = async (request, response) => {
  const doctor = await loadDoctor(request);
  const input = parse(checkSchema, request.body);
  if (!doctor.certificates.some((row) => row.kind === "bmdc"))
    throw new ApiError(
      422,
      "BMDC_CERTIFICATE_REQUIRED",
      "There is no BMDC registration certificate to check yet.",
    );
  if (input.result !== "matched" && !input.note)
    throw new ApiError(422, "VALIDATION_FAILED", "Say what did not match.", {
      note: "Say what did not match.",
    });

  await prisma.doctor.update({
    where: { id: doctor.id },
    data: {
      bmdcCheck: input.result,
      bmdcCheckNote: input.note || null,
      bmdcCheckedAt: new Date(),
      bmdcCheckedById: request.user.id,
    },
  });
  await audit(
    request,
    "doctor.bmdc_check",
    "doctor",
    doctor.id,
    { bmdcCheck: doctor.bmdcCheck },
    { bmdcCheck: input.result, note: input.note },
  );
  response.json(await adminDoctor(doctor.id));
};

// ── Decisions ──────────────────────────────────────────────────────────────────────────────
/** Records the decision, then tells the doctor in the app and by email. */
async function decide(request, doctor, { status, data, decision, decisionNote, title, body }) {
  // Only one of two simultaneous decisions wins.
  const claimed = await prisma.doctor.updateMany({
    where: { id: doctor.id, onboardingStatus: doctor.onboardingStatus },
    data: { onboardingStatus: status, decidedAt: new Date(), decisionNote: decisionNote ?? null, ...data },
  });
  if (claimed.count === 0) throw conflict("INVALID_TRANSITION", "Another administrator just decided this.");

  const after = await prisma.doctor.findUnique({ where: { id: doctor.id } });
  await audit(
    request,
    `doctor.application.${decision}`,
    "doctor",
    doctor.id,
    { onboardingStatus: doctor.onboardingStatus, verificationStatus: doctor.verificationStatus },
    { onboardingStatus: status, verificationStatus: after.verificationStatus, note: decisionNote },
  );
  const reapplyDate = reapplyAt(after);
  const link = status === "approved" ? LINKS.doctorDashboard : LINKS.doctorApplication;
  await notifyDoctor(doctor.id, { kind: "doctor", title, body, link });
  void sendApplicationDecisionEmail({
    to: doctor.user.email,
    name: doctor.user.name,
    decision,
    note: decisionNote,
    reapplyDate: reapplyDate && formatDay(reapplyDate, doctor.user.language),
    language: doctor.user.language,
    link: appLink(link),
  });
}

/** POST /admin/doctors/:id/application/approve: needs a submitted application and a matched BMDC check. */
export const approveApplication = async (request, response) => {
  const doctor = await loadDoctor(request);
  if (doctor.onboardingStatus !== "submitted")
    throw conflict("INVALID_TRANSITION", "Only a submitted application can be approved.");
  if (doctor.bmdcCheck !== "matched")
    throw conflict(
      "BMDC_NOT_MATCHED",
      "Record a matched BMDC check before approving: compare the certificate with the BMDC register.",
    );
  await decide(request, doctor, {
    status: "approved",
    decision: "approved",
    data: { verificationStatus: "verified", profileReviewRequired: false },
    title: "Your application was approved",
    body: "Your workspace is open. Your profile becomes visible to patients once it is published.",
  });
  response.json(await adminDoctor(doctor.id));
};

/** POST /admin/doctors/:id/application/request-changes { note }: back to the doctor with what to fix. */
export const requestChanges = async (request, response) => {
  const doctor = await loadDoctor(request);
  const input = parse(z.object({ note: note("Tell the doctor what to change.") }), request.body);
  if (doctor.onboardingStatus !== "submitted")
    throw conflict("INVALID_TRANSITION", "Only a submitted application can be sent back.");
  await decide(request, doctor, {
    status: "changes_requested",
    decision: "changes_requested",
    decisionNote: input.note,
    title: "Your application needs changes",
    body: input.note,
  });
  response.json(await adminDoctor(doctor.id));
};

/** POST /admin/doctors/:id/application/reject { note }: the doctor may apply again after 30 days. */
export const rejectApplication = async (request, response) => {
  const doctor = await loadDoctor(request);
  const input = parse(z.object({ note: note("Give the doctor a reason.") }), request.body);
  if (!["submitted", "changes_requested"].includes(doctor.onboardingStatus))
    throw conflict("INVALID_TRANSITION", "Only an application under review can be rejected.");
  await decide(request, doctor, {
    status: "rejected",
    decision: "rejected",
    decisionNote: input.note,
    data: { verificationStatus: "rejected", publicationStatus: "unpublished" },
    title: "Your application was not approved",
    body: input.note,
  });
  response.json(await adminDoctor(doctor.id));
};

// ── POST /admin/doctors/:id/invitation: a fresh 48-hour link for an invited doctor ──────────
export const resendInvitation = async (request, response) => {
  const doctor = await loadDoctor(request);
  if (doctor.onboardingStatus !== "invited")
    throw conflict("INVALID_TRANSITION", "This doctor has already set up their account.");
  await issueInvitation({ doctorId: doctor.id, user: doctor.user, invitedById: request.user.id });
  await audit(request, "doctor.invitation", "doctor", doctor.id);
  response.json(await adminDoctor(doctor.id));
};

// ── POST /admin/doctors/:id/certificates (multipart kind + file): on the doctor's behalf ─────
/** For a doctor the administration knows personally: they can hand over the BMDC certificate. */
export const uploadCertificate = async (request, response) => {
  const doctor = await loadDoctor(request);
  const row = await storeCertificate(doctor, request.file, certificateKind(request.body?.kind));
  await audit(request, "doctor.certificate.upload", "doctor", doctor.id, undefined, {
    fileName: row.fileName,
    kind: row.kind,
  });
  response.status(201).json(await adminDoctor(doctor.id));
};
