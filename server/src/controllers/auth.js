import { z } from "zod";
import { prisma } from "../config/prisma.js";
import {
  clearFailures,
  clearLoginThrottle,
  lockRemaining,
  recordFailure,
  throttleLogin,
} from "../middleware/rateLimit.js";
import { toUser, userDoctorSelect } from "../models/user.js";
import { endSession, spendPasswordTime, startSession, verifyPassword } from "../services/auth.js";
import { env } from "../config/env.js";
import { sendAccountLockedEmail } from "../services/mail.js";
import { ApiError, parse } from "../utils/errors.js";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email.")
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1, "Enter your password."),
  portal: z.enum(["patient", "doctor", "admin"]).optional(),
});

const PORTAL_LABEL = { patient: "patient", doctor: "doctor", admin: "administrator" };

// An administrator account can see every patient, so it gets only 4 wrong passwords before it is
// locked for 30 minutes (even the right password is refused meanwhile). Resetting the password
// by email unlocks it sooner. The administrator sign-in answers the same way for emails that
// are not administrators, so the lock cannot be used to find out which emails are.
export const ADMIN_MAX_ATTEMPTS = 4;
export const ADMIN_LOCK_MINUTES = 30;
const locked = () =>
  new ApiError(
    423,
    "ACCOUNT_LOCKED",
    `Too many wrong passwords. Sign-in is locked for ${ADMIN_LOCK_MINUTES} minutes. Reset your password by email to unlock it sooner.`,
  );
const LOCK_MS = ADMIN_LOCK_MINUTES * 60 * 1000;

/**
 * POST /auth/login
 * `portal` is only the sign-in page the person used. The account's real role comes from the
 * database, and a mismatch is refused, so a patient cannot enter the admin portal.
 */
export const login = async (request, response) => {
  const { email, password, portal } = parse(loginSchema, request.body);
  const throttleKey = `${request.ip}|${email}`;
  throttleLogin(throttleKey);

  const user = await prisma.user.findUnique({
    where: { email },
    include: { doctor: { select: userDoctorSelect } },
  });
  const isAdmin = user?.role === "admin";
  // Pretend-accounts: anything typed into the administrator sign-in that is not an administrator.
  const stranger = portal === "admin" && !isAdmin;
  const strangerKey = `admin-portal|${email}`;
  if ((isAdmin && user.lockedUntil > new Date()) || (stranger && lockRemaining(strangerKey) > 0))
    throw locked();

  const passwordOk = user
    ? await verifyPassword(password, user.passwordHash)
    : await spendPasswordTime(password);
  if (!user || !passwordOk) {
    if (stranger && recordFailure(strangerKey, ADMIN_MAX_ATTEMPTS, LOCK_MS)) throw locked();
    if (isAdmin) await countAdminFailure(request, user);
    // The same message for "no such account" and "wrong password": never reveal which emails exist.
    throw new ApiError(401, "INVALID_CREDENTIALS", "Wrong email or password.");
  }

  if (["suspended", "deactivated"].includes(user.accountStatus))
    throw new ApiError(
      403,
      "ACCOUNT_RESTRICTED",
      `This account is ${user.accountStatus}. Contact Carewell administration.`,
    );
  if (portal && user.role !== portal)
    throw new ApiError(
      403,
      "WRONG_PORTAL",
      `This account is not authorised for the ${PORTAL_LABEL[portal]} portal.`,
    );

  clearLoginThrottle(throttleKey);
  clearFailures(strangerKey);
  if (user.failedLoginCount > 0 || user.lockedUntil)
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  await startSession(request, response, user.id);
  response.json({ user: toUser(user) });
};

/** One more wrong password on an administrator account; the 4th locks it and emails its owner. */
async function countAdminFailure(request, user) {
  const { failedLoginCount } = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });
  if (failedLoginCount < ADMIN_MAX_ATTEMPTS) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) },
  });
  void sendAccountLockedEmail({
    to: user.email,
    language: user.language,
    name: user.name,
    attempts: ADMIN_MAX_ATTEMPTS,
    minutes: ADMIN_LOCK_MINUTES,
    ip: request.ip,
    link: `${env.appUrl}#/forgot-password`,
  });
  throw locked();
}

/** POST /auth/logout: revokes the session on the server and clears the cookie. */
export const logout = async (request, response) => {
  await endSession(request, response);
  response.status(204).end();
};

/** GET /auth/me: restores the login after a page reload. 401 means "not signed in". */
export const currentUser = (request, response) => {
  if (!request.user) throw new ApiError(401, "UNAUTHENTICATED", "You are not signed in.");
  response.json({ user: toUser(request.user) });
};
