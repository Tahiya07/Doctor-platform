import { ApiError } from "../utils/errors.js";

const attempts = new Map(); // key -> { count, resetAt }

const MAX_ATTEMPTS = 10;

const WINDOW_MS = 15 * 60 * 1000;

export function throttleLogin(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS)
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Too many sign-in attempts. Please wait a few minutes and try again.",
    );
}

export const clearLoginThrottle = (key) => attempts.delete(key);

// Wrong-password lock for sign-ins that have no account row to keep the count in (see controllers/auth.js).
const failures = new Map(); // key -> { count, lockedUntil }

/** Milliseconds left on the lock for `key`, or 0 when it is not locked. */
export function lockRemaining(key) {
  const entry = failures.get(key);
  if (!entry?.lockedUntil) return 0;
  if (entry.lockedUntil <= Date.now()) {
    failures.delete(key);
    return 0;
  }
  return entry.lockedUntil - Date.now();
}

/** Counts one wrong password; the `max`th one locks `key` for `lockMs`. Returns true once locked. */
export function recordFailure(key, max, lockMs) {
  const entry = failures.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= max) {
    entry.count = 0;
    entry.lockedUntil = Date.now() + lockMs;
  }
  failures.set(key, entry);
  return entry.lockedUntil > Date.now();
}

export const clearFailures = (key) => failures.delete(key);

// General-purpose limiter for other endpoints (sign-up, emailing codes). Same in-memory caveat.
const counters = new Map(); // key -> { count, resetAt }

/** Forgets all rate-limit counters. Tests use it so one test's requests do not count against the next. */
export function resetRateLimits() {
  counters.clear();
  attempts.clear();
  failures.clear();
}

/** Allows `max` calls per `windowMs` for `key`; the next one throws 429 with `message`. */
export function rateLimit(
  key,
  max,
  windowMs,
  message = "Too many requests. Please wait a moment and try again.",
) {
  const now = Date.now();
  const entry = counters.get(key);
  if (!entry || entry.resetAt < now) {
    counters.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw new ApiError(429, "RATE_LIMITED", message);
}
