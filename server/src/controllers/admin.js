import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { appointmentInclude, toAppointment } from "../models/appointment.js";
import { toFacility, toSpecialty } from "../models/catalog.js";
import { doctorInclude, findDoctor, findDoctors } from "../models/doctor.js";
import { ADMIN_TRANSITIONS, changeAppointmentStatus } from "../services/appointments.js";
import { revokeAllSessions, unusablePasswordHash } from "../services/auth.js";
import {
  createSlots,
  createSlotSchema,
  listSlots,
  removeSlot,
  updateSlot,
  updateSlotSchema,
} from "../services/availability.js";
import {
  assertReferences,
  profileFields,
  profileSchema,
  saveDoctorProfile,
} from "../services/doctorProfile.js";
import { appLink, issueInvitation, withReviewDetails } from "../services/applications.js";
import { sendProfilePublishedEmail } from "../services/mail.js";
import { LINKS, notifyDoctor } from "../services/notifications.js";
import { ApiError, conflict, notFound, parse, uuid } from "../utils/errors.js";
import { dhakaNow, toDbDate } from "../utils/time.js";

// What a doctor is told when the administration decides on their profile.
const VERIFICATION_NOTICE = {
  verified: [
    "Your profile was verified",
    "The administration verified your credentials. Once it is published, patients can find and book you.",
  ],
  rejected: [
    "Your profile was not approved",
    "The administration could not approve your profile. Check your details and certificates, or message the administration.",
  ],
  suspended: [
    "Your profile was suspended",
    "Your profile is hidden from patients for now. Please contact the administration.",
  ],
  pending: ["Your profile is back in review", "The administration is reviewing your profile again."],
};

/** Everything here is for administrators only. */

// ── Shared helpers ─────────────────────────────────────────────────────────────────────────
/** Records who did what (and the before/after) for every admin decision. */
const toJson = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const audit = (request, action, entityType, entityId, before, after) =>
  prisma.auditLog.create({
    data: {
      actorId: request.user.id,
      action,
      entityType,
      entityId,
      before: toJson(before),
      after: toJson(after),
    },
  });

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ── Summary (the dashboard numbers) ────────────────────────────────────────────────────────
export const getSummary = async (request, response) => {
  const now = dhakaNow();
  const months = Array.from({ length: 12 }, (_, i) => {
    const [year, month] = now.date.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 - (11 - i), 1));
    return date.toISOString().slice(0, 7);
  });

  const [pendingDoctors, verifiedDoctors, appointmentsToday, activeFacilities, activeSpecialties, monthly] =
    await Promise.all([
      prisma.doctor.count({ where: { onboardingStatus: "submitted" } }), // applications waiting for review
      prisma.doctor.count({ where: { verificationStatus: "verified" } }),
      prisma.appointment.count({
        where: { slot: { date: toDbDate(now.date) }, status: { in: ["pending", "accepted", "completed"] } },
      }),
      prisma.clinic.count({ where: { active: true } }),
      prisma.specialty.count({ where: { active: true } }),
      prisma.$queryRaw`
      SELECT to_char(s."date", 'YYYY-MM') AS month, count(*)::int AS count
      FROM appointments a JOIN availability_slots s ON s.id = a.slot_id
      WHERE a.status IN ('accepted', 'completed') AND s."date" >= ${`${months[0]}-01`}::date
      GROUP BY 1`,
    ]);

  const byMonth = new Map(monthly.map((row) => [row.month, row.count]));
  response.json({
    pendingDoctors,
    verifiedDoctors,
    appointmentsToday,
    activeFacilities,
    activeSpecialties,
    monthlyAppointments: months.map((month) => ({ month, count: byMonth.get(month) ?? 0 })),
  });
};

// ── Doctors ────────────────────────────────────────────────────────────────────────────────
const createDoctorSchema = z.object({
  ...profileFields,
  email: z
    .string()
    .trim()
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
});

export const listDoctors = async (request, response) => {
  response.json(await findDoctors());
};

