import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { findDoctors } from "../models/doctor.js";
import { withReviewDetails } from "../services/applications.js";
import { revokeAllSessions } from "../services/auth.js";
import { sendStoredFile } from "../services/files.js";
import { sendSupportReplyEmail } from "../services/mail.js";
import { LINKS, notify, notifyDoctor, preview } from "../services/notifications.js";
import { ApiError, conflict, notFound, parse, uuid } from "../utils/errors.js";

/**
 * Administrator screens for doctor onboarding and support: certificates, deactivation requests
 * and support requests. Mounted at /admin BEFORE the main admin router (see routes/index.js),
 * so the doctor list below, which adds `certificateFiles`, answers GET /admin/doctors.
 */

const toJson = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const audit = (request, action, entityType, entityId, before, after) =>
  prisma.auditLog.create({
    data: {
      actorId: request.user.id,
      action,
      entityType,
      entityId,
      before: toJson(before),
      after: toJson(after),
    },
  });

// ── Doctors with their certificates ───────────────────────────────────────────────────────
/** GET /admin/doctors: every doctor, with `certificateFiles` and `application` for the review screens. */
export const listDoctorsWithCertificates = async (request, response) => {
  response.json(await withReviewDetails(await findDoctors()));
};

/** GET /admin/doctors/:id/certificates/:fileId: opens one uploaded certificate. */
export const downloadCertificate = async (request, response) => {
  const doctorId = uuid(request.params.id, "This doctor profile");
  const row = await prisma.doctorCertificate.findFirst({
    where: { id: uuid(request.params.fileId, "This certificate"), doctorId },
  });
  if (!row) throw notFound("This certificate");
  await sendStoredFile(response, row, { inline: true });
};

// ── Deactivation requests ─────────────────────────────────────────────────────────────────
const toDeactivation = (row) => ({
  id: row.id,
  doctorId: row.doctorId,
  doctorName: row.doctor.user.name,
  doctorEmail: row.doctor.user.email,
  reason: row.reason,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  decidedAt: row.decidedAt?.toISOString(),
});
const deactivationInclude = { doctor: { include: { user: true } } };

/** GET /admin/deactivation-requests?status=open|approved|declined (default: open). */
export const listDeactivationRequests = async (request, response) => {
  const { status } = parse(
    z.object({ status: z.enum(["open", "approved", "declined"]).default("open") }),
    request.query,
  );
  const rows = await prisma.deactivationRequest.findMany({
    where: { status },
    include: deactivationInclude,
    orderBy: { createdAt: "desc" },
  });
  response.json(rows.map(toDeactivation));
};

/** Marks an open request as decided; of two simultaneous decisions only one can win. */
async function decide(request, status) {
  const id = uuid(request.params.id, "This request");
  const found = await prisma.deactivationRequest.findUnique({ where: { id }, include: deactivationInclude });
  if (!found) throw notFound("This request");
  const claimed = await prisma.deactivationRequest.updateMany({
    where: { id, status: "open" },
    data: { status, decidedById: request.user.id, decidedAt: new Date() },
  });
  if (claimed.count === 0) throw conflict("ALREADY_DECIDED", "This request has already been decided.");
  return found;
}

/** Approving deactivates the account, hides the profile and ends the doctor's sessions. */
export const approveDeactivation = async (request, response) => {
  const found = await decide(request, "approved");
  await prisma.$transaction([
    prisma.user.update({ where: { id: found.doctor.userId }, data: { accountStatus: "deactivated" } }),
    prisma.doctor.update({ where: { id: found.doctorId }, data: { publicationStatus: "inactive" } }),
  ]);
  await revokeAllSessions(found.doctor.userId);
  await audit(
    request,
    "deactivation.approve",
    "doctor",
    found.doctorId,
    { accountStatus: found.doctor.user.accountStatus },
    { accountStatus: "deactivated" },
  );
  // The account is closed now; this waits for the doctor if the account is ever reactivated.
  await notifyDoctor(found.doctorId, {
    kind: "account",
    title: "Your account was deactivated",
    body: "The administration approved your deactivation request.",
  });
  const row = await prisma.deactivationRequest.findUnique({
    where: { id: found.id },
    include: deactivationInclude,
  });
  response.json(toDeactivation(row));
};

