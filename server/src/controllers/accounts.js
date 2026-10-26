import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { toUser, userDoctorSelect } from "../models/user.js";
import {
  hashPassword,
  revokeAllSessions,
  revokeOtherSessions,
  startSession,
  verifyPassword,
} from "../services/auth.js";
import { codeHash, issueVerificationCode } from "../services/emailCodes.js";
import { sendPasswordResetEmail } from "../services/mail.js";
import { LINKS, notify } from "../services/notifications.js";
import { ApiError, parse } from "../utils/errors.js";
import { strongPassword } from "../utils/password.js";

/**
 * Account lifecycle: patient sign-up, email verification, forgotten password, profile and
 * password change. Mounted at /api/v1/auth next to the sign-in routes.
 */

const MAX_CODE_ATTEMPTS = 5;
const RESEND_SECONDS = 30;
const RESET_MINUTES = 60;
const HOUR = 60 * 60 * 1000;
const BLOCKED = ["suspended", "deactivated"];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sameHash = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60 * 1000);
const withDoctor = { doctor: { select: userDoctorSelect } };

// ── Shared field rules (the client checks the same things for fast feedback) ──────────────
const name = z.string().trim().min(2, "Enter your full name.").max(120, "That name is too long.");
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."))
  .pipe(z.string().max(254));
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{8,18}$/, "Enter a valid phone number.");
const newPassword = strongPassword;

// ── POST /auth/patient/register ───────────────────────────────────────────────────────────
const registerSchema = z.object({ name, email, phone, password: newPassword });

export const registerPatient = async (request, response) => {
  rateLimit(
    `register:${request.ip}`,
    10,
    HOUR,
    "Too many accounts were created from this connection. Try again later.",
  );
  const input = parse(registerSchema, request.body);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      role: "patient",
      language: request.language ?? "en",
    },
  });
  await startSession(request, response, user.id);
  await issueVerificationCode(user);
  response.status(201).json({ user: toUser(user) });
};

export const verifyEmail = async (request, response) => {
  const { code } = parse(
    z.object({
      code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, "Enter the 6-digit code."),
    }),
    request.body,
  );
  const user = request.user;
  if (user.emailVerifiedAt) return response.json({ user: toUser(user) });

  const pending = await prisma.emailVerification.findFirst({
    where: { userId: user.id, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!pending || pending.expiresAt < new Date())
    throw new ApiError(410, "CODE_EXPIRED", "That code has expired. Request a new one.");
  if (pending.attempts >= MAX_CODE_ATTEMPTS)
    throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Too many wrong codes. Request a new one.");

  if (!sameHash(pending.codeHash, codeHash(user.id, code))) {
    await prisma.emailVerification.update({
      where: { id: pending.id },
      data: { attempts: { increment: 1 } },
    });
    throw new ApiError(422, "INVALID_CODE", "That code isn’t right. Check your email and try again.");
  }

  const [, verified] = await prisma.$transaction([
    prisma.emailVerification.update({ where: { id: pending.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
      include: withDoctor,
    }),
  ]);
  await notify(
    user.id,
    user.role === "doctor"
      ? {
          kind: "account",
          title: "Email verified",
          body: "Next, upload your BMDC registration certificate and submit your application.",
          link: LINKS.doctorApplication,
        }
      : {
          kind: "account",
          title: "Email verified",
          body: "Welcome to Carewell! You can now book appointments.",
          link: "/discover",
        },
  );
  response.json({ user: toUser(verified) });
};

export const resendVerification = async (request, response) => {
  const user = request.user;
  if (user.emailVerifiedAt) return response.json({ sent: false });

  rateLimit(`verify-mail:${user.id}`, 6, HOUR, "Too many codes were requested. Try again in an hour.");
  const latest = await prisma.emailVerification.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_SECONDS * 1000)
    throw new ApiError(429, "RATE_LIMITED", "Please wait a few seconds before requesting another code.");

  await issueVerificationCode(user);
  response.json({ sent: true });
};

// ── POST /auth/forgot-password and /auth/reset-password ───────────────────────────────────
// Always answers the same way, so the form cannot be used to find out who has an account.
export const forgotPassword = async (request, response) => {
  const { email: address } = parse(z.object({ email }), request.body);
  // Counted whether or not the account exists, so the limit itself reveals nothing.
  rateLimit(`forgot:${request.ip}`, 20, HOUR);
  rateLimit(`forgot:${address}`, 5, HOUR, "Too many reset emails were requested. Try again later.");

  const user = await prisma.user.findUnique({ where: { email: address } });
  if (user && !BLOCKED.includes(user.accountStatus)) {
    const token = randomBytes(32).toString("base64url");
    await prisma.$transaction([
      prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      prisma.passwordReset.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: minutesFromNow(RESET_MINUTES) },
      }),
    ]);
    void sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      link: `${env.appUrl}#/reset-password?token=${token}`,
      minutes: RESET_MINUTES,
      language: request.language ?? user.language,
    });
  }
  response.json({ sent: true });
};

