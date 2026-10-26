import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { findDoctor } from "../models/doctor.js";
import { toUser, userDoctorSelect } from "../models/user.js";
import {
  assertApplicationOpen,
  certificateKind,
  resetBmdcCheck,
  storeCertificate,
  toCertificate,
} from "../services/applications.js";
import { hashPassword, startSession } from "../services/auth.js";
import { issueVerificationCode } from "../services/emailCodes.js";
import { discardUpload } from "../services/files.js";
import { LINKS, notifyAdmins } from "../services/notifications.js";
import { ApiError, conflict, notFound, parse, uuid } from "../utils/errors.js";
import { strongPassword } from "../utils/password.js";

/**
 * How a doctor joins and leaves: self-registration, uploading certificates for the administrator
 * to review, and asking for the account to be deactivated. Mounted at the API root.
 */

const HOUR = 60 * 60 * 1000;

// ── POST /auth/doctor/register ────────────────────────────────────────────────────────────
// The profile fields mirror doctorProfile.js (administrator and doctor editing). They are
// repeated here so this feature stands alone; import them from there once both are merged.
const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{8,18}$/, "Enter a valid phone number."),
  password: strongPassword,
  specialtyId: z.string().min(1, "Choose a specialty."),
  qualifications: z.array(z.string().trim().min(1)).min(1, "Add at least one qualification."),
  experienceYears: z.number().int("Use whole years.").min(0).max(60),
  fee: z.number().int("Use a whole number of taka.").min(0),
  location: z.string().trim().min(2, "Enter your practice location.").max(200),
  facilityIds: z.array(z.string().uuid()).min(1, "Choose at least one clinic or hospital."),
});

/**
 * Step 1 of a self-application: creates the account and a profile that is `pending`,
 * `unpublished` and `in_progress`, signs the doctor in, emails a 6-digit code to confirm the
 * address, and returns `{ user, doctor }`. The role is fixed to doctor. The administrators hear
 * about it only when the doctor submits the application (see controllers/applications.js).
 */
export const registerDoctor = async (request, response) => {
  rateLimit(
    `register-doctor:${request.ip}`,
    5,
    HOUR,
    "Too many registrations from this connection. Try again later.",
  );
  const data = parse(registerSchema, request.body);

  const facilityIds = [...new Set(data.facilityIds)];
  const [specialty, clinics] = await Promise.all([
    prisma.specialty.findFirst({ where: { id: data.specialtyId, active: true } }),
    prisma.clinic.count({ where: { id: { in: facilityIds }, active: true } }),
  ]);
  const details = {};
  if (!specialty) details.specialtyId = "Choose a valid specialty.";
  if (clinics !== facilityIds.length) details.facilityIds = "Choose valid, active clinics or hospitals.";
  if (Object.keys(details).length)
    throw new ApiError(422, "VALIDATION_FAILED", "Some of the submitted details are invalid.", details);

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      phone: data.phone,
      passwordHash: await hashPassword(data.password),
      role: "doctor",
      language: request.language ?? "en",
      doctor: {
        create: {
          specialtyId: data.specialtyId,
          qualifications: data.qualifications,
          experienceYears: data.experienceYears,
          fee: data.fee,
          location: data.location,
          clinics: { create: facilityIds.map((clinicId) => ({ clinicId })) },
        },
      },
    },
    include: { doctor: { select: userDoctorSelect } },
  });
  await prisma.conversation.create({ data: { kind: "doctor_admin", doctorId: user.doctor.id } });
  await startSession(request, response, user.id);
  await issueVerificationCode(user);
  response.status(201).json({ user: toUser(user), doctor: await findDoctor(user.doctor.id) });
};

const ownDoctorId = (request) => {
  const id = request.user.doctor?.id;
  if (!id) throw notFound("Your doctor profile");
  return id;
};

/** The signed-in doctor's profile row (status and id). */
const ownDoctor = async (request) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: ownDoctorId(request) } });
  if (!doctor) throw notFound("Your doctor profile");
  return doctor;
};

export const listCertificates = async (request, response) => {
  const rows = await prisma.doctorCertificate.findMany({
    where: { doctorId: ownDoctorId(request) },
    orderBy: { uploadedAt: "asc" },
  });
  response.json(rows.map(toCertificate));
};

/**
 * POST /doctor/certificates (multipart: field `kind` = bmdc | degree | other, then `file`): a PDF or
 * image, up to 10 MB, at most 5 files. A BMDC registration certificate is needed to submit an application.
 */
export const uploadCertificate = async (request, response) => {
  const doctor = await ownDoctor(request);
  rateLimit(`certificate:${request.user.id}`, 20, HOUR);
  assertApplicationOpen(doctor);
  const row = await storeCertificate(doctor, request.file, certificateKind(request.body?.kind));
  // Applicants are announced once, when they submit; approved doctors' new files need a look.
  if (doctor.onboardingStatus === "approved")
    await notifyAdmins({
      kind: "doctor",
      title: "A doctor uploaded a certificate",
      body: `${request.user.name} uploaded "${row.fileName}" for review.`,
      link: LINKS.adminVerification,
      groupKey: `certificate:${doctor.id}`,
    });
  response.status(201).json(toCertificate(row));
};

export const deleteCertificate = async (request, response) => {
  const id = uuid(request.params.id, "This certificate");
  const doctor = await ownDoctor(request);
  const row = await prisma.doctorCertificate.findFirst({ where: { id, doctorId: doctor.id } });
  if (!row) throw notFound("This certificate");
  assertApplicationOpen(doctor);
  await prisma.doctorCertificate.delete({ where: { id } });
  await discardUpload(row.storageKey);
  if (row.kind === "bmdc" && doctor.onboardingStatus !== "approved") await resetBmdcCheck(doctor.id);
  response.status(204).end();
};

// ── POST /doctor/account/deactivation-requests ────────────────────────────────────────────
/**
 * The doctor asks to leave. The account stays usable (status `deactivation_requested`) until an
 * administrator approves or declines in /admin/deactivation-requests.
 */
export const requestDeactivation = async (request, response) => {
  const doctorId = ownDoctorId(request);
  const { reason } = parse(
    z.object({
      reason: z.string().trim().min(3, "Provide a reason for the deactivation request.").max(1000),
    }),
    request.body,
  );
  if (await prisma.deactivationRequest.findFirst({ where: { doctorId, status: "open" } }))
    throw conflict("ALREADY_REQUESTED", "A deactivation request is already waiting for the administrator.");

  await prisma.$transaction([
    prisma.deactivationRequest.create({ data: { doctorId, reason } }),
    prisma.user.update({ where: { id: request.user.id }, data: { accountStatus: "deactivation_requested" } }),
  ]);
  const short = reason.length > 80 ? `${reason.slice(0, 79)}…` : reason;
  await notifyAdmins({
    kind: "doctor",
    title: "Deactivation request",
    body: `${request.user.name} asked to deactivate their account: "${short}"`,
    link: LINKS.adminDeactivations,
  });
  response.status(201).json({ status: "deactivation_requested" });
};