/** Declining returns the doctor to a normal active account. */
export const declineDeactivation = async (request, response) => {
  const found = await decide(request, "declined");
  await prisma.user.updateMany({
    where: { id: found.doctor.userId, accountStatus: "deactivation_requested" },
    data: { accountStatus: "active" },
  });
  await audit(request, "deactivation.decline", "doctor", found.doctorId, undefined, {
    accountStatus: "active",
  });
  await notifyDoctor(found.doctorId, {
    kind: "account",
    title: "Deactivation request declined",
    body: "Your account stays active. Message the administration if you have questions.",
    link: LINKS.messages,
  });
  const row = await prisma.deactivationRequest.findUnique({
    where: { id: found.id },
    include: deactivationInclude,
  });
  response.json(toDeactivation(row));
};

// ── Support requests ──────────────────────────────────────────────────────────────────────
const STATUSES = ["received", "in_progress", "resolved"];
const supportInclude = { user: { select: { name: true, email: true, language: true } } };
const toSupport = (row) => ({
  id: row.id,
  message: row.message,
  email: row.email ?? row.user?.email ?? undefined,
  userName: row.user?.name,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
});

/** GET /admin/support-requests?status=: newest first, at most 200. */
export const listSupportRequests = async (request, response) => {
  const { status } = parse(z.object({ status: z.enum(STATUSES).optional() }), request.query);
  const rows = await prisma.supportRequest.findMany({
    where: status ? { status } : {},
    include: supportInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  response.json(rows.map(toSupport));
};

export const updateSupportRequest = async (request, response) => {
  const id = uuid(request.params.id, "This request");
  const { status } = parse(z.object({ status: z.enum(STATUSES) }), request.body);
  const before = await prisma.supportRequest.findUnique({ where: { id } });
  if (!before) throw notFound("This request");
  const row = await prisma.supportRequest.update({
    where: { id },
    data: { status },
    include: supportInclude,
  });
  await audit(request, "support.status", "support_request", id, { status: before.status }, { status });
  if (before.userId && status !== before.status)
    await notify(before.userId, {
      kind: "support",
      title:
        status === "resolved" ? "Your support request was resolved" : "Your support request is being handled",
      body: preview(before.message),
      link: LINKS.messages,
    });
  response.json(toSupport(row));
};

/** POST /admin/support-requests/:id/reply { message, resolve? }: emails the person and (by default) marks it resolved. */
export const replyToSupportRequest = async (request, response) => {
  const id = uuid(request.params.id, "This request");
  const { message, resolve } = parse(
    z.object({
      message: z.string().trim().min(2, "Write a reply.").max(4000),
      resolve: z.boolean().default(true),
    }),
    request.body,
  );
  const found = await prisma.supportRequest.findUnique({ where: { id }, include: supportInclude });
  if (!found) throw notFound("This request");
  const to = found.email ?? found.user?.email;
  if (!to)
    throw new ApiError(
      422,
      "NO_ADDRESS",
      "This person left no email address, so there is nobody to reply to.",
    );

  const sent = await sendSupportReplyEmail({
    to,
    language: found.user?.language,
    name: found.user?.name,
    message,
    original: found.message,
  });
  if (!sent) throw new ApiError(502, "EMAIL_FAILED", "The reply could not be sent. Please try again.");

  const row = await prisma.supportRequest.update({
    where: { id },
    data: { status: resolve ? "resolved" : "in_progress" },
    include: supportInclude,
  });
  await audit(
    request,
    "support.reply",
    "support_request",
    id,
    { status: found.status },
    { status: row.status, reply: message },
  );
  if (found.userId)
    await notify(found.userId, {
      kind: "support",
      title: "Carewell support replied",
      body: preview(message),
      link: LINKS.messages,
    });
  response.json(toSupport(row));
};
