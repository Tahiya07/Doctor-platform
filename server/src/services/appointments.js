import { prisma } from "../config/prisma.js";
import { appointmentInclude, toAppointment } from "../models/appointment.js";
import { conflict } from "../utils/errors.js";
import { emailDoctor, emailPatient } from "./appointmentMail.js";
import { LINKS, notify, notifyDoctor } from "./notifications.js";
import { publish } from "./realtime.js";

// Who may move an appointment request from which status to which. A doctor accepts or rejects, and
// marks an accepted visit completed once its time has come; a patient cancels.
export const ADMIN_TRANSITIONS = {
  pending: ["accepted", "rejected", "cancelled"],
  accepted: ["cancelled", "completed"],
};
export const DOCTOR_TRANSITIONS = { pending: ["accepted", "rejected"], accepted: ["completed"] };
export const PATIENT_TRANSITIONS = { pending: ["cancelled"], accepted: ["cancelled"] };

const WHEN = (appointment) => `${appointment.date} at ${appointment.time}`;

/** Tells the other people involved what happened, never the person who did it. */
async function announce(actor, appointment, patientId) {
  const when = WHEN(appointment);
  const doctor = appointment.doctor.name;
  const status = appointment.status;
  const toPatient = actor !== "patient";
  const toDoctor = actor !== "doctor";
  const by = actor === "admin" ? " by the administration" : "";

  if (toPatient) {
    const text = {
      accepted: [
        `Appointment accepted`,
        `${doctor} accepted your request for ${when} at ${appointment.facility.name}. You can now message the doctor.`,
      ],
      rejected: [
        `Appointment not accepted`,
        `${doctor} could not accept your request for ${when}. You can choose another time.`,
      ],
      cancelled: [
        `Appointment cancelled${by}`,
        `Your appointment with ${doctor} on ${when} was cancelled${by}.`,
      ],
      completed: [
        `Appointment completed`,
        `Your appointment with ${doctor} on ${when} was marked as completed.`,
      ],
    }[status];
    if (text)
      await notify(patientId, {
        kind: "appointment",
        title: text[0],
        body: text[1],
        link: status === "accepted" ? LINKS.messages : LINKS.appointments,
      });
    const kind = {
      accepted: "appointmentAccepted",
      rejected: "appointmentRejected",
      cancelled: "appointmentCancelled",
    }[status];
    if (kind) void emailPatient(patientId, kind, appointment, { byAdmin: actor === "admin" });
  }
  if (toDoctor) {
    const text = {
      accepted: [
        `Appointment accepted${by}`,
        `${appointment.patientName}'s request for ${when} was accepted${by}.`,
      ],
      rejected: [
        `Appointment rejected${by}`,
        `${appointment.patientName}'s request for ${when} was rejected${by}.`,
      ],
      cancelled: [
        actor === "patient" ? "Appointment cancelled by the patient" : `Appointment cancelled${by}`,
        `${appointment.patientName}'s appointment on ${when} was cancelled.`,
      ],
      completed: [
        `Appointment completed`,
        `${appointment.patientName}'s appointment on ${when} was marked as completed.`,
      ],
    }[status];
    if (text)
      await notifyDoctor(appointment.doctorId, {
        kind: "appointment",
        title: text[0],
        body: text[1],
        link: LINKS.doctorDashboard,
      });
    if (status === "cancelled" && actor === "patient")
      void emailDoctor(appointment.doctorId, "doctorPatientCancelled", appointment);
  }
}

/**
 * Moves `appointment` (a database row) to `status` if `allowed` permits it, in one batched
 * transaction. Accepting also opens the message thread between that patient and doctor. The
 * database refuses a second accepted request for one slot, which surfaces as
 * 409 APPOINTMENT_CONFLICT. `actor` ("patient" | "doctor" | "admin") is who asked, so the other
 * people involved are notified. Resolves the updated request in API shape.
 */
export async function changeAppointmentStatus(appointment, status, allowed, actor) {
  if (!allowed[appointment.status]?.includes(status))
    throw conflict("INVALID_TRANSITION", `A ${appointment.status} request cannot be changed to ${status}.`);

  const { id, doctorId, patientId } = appointment;
  const [updated] = await prisma.$transaction([
    prisma.appointment.update({ where: { id }, data: { status }, include: appointmentInclude }),
    ...(status === "accepted"
      ? [
          prisma.conversation.upsert({
            where: { doctorId_patientId: { doctorId, patientId } },
            update: {},
            create: { kind: "patient_doctor", doctorId, patientId },
          }),
        ]
      : []),
  ]);
  const result = toAppointment(updated);
  // The new chat appears in both people's Messages page straight away.
  if (status === "accepted") publish([patientId, updated.doctor.userId], { type: "conversation" });
  if (actor) await announce(actor, result, patientId);
  return result;
}
