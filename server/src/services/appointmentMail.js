import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { whenText } from "./language.js";
import { sendAppointmentEmail } from "./mail.js";
import { LINKS } from "./notifications.js";

/**
 * Emails about appointments, in the language of the person who receives them. They back up the bell
 * notifications for people who are not on the website. An email problem must never break a booking,
 * so nothing here throws. The reason for a visit is never put in an email.
 */
const link = (path) => `${env.appUrl}#${path}`;

async function send(user, kind, appointment, extra, path) {
  if (!user) return;
  try {
    await sendAppointmentEmail({
      to: user.email,
      language: user.language,
      kind,
      name: user.name,
      when: whenText(user.language, appointment.date, appointment.time),
      facility: appointment.facility?.name,
      doctor: appointment.doctor?.name,
      patient: appointment.patientName,
      link: link(path),
      ...extra,
    });
  } catch (error) {
    console.error(`[mail] appointment email (${kind}) failed: ${error.message}`);
  }
}

/** To the patient who booked. `kind`: appointmentRequested | appointmentAccepted | appointmentRejected | appointmentCancelled */
export async function emailPatient(patientId, kind, appointment, extra = {}) {
  const user = await prisma.user.findUnique({ where: { id: patientId } }).catch(() => null);
  await send(
    user,
    kind,
    appointment,
    extra,
    kind === "appointmentAccepted" ? LINKS.messages : LINKS.appointments,
  );
}

/** To the doctor. `kind`: doctorNewRequest | doctorPatientCancelled */
export async function emailDoctor(doctorId, kind, appointment, extra = {}) {
  const doctor = await prisma.doctor
    .findUnique({ where: { id: doctorId }, select: { user: true } })
    .catch(() => null);
  await send(doctor?.user, kind, appointment, extra, LINKS.doctorDashboard);
}
