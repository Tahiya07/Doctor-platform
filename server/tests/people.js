// Test data builders shared by the onboarding, messaging and admin-review test files.
import assert from "node:assert/strict";

export const PASSWORD = "Pass-word-123!";

export const ok = (response, status = 200) => {
  assert.equal(
    response.status,
    status,
    `expected ${status}, got ${response.status}: ${JSON.stringify(response.body)}`,
  );
  return response.body;
};

export const fails = (response, status, code) => {
  assert.equal(
    response.status,
    status,
    `expected ${status}, got ${response.status}: ${JSON.stringify(response.body)}`,
  );
  if (code) assert.equal(response.body.code, code);
  assert.equal(typeof response.body.message, "string");
  return response.body;
};

/** Builders bound to a running test app (`ctx` from startTestApp). */
export function makePeople(ctx) {
  let counter = 0;
  const day = (offset) => ctx.addDays(ctx.dhakaNow().date, offset);

  async function signIn(email, portal) {
    const client = ctx.client();
    ok(await client.post("/auth/login", { email, password: PASSWORD, portal }));
    return client;
  }

  /** Two specialties and two clinics, once per test file. */
  async function createCatalog() {
    await ctx.prisma.specialty.createMany({
      data: [
        { id: "cardiology", name: "Cardiology", description: "Heart" },
        { id: "neurology", name: "Neurology", description: "Brain" },
      ],
    });
    const base = { type: "clinic", address: "Road 1", area: "Banani", city: "Dhaka", phone: "+8801111111" };
    const clinic = await ctx.prisma.clinic.create({ data: { ...base, name: "Test Clinic" } });
    const other = await ctx.prisma.clinic.create({ data: { ...base, name: "Other Clinic", area: "Mirpur" } });
    return { clinic, other };
  }

  async function createAdmin() {
    const email = `admin${++counter}@test.local`;
    await ctx.prisma.user.create({
      data: {
        name: `Admin ${counter}`,
        email,
        passwordHash: await ctx.hashPassword(PASSWORD),
        role: "admin",
        emailVerifiedAt: new Date(),
      },
    });
    return { email, client: await signIn(email, "admin") };
  }

  /** A doctor who already joined (application approved). Pass `onboardingStatus` for an applicant. */
  async function createDoctor(clinic, { published = true, onboardingStatus = "approved" } = {}) {
    const email = `doctor${++counter}@test.local`;
    const user = await ctx.prisma.user.create({
      data: {
        name: `Dr. Number ${counter}`,
        email,
        passwordHash: await ctx.hashPassword(PASSWORD),
        role: "doctor",
        emailVerifiedAt: new Date(),
        doctor: {
          create: {
            specialtyId: "cardiology",
            qualifications: ["MBBS"],
            experienceYears: 5,
            fee: 1000,
            location: "Banani",
            verificationStatus: published ? "verified" : "pending",
            publicationStatus: published ? "published" : "unpublished",
            onboardingStatus,
            clinics: { create: [{ clinicId: clinic.id }] },
          },
        },
      },
      include: { doctor: true },
    });
    return {
      id: user.doctor.id,
      userId: user.id,
      email,
      name: user.name,
      client: await signIn(email, "doctor"),
    };
  }

  async function createPatient({ verified = true } = {}) {
    const email = `patient${++counter}@test.local`;
    const user = await ctx.prisma.user.create({
      data: {
        name: `Patient ${counter}`,
        email,
        phone: "+880 1711 000000",
        passwordHash: await ctx.hashPassword(PASSWORD),
        role: "patient",
        emailVerifiedAt: verified ? new Date() : null,
      },
    });
    return { id: user.id, email, name: user.name, client: await signIn(email, "patient") };
  }

  /**
   * An appointment between the two, written straight to the database so these tests do not
   * depend on the booking feature. Also opens the patient↔doctor conversation, like accepting does.
   */
  async function createAppointment(
    doctor,
    patient,
    clinic,
    { status = "accepted", withConversation = true, hour = 9 } = {},
  ) {
    const startTime = `${String(hour).padStart(2, "0")}:00`;
    const slot = await ctx.prisma.availabilitySlot.create({
      data: {
        doctorId: doctor.id,
        clinicId: clinic.id,
        date: new Date(`${day(3 + hour)}T00:00:00Z`),
        startTime: new Date(`1970-01-01T${startTime}:00Z`),
        endTime: new Date(`1970-01-01T${String(hour).padStart(2, "0")}:30:00Z`),
      },
    });
    const appointment = await ctx.prisma.appointment.create({
      data: {
        patientId: patient.id,
        slotId: slot.id,
        doctorId: doctor.id,
        clinicId: clinic.id,
        patientName: patient.name,
        phone: "+880 1711 000000",
        email: patient.email,
        reason: "A test visit",
        status,
      },
    });
    const conversation = withConversation
      ? await ctx.prisma.conversation.upsert({
          where: { doctorId_patientId: { doctorId: doctor.id, patientId: patient.id } },
          update: {},
          create: { kind: "patient_doctor", doctorId: doctor.id, patientId: patient.id },
        })
      : null;
    return { appointment, conversation };
  }

  return { day, createCatalog, createAdmin, createDoctor, createPatient, createAppointment, signIn };
}