/**
 * POST /admin/doctors: invites a doctor. Creates the account and a profile that starts `pending`,
 * `unpublished` and `invited`, and emails a single-use link (48 hours) to choose a password. The
 * doctor then completes the same application as everyone else, BMDC certificate included.
 */
export const createDoctor = async (request, response) => {
  const data = parse(createDoctorSchema, request.body);
  await assertReferences(data);
  const passwordHash = await unusablePasswordHash();

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash,
      role: "doctor",
      doctor: {
        create: {
          specialtyId: data.specialtyId,
          qualifications: data.qualifications,
          experienceYears: data.experienceYears,
          fee: data.fee,
          location: data.location,
          onboardingStatus: "invited",
          clinics: { create: [...new Set(data.facilityIds)].map((clinicId) => ({ clinicId })) },
        },
      },
    },
    include: { doctor: true },
  });
  await prisma.conversation.create({ data: { kind: "doctor_admin", doctorId: user.doctor.id } });
  await issueInvitation({ doctorId: user.doctor.id, user, invitedById: request.user.id });
  const doctor = await findDoctor(user.doctor.id);
  await audit(request, "doctor.create", "doctor", doctor.id, undefined, doctor);
  response.status(201).json((await withReviewDetails([doctor]))[0]);
};

export const updateDoctor = async (request, response) => {
  const id = uuid(request.params.id, "This doctor profile");
  const data = parse(profileSchema, request.body);
  const before = await prisma.doctor.findUnique({ where: { id }, include: doctorInclude });
  if (!before) throw notFound("This doctor profile");

  await saveDoctorProfile(before, data);
  const after = await findDoctor(id);
  await audit(request, "doctor.update", "doctor", id, undefined, after);
  await notifyDoctor(id, {
    kind: "doctor",
    title: "Your profile was updated",
    body: "The administration updated your profile details.",
    link: LINKS.doctorDashboard,
    groupKey: `profile-admin:${id}`,
  });
  response.json(after);
};

/** POST /admin/doctors/:id/deactivation: hides the profile, blocks sign-in and ends their sessions. */
export const deactivateDoctor = async (request, response) => {
  const id = uuid(request.params.id, "This doctor profile");
  const doctor = await prisma.doctor.findUnique({ where: { id } });
  if (!doctor) throw notFound("This doctor profile");

  await prisma.$transaction([
    prisma.user.update({ where: { id: doctor.userId }, data: { accountStatus: "deactivated" } }),
    prisma.doctor.update({ where: { id }, data: { publicationStatus: "inactive" } }),
  ]);
  await revokeAllSessions(doctor.userId);
  const after = await findDoctor(id);
  await audit(
    request,
    "doctor.deactivate",
    "doctor",
    id,
    { publicationStatus: doctor.publicationStatus },
    after,
  );
  response.json(after);
};

export const setVerification = async (request, response) => {
  const id = uuid(request.params.id, "This doctor profile");
  const { status } = parse(
    z.object({ status: z.enum(["pending", "verified", "rejected", "suspended"]) }),
    request.body,
  );
  const doctor = await prisma.doctor.findUnique({ where: { id } });
  if (!doctor) throw notFound("This doctor profile");
  // A new doctor is verified only through the application review, which needs the BMDC check.
  if (status === "verified" && doctor.onboardingStatus !== "approved")
    throw conflict(
      "APPLICATION_NOT_APPROVED",
      "Approve this doctor's application first (Verification: BMDC check, then Approve).",
    );

  // A profile that is no longer verified must not stay public.
  const data = { verificationStatus: status };
  if (status !== "verified" && doctor.publicationStatus === "published")
    data.publicationStatus = "unpublished";
  await prisma.doctor.update({ where: { id }, data });

  const after = await findDoctor(id);
  await audit(
    request,
    "doctor.verification",
    "doctor",
    id,
    { verificationStatus: doctor.verificationStatus, publicationStatus: doctor.publicationStatus },
    { verificationStatus: status, publicationStatus: after.publicationStatus },
  );
  if (status !== doctor.verificationStatus) {
    const [title, body] = VERIFICATION_NOTICE[status];
    await notifyDoctor(id, { kind: "doctor", title, body, link: LINKS.doctorDashboard });
  }
  response.json(after);
};

