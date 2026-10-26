import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { appointmentInclude, toAppointment } from "../models/appointment.js";
import { changeAppointmentStatus, PATIENT_TRANSITIONS } from "../services/appointments.js";
import { emailDoctor, emailPatient } from "../services/appointmentMail.js";
import { LINKS, notify, notifyDoctor, preview } from "../services/notifications.js";
import { ApiError, conflict, notFound, parse, uuid } from "../utils/errors.js";
import { clock, dateKey, dhakaNow, minutesOf, timeLabel, toDbDate } from "../utils/time.js";

/**
 * What a patient does: see bookable times, request an appointment (for themselves or a family
 * member), follow their requests and cancel them. Mounted at the API root.
 */

const HOUR = 60 * 60 * 1000;

// Same visibility rule as the public doctor list: published, and not deactivated.
const publicDoctor = { publicationStatus: "published", user: { accountStatus: { not: "deactivated" } } };

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Not a real date.");

// ── GET /doctors/:id/slots?facilityId&date ────────────────────────────────────────────────
// Everything a patient may pick on one day at one clinic. Blocked ("unavailable") slots are not
// shown at all; "booked" means another request was already accepted for that time.
export const listOpenSlots = async (request, response) => {
  const doctorId = uuid(request.params.id, "This doctor profile");
  const query = parse(
    z.object({ facilityId: z.string().uuid("Choose a clinic."), date: day }),
    request.query,
  );

  const link = await prisma.doctorClinic.findFirst({
    where: { doctorId, clinicId: query.facilityId, doctor: publicDoctor, clinic: { active: true } },
  });
  if (!link) throw notFound("This clinic for the selected doctor");

  const slots = await prisma.availabilitySlot.findMany({
    where: { doctorId, clinicId: query.facilityId, date: toDbDate(query.date), status: "available" },
    include: { appointments: { where: { status: "accepted" }, select: { id: true } } },
    orderBy: { startTime: "asc" },
  });

  const now = dhakaNow();
  response.json(
    slots.map((slot) => {
      const start = clock(slot.startTime);
      const passed = query.date < now.date || (query.date === now.date && minutesOf(start) <= now.minutes);
      return {
        id: slot.id,
        label: timeLabel(start),
        status: slot.appointments.length ? "booked" : passed ? "passed" : "available",
      };
    }),
  );
};

// ── Patient requests ──────────────────────────────────────────────────────────────────────
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{8,18}$/, "Enter a valid phone number.");

const requestSchema = z.object({
  doctorId: z.string().uuid("Choose a doctor."),
  facilityId: z.string().uuid("Choose a clinic."),
  date: day,
  /** Display time such as "5:30 PM". Optional when `slotId` is sent. */
  time: z.string().trim().optional(),
  slotId: z.string().uuid().optional(),
  relationship: z.enum(["self", "child", "parent", "spouse", "sibling", "other"]).default("self"),
  patientName: z.string().trim().min(2, "Enter the patient's full name.").max(120),
  phone,
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  reason: z.string().trim().min(5, "Add a short reason for the visit (at least 5 characters).").max(1000),
});

/** The slot the patient chose: by id, or by doctor + clinic + date + displayed time. */
async function findRequestedSlot(data) {
  const base = { doctorId: data.doctorId, clinicId: data.facilityId, date: toDbDate(data.date) };
  if (data.slotId) return prisma.availabilitySlot.findFirst({ where: { id: data.slotId, ...base } });
  if (!data.time) throw new ApiError(422, "VALIDATION_FAILED", "Choose a time.", { time: "Choose a time." });
  const slots = await prisma.availabilitySlot.findMany({ where: base });
  return slots.find((slot) => timeLabel(clock(slot.startTime)) === data.time) ?? null;
}

/**
 * POST /appointment-requests: a verified patient asks for a time. The request is `pending` until
 * the doctor (or an administrator) accepts it. `relationship` and `patientName` say who the visit
 * is for; the phone and email are how to reach the account holder.
 */
