/**
 * The rules for a NEW password, the same ones the server enforces (server/src/utils/password.js).
 * Signing in never checks them, so older accounts keep working.
 */
export const PASSWORD_MIN = 10;

const OBVIOUS = ["password", "passw0rd", "qwerty", "123456", "abcdef", "letmein", "carewell", "iloveyou"];

/** What the password must have, in the order shown while typing. */
export const PASSWORD_RULES = [
  {
    key: "length",
    label: `${PASSWORD_MIN} or more characters`,
    test: (value) => value.length >= PASSWORD_MIN,
  },
  { key: "lower", label: "A lowercase letter", test: (value) => /[a-z]/.test(value) },
  { key: "upper", label: "A capital letter", test: (value) => /[A-Z]/.test(value) },
  { key: "number", label: "A number", test: (value) => /[0-9]/.test(value) },
  { key: "symbol", label: "A symbol, such as ! or @", test: (value) => /[^A-Za-z0-9]/.test(value) },
];

/** The first thing to fix in a new password, or "" when it is good enough. */
export function passwordProblem(value) {
  if (value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(value).length > 72) return "Use at most 72 characters.";
  if (!/[a-z]/.test(value)) return "Add a lowercase letter.";
  if (!/[A-Z]/.test(value)) return "Add a capital letter.";
  if (!/[0-9]/.test(value)) return "Add a number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Add a symbol, such as ! or @.";
  if (OBVIOUS.some((word) => value.toLowerCase().includes(word)))
    return "Avoid obvious words such as “password” or “123456”.";
  return "";
}