export const resetPassword = async (request, response) => {
  const { token, password } = parse(
    z.object({ token: z.string().min(1, "This reset link is incomplete."), password: newPassword }),
    request.body,
  );
  const invalid = () =>
    new ApiError(410, "RESET_TOKEN_INVALID", "This reset link is invalid or has expired. Request a new one.");

  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) throw invalid();

  // Claim the link first: of two simultaneous requests only one can win.
  const claimed = await prisma.passwordReset.updateMany({
    where: { id: reset.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) throw invalid();

  await prisma.user.update({
    where: { id: reset.userId },
    // Reaching this link proves the mailbox is theirs, so it also lifts an administrator's sign-in lock.
    data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null },
  });
  // Opening the emailed link also proves the address is theirs.
  await prisma.user.updateMany({
    where: { id: reset.userId, emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date() },
  });
  // An invited doctor who used "forgot password" instead of the invitation link has now set up
  // their account all the same.
  await prisma.doctor.updateMany({
    where: { userId: reset.userId, onboardingStatus: "invited" },
    data: { onboardingStatus: "in_progress" },
  });
  await revokeAllSessions(reset.userId); // anyone using the old password is signed out
  await notify(reset.userId, {
    kind: "account",
    title: "Your password was reset",
    body: "If this was not you, contact Carewell support straight away.",
  });
  response.json({ reset: true });
};

export const updateProfile = async (request, response) => {
  const input = parse(z.object({ name, phone: phone.optional() }), request.body);
  const user = await prisma.user.update({
    where: { id: request.user.id },
    data: { name: input.name, ...(input.phone ? { phone: input.phone } : {}) },
    include: withDoctor,
  });
  response.json({ user: toUser(user) });
};

export const changePassword = async (request, response) => {
  rateLimit(`change-password:${request.user.id}`, 10, 15 * 60 * 1000);
  const input = parse(
    z.object({ currentPassword: z.string().min(1, "Enter your current password."), newPassword }),
    request.body,
  );

  if (!(await verifyPassword(input.currentPassword, request.user.passwordHash)))
    throw new ApiError(422, "VALIDATION_FAILED", "Your current password is wrong.", {
      currentPassword: "Your current password is wrong.",
    });
  if (input.currentPassword === input.newPassword)
    throw new ApiError(422, "VALIDATION_FAILED", "Choose a password you haven’t used just now.", {
      newPassword: "Choose a different password.",
    });

  await prisma.user.update({
    where: { id: request.user.id },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });
  await revokeOtherSessions(request.user.id, request.sessionId); // other devices must sign in again
  await notify(request.user.id, {
    kind: "account",
    title: "Your password was changed",
    body: "Other devices were signed out. If this was not you, reset your password and contact support.",
    link: LINKS.profile,
  });
  response.json({ changed: true });
};
