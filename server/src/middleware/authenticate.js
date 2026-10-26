import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { readCookie, SESSION_COOKIE, sha256 } from "../services/auth.js";
import { languageFromRequest } from "../services/language.js";
import { userDoctorSelect } from "../models/user.js";
import { ApiError } from "../utils/errors.js";

const BLOCKED = new Set(["suspended", "deactivated"]);

/** Looks up the session cookie and sets `request.user` (or leaves it undefined for guests). */
export async function authenticate(request, response, next) {
  // The website's language (X-Language header): emails to this person follow it.
  request.language = languageFromRequest(request);
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { include: { doctor: { select: userDoctorSelect } } } },
    });
    const valid =
      session &&
      !session.revokedAt &&
      session.expiresAt > new Date() &&
      !BLOCKED.has(session.user.accountStatus);
    if (valid) {
      request.user = session.user;
      request.sessionId = session.id;
      // They switched the website's language: remember it for their emails.
      if (request.language && request.language !== session.user.language) {
        session.user.language = request.language;
        prisma.user
          .update({ where: { id: session.user.id }, data: { language: request.language } })
          .catch(() => {});
      }
      // Record activity at most every 5 minutes, not on every request.
      if (!session.lastUsedAt || Date.now() - session.lastUsedAt.getTime() > 5 * 60 * 1000)
        prisma.session
          .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
          .catch(() => {});
    }
  }
  next();
}

export function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.user)
      return next(
        new ApiError(401, "UNAUTHENTICATED", "Your session has expired. Sign in again to continue."),
      );
    if (!roles.includes(request.user.role))
      return next(new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action."));
    return next();
  };
}

/**
 * Doctors reach appointments and availability only once the administration has approved their
 * application. Before that they can complete their profile, upload certificates and message the
 * administration. Use after requireRole("doctor").
 */
export function requireApprovedDoctor(request, response, next) {
  if (request.user?.doctor?.onboardingStatus !== "approved")
    return next(
      new ApiError(
        403,
        "APPLICATION_NOT_APPROVED",
        "This becomes available once the administration approves your application.",
      ),
    );
  return next();
}

/**
 * Is this browser origin one of our websites? The listed CLIENT_ORIGINS always are. While developing, any
 * port on localhost also is, because a second `npm run dev` quietly moves to port 5174, 5175 and so on.
 * Production only ever trusts the list.
 */
export const isAllowedOrigin = (origin) =>
  env.clientOrigins.includes(origin) ||
  (!env.isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

// Browsers always send an Origin header on cross-site POST/PATCH/DELETE. Requests without one
// (curl, server-to-server) cannot carry a victim's cookie, so they are allowed.
export function checkOrigin(request, response, next) {
  const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(request.method);
  const origin = request.get("origin");
  if (safeMethod || !origin || isAllowedOrigin(origin)) return next();
  return next(new ApiError(403, "FORBIDDEN_ORIGIN", "This request did not come from the Carewell website."));
}