export const setPublication = async (request, response) => {
  const id = uuid(request.params.id, "This doctor profile");
  const { status } = parse(z.object({ status: z.enum(["published", "unpublished"]) }), request.body);
  const doctor = await prisma.doctor.findUnique({ where: { id }, include: { user: true } });
  if (!doctor) throw notFound("This doctor profile");
  if (status === "published") {
    if (doctor.verificationStatus !== "verified")
      throw conflict("NOT_VERIFIED", "Only verified profiles can be published.");
    if (doctor.user.accountStatus === "deactivated")
      throw conflict("ACCOUNT_RESTRICTED", "A deactivated doctor cannot be published.");
  }
  await prisma.doctor.update({ where: { id }, data: { publicationStatus: status } });

  const after = await findDoctor(id);
  await audit(
    request,
    "doctor.publication",
    "doctor",
    id,
    { publicationStatus: doctor.publicationStatus },
    { publicationStatus: status },
  );
  if (status === "published" && doctor.publicationStatus !== "published")
    void sendProfilePublishedEmail({
      to: doctor.user.email,
      name: doctor.user.name,
      link: appLink(LINKS.doctorDashboard),
      language: doctor.user.language,
    });
  if (status !== doctor.publicationStatus)
    await notifyDoctor(id, {
      kind: "doctor",
      title:
        status === "published" ? "Your profile is now visible to patients" : "Your profile is now hidden",
      body:
        status === "published"
          ? "Patients can find you and request appointments."
          : "Patients can no longer find your profile. Contact the administration if this is unexpected.",
      link: LINKS.doctorDashboard,
    });
  response.json(after);
};

// ── Clinics and hospitals ──────────────────────────────────────────────────────────────────
const clinicFields = {
  name: z.string().trim().min(2, "Enter the facility name.").max(160),
  type: z.enum(["clinic", "hospital"]),
  address: z.string().trim().min(3, "Enter the street address.").max(240),
  area: z.string().trim().min(1, "Enter the area.").max(120),
  city: z.string().trim().min(1, "Enter the city.").max(120),
  phone: z.string().trim().min(5, "Enter a contact phone.").max(40),
  openingHours: z.string().trim().max(120).optional(),
};
const createClinicSchema = z.object(clinicFields);
const updateClinicSchema = z.object(clinicFields).partial();

export const listClinics = async (request, response) => {
  response.json((await prisma.clinic.findMany({ orderBy: { name: "asc" } })).map(toFacility));
};

export const createClinic = async (request, response) => {
  const data = parse(createClinicSchema, request.body);
  const clinic = await prisma.clinic.create({ data: { ...data, openingHours: data.openingHours || null } });
  await audit(request, "clinic.create", "clinic", clinic.id, undefined, toFacility(clinic));
  response.status(201).json(toFacility(clinic));
};

export const updateClinic = async (request, response) => {
  const id = uuid(request.params.id, "This facility");
  const data = parse(updateClinicSchema, request.body);
  if ("openingHours" in data) data.openingHours = data.openingHours || null;
  const clinic = await prisma.clinic.update({ where: { id }, data });
  await audit(request, "clinic.update", "clinic", id, undefined, toFacility(clinic));
  response.json(toFacility(clinic));
};

/** Clinics are never deleted (history refers to them): deactivating hides them from patients. */
export const deactivateClinic = async (request, response) => {
  const id = uuid(request.params.id, "This facility");
  const clinic = await prisma.clinic.update({ where: { id }, data: { active: false } });
  await audit(request, "clinic.deactivate", "clinic", id, { active: true }, { active: false });
  response.json(toFacility(clinic));
};

// ── Specialties ────────────────────────────────────────────────────────────────────────────
const createSpecialtySchema = z.object({
  name: z.string().trim().min(3, "Enter a specialty name (3+ characters).").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case letters, numbers and dashes.")
    .optional(),
  description: z.string().trim().max(200).default(""),
});

