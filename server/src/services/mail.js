import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { COPY } from "./mailCopy.js";

/**
 * Outgoing email.
 *  - With SMTP_HOST set, mail is sent through that SMTP server (Gmail, Resend SMTP, ...).
 *  - Without it, the message is printed to the console so development works offline.
 *  - In tests nothing leaves the machine: messages are collected in `outbox` for assertions.
 */
export const outbox = [];

let transport;
const smtpReady = Boolean(env.smtp.host && env.smtp.user && env.smtp.password);
const getTransport = () =>
  (transport ??= nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.password },
  }));

/**
 * Sends one email. Never throws: a mail problem must not break sign-up or password reset,
 * and the caller cannot do anything useful about it. Failures are logged without the body.
 */
export async function sendMail({ to, subject, text, replyTo }) {
  const message = { from: env.smtp.from, to, subject, text, ...(replyTo ? { replyTo } : {}) };
  if (env.nodeEnv === "test") {
    outbox.push(message);
    return true;
  }
  if (!smtpReady) {
    console.log(`\n[mail:not-sent] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return false;
  }
  try {
    await getTransport().sendMail(message);
    return true;
  } catch (error) {
    console.error(`[mail] could not send "${subject}" to ${to}: ${error.message}`);
    return false;
  }
}

// ── Message templates ──────────────────────────────────────────────────────────────────────
// The wording lives in mailCopy.js, in English and Bengali. `language` is the recipient's own
// ("en" | "bn", from users.language); "both" puts Bengali and English in one email, for people
// whose language is not known yet (an invited doctor).
function compose(language, key, data) {
  if (language === "both") {
    const bn = COPY.bn[key](data);
    const en = COPY.en[key](data);
    return { subject: `${bn.subject} / ${en.subject}`, text: `${bn.text}\n\n————————\n\n${en.text}` };
  }
  return COPY[language === "bn" ? "bn" : "en"][key](data);
}

const send = (to, language, key, data, extra = {}) =>
  sendMail({ to, ...compose(language, key, data), ...extra });

export const sendVerificationEmail = ({ to, language, ...data }) => send(to, language, "verification", data);

export const sendPasswordResetEmail = ({ to, language, ...data }) =>
  send(to, language, "passwordReset", data);

/**
 * Forwards a help-page message to the Carewell support mailbox (always English: it is read by the
 * team). "Reply" in the mail program answers the person directly, because their address is set as Reply-To.
 */
export const sendSupportRequestEmail = ({ to, replyTo, name, email, message, id, signedIn }) =>
  sendMail({
    to,
    replyTo,
    subject: `[Carewell support] ${message.replace(/\s+/g, " ").slice(0, 70)}`,
    text:
      `A new message arrived through the Carewell help page.

` +
      `From: ${name ? `${name} (${signedIn ? "signed-in patient" : "visitor"})` : "a visitor"}
` +
      `Email: ${email ?? "not provided: you cannot reply by email"}
` +
      `Reference: ${id}

Message:
${message}

` +
      `You can also review and reply to it in the administrator area (Support requests).`,
  });

/** An administrator's answer to a help-page message. Resolves false when it could not be sent. */
export const sendSupportReplyEmail = ({ to, language, ...data }) => send(to, language, "supportReply", data);

// ── Doctor applications ────────────────────────────────────────────────────────────────────
export const sendDoctorInvitationEmail = ({ to, language = "both", ...data }) =>
  send(to, language, "invitation", data);

export const sendApplicationReceivedEmail = ({ to, language, ...data }) =>
  send(to, language, "applicationReceived", data);

/** Tells one administrator that an application is waiting. */
export const sendNewApplicationEmail = ({ to, language, ...data }) =>
  send(to, language, "newApplication", data);

export const sendApplicationDecisionEmail = ({ to, language, ...data }) =>
  send(to, language, "decision", data);

export const sendProfilePublishedEmail = ({ to, language, ...data }) =>
  send(to, language, "profilePublished", data);

// ── Appointments and security ──────────────────────────────────────────────────────────────
/** `kind`: appointmentRequested | appointmentAccepted | appointmentRejected | appointmentCancelled | doctorNewRequest | doctorPatientCancelled */
export const sendAppointmentEmail = ({ to, language, kind, ...data }) => send(to, language, kind, data);

export const sendAccountLockedEmail = ({ to, language, ...data }) =>
  send(to, language, "accountLocked", data);