export const createAppointmentRequest = async (request, response) => {
  if (!request.user.emailVerifiedAt)
    throw new ApiError(403, "EMAIL_NOT_VERIFIED", "Verify your email address before booking.");
  rateLimit(`book:${request.user.id}`, 20, HOUR, "You have sent many requests. Please try again later.");
  const data = parse(requestSchema, request.body);

  const doctor = await prisma.doctor.findFirst({
    where: {
      id: data.doctorId,
      ...publicDoctor,
      clinics: { some: { clinicId: data.facilityId, clinic: { active: true } } },
    },
  });
  if (!doctor) throw notFound("This doctor at that clinic");

  const slot = await findRequestedSlot(data);
  if (!slot || slot.status !== "available")
    throw new ApiError(422, "VALIDATION_FAILED", "That time is not available. Please choose another.", {
      time: "Choose another time.",
    });

  const now = dhakaNow();
  const date = dateKey(slot.date);
  if (date < now.date || (date === now.date && minutesOf(clock(slot.startTime)) <= now.minutes))
    throw new ApiError(422, "VALIDATION_FAILED", "That time has already passed.", {
      time: "Choose a later time.",
    });

  if (await prisma.appointment.findFirst({ where: { slotId: slot.id, status: "accepted" } }))
    throw conflict("APPOINTMENT_CONFLICT", "This time is no longer available.");
  if (
    await prisma.appointment.findFirst({
      where: { slotId: slot.id, patientId: request.user.id, status: { in: ["pending", "accepted"] } },
    })
  )
    throw conflict("DUPLICATE_REQUEST", "You have already requested this time.");

  const created = await prisma.appointment.create({
    data: {
      patientId: request.user.id,
      slotId: slot.id,
      doctorId: slot.doctorId,
      clinicId: slot.clinicId,
      relationship: data.relationship,
      patientName: data.patientName,
      phone: data.phone,
      email: data.email,
      reason: data.reason,
    },
    include: appointmentInclude,
  });
  const result = toAppointment(created);
  const forWhom =
    data.relationship === "self"
      ? ""
      : ` (for their ${data.relationship === "other" ? "family member" : data.relationship})`;
  await notifyDoctor(created.doctorId, {
    kind: "appointment",
    title: "New appointment request",
    body: `${result.patientName}${forWhom} asked for ${result.date} at ${result.time}: "${preview(data.reason)}"`,
    link: LINKS.doctorDashboard,
  });
  await notify(request.user.id, {
    kind: "appointment",
    title: "Appointment request sent",
    body: `Your request to ${result.doctor.name} for ${result.date} at ${result.time} is waiting for an answer.`,
    link: LINKS.appointments,
  });
  void emailDoctor(created.doctorId, "doctorNewRequest", result, { forOther: data.relationship !== "self" });
  void emailPatient(request.user.id, "appointmentRequested", result);
  response.status(201).json(result);
};

/** GET /appointments: the signed-in patient's own requests, including ones made for family. */
export const listMyAppointments = async (request, response) => {
  const appointments = await prisma.appointment.findMany({
    where: { patientId: request.user.id },
    include: appointmentInclude,
    orderBy: { createdAt: "desc" },
  });
  response.json(appointments.map(toAppointment));
};

/** PATCH /appointment-requests/:id { status: "cancelled" }: pending or accepted requests only. */
export const cancelAppointmentRequest = async (request, response) => {
  const id = uuid(request.params.id, "This request");
  const { status } = parse(
    z.object({ status: z.literal("cancelled", { error: "Requests can only be cancelled." }) }),
    request.body,
  );
  // Someone else's request answers 404, exactly like one that does not exist.
  const appointment = await prisma.appointment.findFirst({ where: { id, patientId: request.user.id } });
  if (!appointment) throw notFound("This request");
  response.json(await changeAppointmentStatus(appointment, status, PATIENT_TRANSITIONS, "patient"));
};