export const listSpecialties = async (request, response) => {
  response.json((await prisma.specialty.findMany({ orderBy: { name: "asc" } })).map(toSpecialty));
};

export const createSpecialty = async (request, response) => {
  const data = parse(createSpecialtySchema, request.body);
  const id = data.slug || slugify(data.name);
  if (!id)
    throw new ApiError(422, "VALIDATION_FAILED", "Enter a specialty name.", {
      name: "Enter a specialty name.",
    });

  const existing = await prisma.specialty.findFirst({
    where: { OR: [{ id }, { name: { equals: data.name, mode: "insensitive" } }] },
  });
  if (existing) throw conflict("DUPLICATE_SPECIALTY", "A specialty with this name already exists.");

  const specialty = await prisma.specialty.create({
    data: { id, name: data.name, description: data.description },
  });
  await audit(request, "specialty.create", "specialty", id, undefined, toSpecialty(specialty));
  response.status(201).json(toSpecialty(specialty));
};

export const updateSpecialty = async (request, response) => {
  const { active } = parse(z.object({ active: z.boolean() }), request.body);
  const specialty = await prisma.specialty.update({
    where: { id: String(request.params.id) },
    data: { active },
  });
  await audit(request, "specialty.active", "specialty", specialty.id, undefined, { active });
  response.json(toSpecialty(specialty));
};

// ── Appointments ───────────────────────────────────────────────────────────────────────────
export const listAppointments = async (request, response) => {
  const appointments = await prisma.appointment.findMany({
    include: appointmentInclude,
    orderBy: [{ createdAt: "desc" }],
  });
  response.json(appointments.map(toAppointment));
};

export const updateAppointmentStatus = async (request, response) => {
  const id = uuid(request.params.id, "This request");
  const { status } = parse(
    z.object({ status: z.enum(["pending", "accepted", "rejected", "cancelled", "completed"]) }),
    request.body,
  );
  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment) throw notFound("This request");

  const updated = await changeAppointmentStatus(appointment, status, ADMIN_TRANSITIONS, "admin");
  await audit(request, "appointment.status", "appointment", id, { status: appointment.status }, { status });
  response.json(updated);
};

const scheduleNotice = (doctorId, body) => ({
  kind: "doctor",
  title: "Your schedule was changed by the administration",
  body,
  link: LINKS.doctorDashboard,
  groupKey: `schedule-admin:${doctorId}`,
});

// ── Availability (any doctor's schedule) ───────────────────────────────────────────────────
export const listAvailability = async (request, response) => {
  response.json(await listSlots(uuid(request.query.doctorId, "This doctor profile")));
};

export const createAvailability = async (request, response) => {
  const { doctorId, ...data } = parse(
    createSlotSchema.extend({ doctorId: z.string().uuid("Choose a doctor.") }),
    request.body,
  );
  const slots = await createSlots(doctorId, data);
  for (const slot of slots) await audit(request, "slot.create", "slot", slot.id, undefined, slot);
  await notifyDoctor(
    doctorId,
    scheduleNotice(
      doctorId,
      `Added ${slots.length} times on ${data.date}, ${data.startTime}–${data.endTime}.`,
    ),
  );
  response.status(201).json(slots);
};

export const updateAvailability = async (request, response) => {
  const id = uuid(request.params.id, "This availability slot");
  const { before, after } = await updateSlot(id, parse(updateSlotSchema, request.body));
  await audit(request, "slot.update", "slot", id, before, after);
  await notifyDoctor(
    after.doctorId,
    scheduleNotice(after.doctorId, `Changed ${after.date} at ${after.startTime} (${after.status}).`),
  );
  response.json(after);
};

export const deleteAvailability = async (request, response) => {
  const id = uuid(request.params.id, "This availability slot");
  const removed = await prisma.availabilitySlot.findUnique({
    where: { id },
    select: { doctorId: true, date: true, startTime: true },
  });
  await removeSlot(id);
  await audit(request, "slot.delete", "slot", id);
  if (removed) await notifyDoctor(removed.doctorId, scheduleNotice(removed.doctorId, "A slot was removed."));
  response.status(204).end();
};
