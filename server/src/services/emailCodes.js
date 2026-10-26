import { createHash, randomInt } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { sendVerificationEmail } from "./mail.js";

// A 6-digit code is only safe because it is single-use, short-lived and limited to a few
// guesses; the database keeps a hash, never the code. Used by patient sign-up and doctor applications.

export const CODE_MINUTES = 15;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const codeHash = (userId, code) => sha256(`${userId}:${code}`);

/** Replaces any older code with a fresh one and emails it. */
export async function issueVerificationCode(user) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.$transaction([
    prisma.emailVerification.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.emailVerification.create({
      data: {
        userId: user.id,
        codeHash: codeHash(user.id, code),
        expiresAt: new Date(Date.now() + CODE_MINUTES * 60 * 1000),
      },
    }),
  ]);
  void sendVerificationEmail({
    to: user.email,
    name: user.name,
    code,
    minutes: CODE_MINUTES,
    language: user.language,
  });
}
