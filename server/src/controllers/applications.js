import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { toUser, userDoctorSelect } from "../models/user.js";
import { announceApplication, formatDay, loadApplication, reapplyAt } from "../services/applications.js";
import { hashPassword, revokeAllSessions, sha256, startSession } from "../services/auth.js";
import { sendApplicationReceivedEmail } from "../services/mail.js";
import { LINKS, notifyAdmins } from "../services/notifications.js";
import { ApiError, conflict, notFound, parse } from "../utils/errors.js";
import { strongPassword } from "../utils/password.js";

/**
 * A doctor's application to join Carewell, from the doctor's side, and the invitation link that
 * administrator-added doctors use to set their password. The administrator's review lives in
 * controllers/adminApplications.js; the shared rules in services/applications.js.
 */

const HOUR = 60 * 60 * 1000;

async function ownDoctor(request) {
  const id = request.user.doctor?.id;
  const doctor = id && (await prisma.doctor.findUnique({ where: { id }, include: { certificates: true } }));
  if (!doctor) throw notFound("Your doctor profile");
  return doctor;
}

/** GET /doctor/application: status, what is still missing, the administration's note, certificates. */
export const getApplication = async (request, response) => {
  const doctor = await ownDoctor(request);
  response.json(await loadApplication(doctor.id));
};

/**
 * POST /doctor/application/submit: hands the application to the administration. Needs a confirmed
 * email and a BMDC registration certificate; allowed from in_progress or changes_requested.
 */
export const submitApplication = async (request, response) => {
  const doctor = await ownDoctor(request);
  if (!["in_progress", "changes_requested"].includes(doctor.onboardingStatus))
    throw conflict("INVALID_TRANSITION", "This application cannot be submitted right now.");
  if (!request.user.emailVerifiedAt)
    throw conflict("EMAIL_NOT_VERIFIED", "Confirm your email address with the code we sent you first.");
  if (!doctor.certificates.some((row) => row.kind === "bmdc"))
    throw new ApiError(
      422,
      "BMDC_CERTIFICATE_REQUIRED",
      "Upload your BMDC registration certificate before submitting.",
    );

  // Only one of two simultaneous submits wins.
  const claimed = await prisma.doctor.updateMany({
    where: { id: doctor.id, onboardingStatus: doctor.onboardingStatus },
    data: { onboardingStatus: "submitted", submittedAt: new Date(), decisionNote: null },
  });
  if (claimed.count === 0) throw conflict("INVALID_TRANSITION", "This application was already submitted.");

  void sendApplicationReceivedEmail({
    to: request.user.email,
    name: request.user.name,
    language: request.user.language,
  });
  await announceApplication(request.user.name);
  response.json(await loadApplication(doctor.id));
};

/** POST /doctor/application/reopen: a rejected doctor starts again, 30 days after the decision. */
export const reopenApplication = async (request, response) => {
  const doctor = await ownDoctor(request);
  const opensAt = reapplyAt(doctor);
  if (!opensAt) throw conflict("INVALID_TRANSITION", "Only a rejected application can be started again.");
  if (opensAt > new Date())
    throw conflict("REAPPLY_TOO_SOON", `You can apply again from ${formatDay(opensAt)}.`);

  await prisma.doctor.update({
    where: { id: doctor.id },
    data: {
      onboardingStatus: "in_progress",
      verificationStatus: "pending",
      decisionNote: null,
      submittedAt: null,
      bmdcCheck: "unchecked",
      bmdcCheckNote: null,
      bmdcCheckedAt: null,
      bmdcCheckedById: null,
    },
  });
  response.json(await loadApplication(doctor.id));
};

// ── Invitations (doctors added by an administrator) ────────────────────────────────────────
const invalidInvitation = () =>
  new ApiError(
    410,
    "INVITATION_INVALID",
    "This invitation link is invalid or has expired. Ask the Carewell administration to send a new one.",
  );

/** A live invitation for `token`, with its doctor and user, or a 410. */
async function findInvitation(token) {
  const invitation = await prisma.doctorInvitation.findUnique({
    where: { tokenHash: sha256(String(token ?? "")) },
    include: { doctor: { include: { user: true } } },
  });
  if (
    !invitation ||
    invitation.usedAt ||
    invitation.revokedAt ||
    invitation.expiresAt < new Date() ||
    invitation.doctor.onboardingStatus !== "invited" ||
    ["suspended", "deactivated"].includes(invitation.doctor.user.accountStatus)
  )
    throw invalidInvitation();
  return invitation;
}

/** GET /auth/doctor/invitation?token=…: who the link is for, so the page can greet them. */
export const getInvitation = async (request, response) => {
  rateLimit(`invitation:${request.ip}`, 30, HOUR);
  const invitation = await findInvitation(request.query.token);
  response.json({
    name: invitation.doctor.user.name,
    email: invitation.doctor.user.email,
    expiresAt: invitation.expiresAt.toISOString(),
  });
};

const acceptSchema = z.object({
  token: z.string().min(1, "This invitation link is incomplete."),
  password: strongPassword,
});

/**
 * POST /auth/doctor/invitation/accept { token, password }: sets the password, confirms the email
 * (the link proves it), moves the application to in_progress and signs the doctor in.
 */
export const acceptInvitation = async (request, response) => {
  rateLimit(`invitation:${request.ip}`, 30, HOUR);
  const { token, password } = parse(acceptSchema, request.body);
  const invitation = await findInvitation(token);

  // Claim the link first: of two simultaneous requests only one can win.
  const claimed = await prisma.doctorInvitation.updateMany({
    where: { id: invitation.id, usedAt: null, revokedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) throw invalidInvitation();

  const userId = invitation.doctor.userId;
  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(password),
        emailVerifiedAt: invitation.doctor.user.emailVerifiedAt ?? new Date(),
      },
    }),
    prisma.doctor.update({ where: { id: invitation.doctorId }, data: { onboardingStatus: "in_progress" } }),
  ]);
  await revokeAllSessions(userId);
  await startSession(request, response, userId);
  await notifyAdmins({
    kind: "doctor",
    title: "An invited doctor set up their account",
    body: `${user.name} accepted the invitation and is completing their application.`,
    link: LINKS.adminVerification,
  });
  const signedIn = await prisma.user.findUnique({
    where: { id: userId },
    include: { doctor: { select: userDoctorSelect } },
  });
  response.json({ user: toUser(signedIn) });
};
