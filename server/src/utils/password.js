import { z } from "zod";

/**
 * The rules for a NEW password (sign-up, reset, change, invitation). The client shows the same
 * list while typing (client/src/utils/password.js); keep the two in step. Signing in only asks for
 * a non-empty password, so older accounts keep working until their owner changes it.
 */
export const PASSWORD_MIN = 10;

// bcrypt only reads the first 72 bytes, so longer passwords would be silently cut.
export const PASSWORD_MAX_BYTES = 72;

const OBVIOUS = ["password", "passw0rd", "qwerty", "123456", "abcdef", "letmein", "carewell", "iloveyou"];

/** Why a password is not good enough, one short sentence each; an empty list means it is fine. */
export function passwordProblems(password) {
  const problems = [];
  if (password.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters.`);
  if (Buffer.byteLength(password) > PASSWORD_MAX_BYTES) problems.push("Use at most 72 characters.");
  if (!/[a-z]/.test(password)) problems.push("Add a lowercase letter.");
  if (!/[A-Z]/.test(password)) problems.push("Add a capital letter.");
  if (!/[0-9]/.test(password)) problems.push("Add a number.");
  if (!/[^A-Za-z0-9]/.test(password)) problems.push("Add a symbol, such as ! or @.");
  if (OBVIOUS.some((word) => password.toLowerCase().includes(word)))
    problems.push("Avoid obvious words such as “password” or “123456”.");
  return problems;
}

/** Zod rule for a new password; reports the first thing to fix. */
export const strongPassword = z.string().superRefine((value, context) => {
  const [first] = passwordProblems(value);
  if (first) context.addIssue({ code: "custom", message: first });
});
