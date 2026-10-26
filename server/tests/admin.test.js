import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./helpers.js";

let ctx;
let admin; // a signed-in administrator
const ADMIN = { email: "admin@test.local", password: "Pass-word-123!" }; // createUser() gives everyone this password
const day = (offset) => ctx.addDays(ctx.dhakaNow().date, offset);

const ok = (response, status = 200) => {
  assert.equal(
    response.status,
    status,
    `expected ${status}, got ${response.status}: ${JSON.stringify(response.body)}`,
  );
  return response.body;
};
const fails = (response, status, code) => {
  assert.equal(
    response.status,
    status,
    `expected ${status}, got ${response.status}: ${JSON.stringify(response.body)}`,
  );
  if (code) assert.equal(response.body.code, code);
  assert.equal(typeof response.body.message, "string");
  return response.body;
};

async function createUser(role, email, extra = {}) {
  return ctx.prisma.user.create({
    data: {
      name: `${role} ${email}`,
      email,
      passwordHash: await ctx.hashPassword("Pass-word-123!"),
      role,
      emailVerifiedAt: new Date(),
      ...extra,
    },
  });
}

before(async () => {
  ctx = await startTestApp();
  await createUser("admin", ADMIN.email);
  admin = ctx.client();
  ok(await admin.post("/auth/login", { ...ADMIN, portal: "admin" }));
});
after(() => ctx.stop());

describe("authentication", () => {
  it("answers 401 to guests asking who they are", async () => {
    fails(await ctx.client().get("/auth/me"), 401, "UNAUTHENTICATED");
  });

  it("signs an administrator in and restores the session", async () => {
    const client = ctx.client();
    const { user } = ok(await client.post("/auth/login", { ...ADMIN, portal: "admin" }));
    assert.deepEqual(
      Object.keys(user).sort(),
      ["accountStatus", "email", "emailVerified", "id", "name", "role"].sort(),
    );
    assert.equal(user.role, "admin");
    assert.equal(user.emailVerified, true);
    assert.deepEqual(ok(await client.get("/auth/me")).user, user);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const wrongPassword = fails(
      await ctx.client().post("/auth/login", { email: ADMIN.email, password: "nope" }),
      401,
      "INVALID_CREDENTIALS",
    );
    const unknown = fails(
      await ctx.client().post("/auth/login", { email: "ghost@test.local", password: "nope" }),
      401,
      "INVALID_CREDENTIALS",
    );
    assert.equal(wrongPassword.message, unknown.message);
  });

  it("matches emails case-insensitively and validates the form", async () => {
    ok(
      await ctx.client().post("/auth/login", { email: ADMIN.email.toUpperCase(), password: ADMIN.password }),
    );
    fails(await ctx.client().post("/auth/login", { email: "", password: "" }), 422, "VALIDATION_FAILED");
  });

  it("refuses a sign-in page that does not match the account's role", async () => {
    fails(await ctx.client().post("/auth/login", { ...ADMIN, portal: "doctor" }), 403, "WRONG_PORTAL");
  });

  it("keeps patients and doctors out of the admin area, and guests too", async () => {
    await createUser("patient", "patient@test.local");
    const patient = ctx.client();
    ok(
      await patient.post("/auth/login", {
        email: "patient@test.local",
        password: "Pass-word-123!",
        portal: "patient",
      }),
    );
    fails(await patient.get("/admin/doctors"), 403, "FORBIDDEN");
    fails(await ctx.client().get("/admin/summary"), 401, "UNAUTHENTICATED");
  });

  it("ends the session on the server when signing out", async () => {
    const client = ctx.client();
    ok(await client.post("/auth/login", ADMIN));
    const stolen = client.cookies();
    assert.equal((await client.post("/auth/logout")).status, 204);
    fails(await client.get("/auth/me"), 401);
    // Replaying the old cookie must not work: the session was revoked server-side.
    const replay = ctx.client();
    replay.setCookies(stolen);
    fails(await replay.get("/auth/me"), 401);
  });

  it("blocks suspended and deactivated accounts", async () => {
    await createUser("doctor", "blocked@test.local", { accountStatus: "deactivated" });
    fails(
      await ctx.client().post("/auth/login", { email: "blocked@test.local", password: "Pass-word-123!" }),
      403,
      "ACCOUNT_RESTRICTED",
    );
  });

  it("rejects state-changing requests from other websites (CSRF)", async () => {
    fails(
      await admin.post("/admin/specialties", { name: "Evil Origin" }, { origin: "https://evil.example" }),
      403,
      "FORBIDDEN_ORIGIN",
    );
    const allowed = await admin.post(
      "/admin/specialties",
      { name: "Allowed Origin" },
      { origin: "http://localhost:5173" },
    );
    ok(allowed, 201);
    // while developing, a second local copy of the website (another port) is fine too
    ok(
      await admin.post("/admin/specialties", { name: "Other Port" }, { origin: "http://localhost:5174" }),
      201,
    );
    fails(
      await admin.post(
        "/admin/specialties",
        { name: "Look Alike" },
        { origin: "http://localhost.evil.example" },
      ),
      403,
      "FORBIDDEN_ORIGIN",
    );
  });

  it("throttles repeated wrong passwords", async () => {
    const client = ctx.client();
    let last;
    for (let i = 0; i < 12; i += 1)
      last = await client.post("/auth/login", { email: "brute@test.local", password: "guess" });
    fails(last, 429, "RATE_LIMITED");
  });
});

describe("specialties", () => {
  it("creates one with a slug as its id", async () => {
    const created = ok(
      await admin.post("/admin/specialties", { name: "Cardiology", description: "Heart & circulation" }),
      201,
    );
    assert.deepEqual(created, {
      id: "cardiology",
      name: "Cardiology",
      slug: "cardiology",
      description: "Heart & circulation",
      active: true,
    });
  });

  it("refuses duplicates and invalid names", async () => {
    fails(await admin.post("/admin/specialties", { name: "cardiology" }), 409, "DUPLICATE_SPECIALTY");
    const body = fails(await admin.post("/admin/specialties", { name: "ab" }), 422, "VALIDATION_FAILED");
    assert.ok(body.details.name);
  });

  it("hides inactive specialties from the public list but not from admins", async () => {
    ok(await admin.post("/admin/specialties", { name: "Neurology", description: "Brain & nerves" }), 201);
    assert.equal(ok(await admin.patch("/admin/specialties/neurology", { active: false })).active, false);
    const publicNames = ok(await ctx.client().get("/specialties")).map((s) => s.name);
    assert.ok(publicNames.includes("Cardiology"));
    assert.ok(!publicNames.includes("Neurology"));
    assert.ok(
      ok(await admin.get("/admin/specialties")).some((s) => s.id === "neurology" && s.active === false),
    );
  });
});

describe("clinics and hospitals", () => {
  const clinic = {
    name: "Carewell Medical Centre",
    type: "clinic",
    address: "House 18, Road 27",
    area: "Dhanmondi",
    city: "Dhaka",
    phone: "+880 2 5500 1200",
    openingHours: "8:00 AM–9:00 PM",
  };

  it("creates, updates and lists them in the shape the frontend uses", async () => {
    const created = ok(await admin.post("/admin/clinics", clinic), 201);
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual({ ...created, id: undefined }, { ...clinic, id: undefined, image: "", active: true });
    const updated = ok(await admin.patch(`/admin/clinics/${created.id}`, { phone: "+880 2 9999 0000" }));
    assert.equal(updated.phone, "+880 2 9999 0000");
    assert.equal(updated.name, clinic.name);
  });

  it("validates input and answers 404 for unknown ids", async () => {
    const body = fails(await admin.post("/admin/clinics", { name: "x" }), 422, "VALIDATION_FAILED");
    assert.ok(body.details.address);
    fails(await admin.patch("/admin/clinics/not-a-uuid", { phone: "+8801700000000" }), 404, "NOT_FOUND");
    fails(
      await admin.patch("/admin/clinics/00000000-0000-4000-8000-000000000000", { phone: "+8801700000000" }),
      404,
      "NOT_FOUND",
    );
  });

  it("deactivates a clinic, hiding it from patients", async () => {
    const hospital = ok(
      await admin.post("/admin/clinics", { ...clinic, name: "Lakeside Hospital", type: "hospital" }),
      201,
    );
    assert.equal(ok(await admin.post(`/admin/clinics/${hospital.id}/deactivation`)).active, false);
    assert.ok(!ok(await ctx.client().get("/clinics")).some((c) => c.id === hospital.id));
    assert.ok(ok(await admin.get("/admin/clinics")).some((c) => c.id === hospital.id && c.active === false));
  });

  it("filters the public list by type", async () => {
    ok(await admin.post("/admin/clinics", { ...clinic, name: "Greenline Hospital", type: "hospital" }), 201);
    const hospitals = ok(await ctx.client().get("/clinics?type=hospital"));
    assert.ok(hospitals.length >= 1 && hospitals.every((c) => c.type === "hospital"));
  });
});

/**
 * Stands in for the doctor's own steps (set a password, upload a BMDC certificate, submit) so these
 * tests can exercise the administrator's side. The certificate row needs no stored file here.
 */
async function submitWithBmdcCertificate(doctorId) {
  await ctx.prisma.doctorCertificate.create({
    data: { doctorId, storageKey: "tests/not-stored.pdf", fileName: "bmdc.pdf", kind: "bmdc" },
  });
  await ctx.prisma.doctor.update({
    where: { id: doctorId },
    data: { onboardingStatus: "submitted", submittedAt: new Date() },
  });
}

describe("doctors", () => {
  let clinicA;
  let clinicB;
  let doctor;
  const profile = (extra = {}) => ({
    name: "Dr. Arif Rahman",
    email: "arif@test.local",
    specialtyId: "cardiology",
    qualifications: ["MBBS", "FCPS"],
    experienceYears: 12,
    fee: 1500,
    location: "Dhanmondi, Dhaka",
    facilityIds: [clinicA.id],
    ...extra,
  });

  before(async () => {
    clinicA = ok(
      await admin.post("/admin/clinics", {
        name: "Doctors Clinic A",
        type: "clinic",
        address: "Road 1",
        area: "Dhanmondi",
        city: "Dhaka",
        phone: "+8802111111",
      }),
      201,
    );
    clinicB = ok(
      await admin.post("/admin/clinics", {
        name: "Doctors Clinic B",
        type: "clinic",
        address: "Road 2",
        area: "Gulshan",
        city: "Dhaka",
        phone: "+8802222222",
      }),
      201,
    );
  });

  it("creates a pending, unpublished profile with the contract's fields", async () => {
    doctor = ok(await admin.post("/admin/doctors", profile()), 201);
    assert.deepEqual(
      { ...doctor, id: undefined },
      {
        id: undefined,
        name: "Dr. Arif Rahman",
        email: "arif@test.local",
        specialtyId: "cardiology",
        specialty: "Cardiology",
        image: "",
        qualifications: ["MBBS", "FCPS"],
        experienceYears: 12,
        fee: 1500,
        feesByFacility: {},
        verificationStatus: "pending",
        publicationStatus: "unpublished",
        accountStatus: "active",
        profileReviewRequired: false,
        onboardingStatus: "invited",
        location: "Dhanmondi, Dhaka",
        facilityIds: [clinicA.id],
        nextAvailable: "To be scheduled",
        availability: [],
        rating: 0,
        reviewCount: 0,
        certificateFiles: [],
        application: {
          status: "invited",
          emailVerified: false,
          bmdcCheck: { result: "unchecked" },
          invitationExpiresAt: doctor.application.invitationExpiresAt,
        },
      },
    );
    assert.ok(ctx.outbox.some((mail) => mail.to === "arif@test.local" && /invited/.test(mail.subject)));
  });

  it("creates the account too, with a password nobody can use", async () => {
    const user = await ctx.prisma.user.findUnique({ where: { email: "arif@test.local" } });
    assert.equal(user.role, "doctor");
    fails(
      await ctx.client().post("/auth/login", { email: "arif@test.local", password: "anything" }),
      401,
      "INVALID_CREDENTIALS",
    );
  });

  it("rejects duplicate emails and bad references", async () => {
    fails(await admin.post("/admin/doctors", profile()), 409, "EMAIL_TAKEN");
    const bad = fails(
      await admin.post(
        "/admin/doctors",
        profile({
          email: "x@test.local",
          specialtyId: "unknown",
          facilityIds: ["00000000-0000-4000-8000-000000000000"],
        }),
      ),
      422,
      "VALIDATION_FAILED",
    );
    assert.ok(bad.details.specialtyId && bad.details.facilityIds);
    const invalid = fails(await admin.post("/admin/doctors", { name: "A" }), 422, "VALIDATION_FAILED");
    assert.ok(invalid.details.email && invalid.details.qualifications);
  });

  it("lists every doctor for admins but none for the public until published", async () => {
    assert.ok(ok(await admin.get("/admin/doctors")).some((d) => d.id === doctor.id));
    assert.deepEqual(ok(await ctx.client().get("/doctors")), []);
    fails(await ctx.client().get(`/doctors/${doctor.id}`), 404, "NOT_FOUND");
  });

  it("only publishes verified profiles", async () => {
    fails(
      await admin.patch(`/admin/doctors/${doctor.id}/publication`, { status: "published" }),
      409,
      "NOT_VERIFIED",
    );
    fails(
      await admin.patch(`/admin/doctors/${doctor.id}/verification`, { status: "verified" }),
      409,
      "APPLICATION_NOT_APPROVED",
    );
    await submitWithBmdcCertificate(doctor.id);
    ok(await admin.patch(`/admin/doctors/${doctor.id}/bmdc-check`, { result: "matched" }));
    assert.equal(
      ok(await admin.post(`/admin/doctors/${doctor.id}/application/approve`)).verificationStatus,
      "verified",
    );
    assert.equal(
      ok(await admin.patch(`/admin/doctors/${doctor.id}/publication`, { status: "published" }))
        .publicationStatus,
      "published",
    );
    fails(await admin.patch(`/admin/doctors/${doctor.id}/verification`, { status: "bogus" }), 422);
  });

  it("shows published doctors publicly, and the filters combine", async () => {
    const publicDoctor = ok(await ctx.client().get(`/doctors/${doctor.id}`));
    assert.equal(publicDoctor.name, "Dr. Arif Rahman");
    const search = (q) =>
      ctx
        .client()
        .get(`/doctors?${q}`)
        .then((r) => ok(r).map((d) => d.id));
    assert.deepEqual(await search("specialty=cardiology&maxFee=2000&verified=true"), [doctor.id]);
    assert.deepEqual(await search("maxFee=1000"), []);
    assert.deepEqual(await search("specialty=neurology"), []);
    assert.deepEqual(await search("query=arif"), [doctor.id]);
    assert.deepEqual(await search("location=dhanmondi"), [doctor.id]);
    assert.deepEqual(await search("location=Doctors%20Clinic%20A"), [doctor.id]);
    assert.deepEqual(await search("location=gulshan"), []);
  });

  it("takes a profile offline when it is no longer verified", async () => {
    const suspended = ok(
      await admin.patch(`/admin/doctors/${doctor.id}/verification`, { status: "suspended" }),
    );
    assert.equal(suspended.publicationStatus, "unpublished");
    fails(await ctx.client().get(`/doctors/${doctor.id}`), 404);
    ok(await admin.patch(`/admin/doctors/${doctor.id}/verification`, { status: "verified" }));
    ok(await admin.patch(`/admin/doctors/${doctor.id}/publication`, { status: "published" }));
  });

  it("updates the profile and moves the doctor between clinics", async () => {
    const updated = ok(
      await admin.patch(`/admin/doctors/${doctor.id}`, {
        ...profile({ name: "Dr. Arif Rahman Khan", fee: 1800, facilityIds: [clinicA.id, clinicB.id] }),
        email: undefined,
      }),
    );
    assert.equal(updated.name, "Dr. Arif Rahman Khan");
    assert.equal(updated.fee, 1800);
    assert.deepEqual([...updated.facilityIds].sort(), [clinicA.id, clinicB.id].sort());
    const trimmed = ok(
      await admin.patch(`/admin/doctors/${doctor.id}`, {
        ...profile({ name: "Dr. Arif Rahman Khan", fee: 1800, facilityIds: [clinicA.id] }),
        email: undefined,
      }),
    );
    assert.deepEqual(trimmed.facilityIds, [clinicA.id]);
  });

  it("refuses to remove a clinic while the doctor still has slots there", async () => {
    ok(
      await admin.post("/admin/availability", {
        doctorId: doctor.id,
        facilityId: clinicA.id,
        date: day(5),
        startTime: "10:00",
        endTime: "10:10",
      }),
      201,
    );
    fails(
      await admin.patch(`/admin/doctors/${doctor.id}`, {
        ...profile({ facilityIds: [clinicB.id] }),
        email: undefined,
      }),
      409,
      "CLINIC_IN_USE",
    );
  });

  it("deactivates a doctor, hiding the profile and signing them out everywhere", async () => {
    const colleague = await createUser("doctor", "colleague@test.local");
    const spec = await ctx.prisma.doctor.create({
      data: {
        userId: colleague.id,
        specialtyId: "cardiology",
        qualifications: ["MBBS"],
        fee: 900,
        location: "Banani",
      },
    });
    const session = ctx.client();
    ok(
      await session.post("/auth/login", {
        email: "colleague@test.local",
        password: "Pass-word-123!",
        portal: "doctor",
      }),
    );
    assert.equal(ok(await session.get("/auth/me")).user.doctorId, spec.id);

    const result = ok(await admin.post(`/admin/doctors/${spec.id}/deactivation`));
    assert.equal(result.accountStatus, "deactivated");
    assert.equal(result.publicationStatus, "inactive");
    fails(await session.get("/auth/me"), 401);
    fails(
      await ctx.client().post("/auth/login", { email: "colleague@test.local", password: "Pass-word-123!" }),
      403,
      "ACCOUNT_RESTRICTED",
    );
    fails(await admin.patch(`/admin/doctors/${spec.id}/publication`, { status: "published" }), 409);
  });

  it("records every decision in the audit log", async () => {
    const entries = await ctx.prisma.auditLog.findMany({
      where: { entityId: doctor.id },
      orderBy: { createdAt: "asc" },
    });
    const actions = entries.map((e) => e.action);
    assert.ok(
      [
        "doctor.create",
        "doctor.bmdc_check",
        "doctor.application.approved",
        "doctor.verification",
        "doctor.publication",
      ].every((a) => actions.includes(a)),
    );
    assert.ok(entries.every((e) => e.actorId));
  });
});

describe("availability", () => {
  let doctor;
  let clinic;
  let other;
  let slot;
  const body = (extra = {}) => ({
    doctorId: doctor.id,
    facilityId: clinic.id,
    date: day(3),
    startTime: "09:00",
    endTime: "09:10",
    ...extra,
  });

  before(async () => {
    clinic = ok(
      await admin.post("/admin/clinics", {
        name: "Slots Clinic",
        type: "clinic",
        address: "Road 3",
        area: "Banani",
        city: "Dhaka",
        phone: "+8803333333",
      }),
      201,
    );
    other = ok(
      await admin.post("/admin/clinics", {
        name: "Unrelated Clinic",
        type: "clinic",
        address: "Road 4",
        area: "Mirpur",
        city: "Dhaka",
        phone: "+8804444444",
      }),
      201,
    );
    doctor = ok(
      await admin.post("/admin/doctors", {
        name: "Dr. Slot Owner",
        email: "slots@test.local",
        specialtyId: "cardiology",
        qualifications: ["MBBS"],
        experienceYears: 5,
        fee: 1000,
        location: "Banani",
        facilityIds: [clinic.id],
      }),
      201,
    );
    await ctx.prisma.doctor.update({ where: { id: doctor.id }, data: { onboardingStatus: "approved" } });
  });

  it("creates a slot in the shape the frontend uses", async () => {
    [slot] = ok(await admin.post("/admin/availability", body()), 201);
    assert.deepEqual(
      { ...slot, id: undefined },
      {
        id: undefined,
        doctorId: doctor.id,
        facilityId: clinic.id,
        date: day(3),
        startTime: "09:00",
        endTime: "09:10",
        status: "available",
      },
    );
  });

  it("refuses overlaps, but allows back-to-back and blocked slots", async () => {
    fails(
      await admin.post("/admin/availability", body({ startTime: "08:50", endTime: "09:20" })),
      409,
      "SLOT_OVERLAP",
    );
    ok(await admin.post("/admin/availability", body({ startTime: "09:10", endTime: "09:20" })), 201);
    ok(
      await admin.post(
        "/admin/availability",
        body({ startTime: "09:20", endTime: "09:30", status: "unavailable" }),
      ),
      201,
    );
  });

  it("validates times, dates and the clinic", async () => {
    fails(await admin.post("/admin/availability", body({ startTime: "11:00", endTime: "10:00" })), 422);
    fails(await admin.post("/admin/availability", body({ date: day(-1) })), 422);
    fails(await admin.post("/admin/availability", body({ startTime: "9am" })), 422);
    fails(
      await admin.post(
        "/admin/availability",
        body({ facilityId: other.id, startTime: "12:00", endTime: "12:10" }),
      ),
      422,
    );
  });

  it("lists a doctor's slots in order", async () => {
    const slots = ok(await admin.get(`/admin/availability?doctorId=${doctor.id}`));
    assert.deepEqual(
      slots.map((s) => s.startTime),
      ["09:00", "09:10", "09:20"],
    );
    fails(await admin.get("/admin/availability"), 404);
  });

  it("blocks, unblocks and moves a slot", async () => {
    assert.equal(
      ok(await admin.patch(`/admin/availability/${slot.id}`, { status: "unavailable" })).status,
      "unavailable",
    );
    assert.equal(
      ok(await admin.patch(`/admin/availability/${slot.id}`, { status: "available" })).status,
      "available",
    );
    const moved = ok(
      await admin.patch(`/admin/availability/${slot.id}`, { startTime: "14:00", endTime: "14:10" }),
    );
    assert.equal(moved.startTime, "14:00");
    fails(
      await admin.patch(`/admin/availability/${slot.id}`, { startTime: "09:15", endTime: "09:25" }),
      409,
      "SLOT_OVERLAP",
    );
    fails(await admin.patch(`/admin/availability/${slot.id}`, { status: "booked" }), 422);
  });

  it("derives a doctor's next available time from real slots", async () => {
    ok(await admin.patch(`/admin/doctors/${doctor.id}/verification`, { status: "verified" }));
    ok(await admin.patch(`/admin/doctors/${doctor.id}/publication`, { status: "published" }));
    ok(
      await admin.post("/admin/availability", body({ date: day(1), startTime: "16:30", endTime: "16:40" })),
      201,
    );
    const found = ok(await ctx.client().get(`/doctors/${doctor.id}`));
    assert.equal(found.nextAvailable, "Tomorrow, 4:30 PM");
    assert.deepEqual(found.availability, ["Tomorrow", "This week"]);
    const tomorrow = ok(await ctx.client().get("/doctors?available=Tomorrow")).map((d) => d.id);
    assert.ok(tomorrow.includes(doctor.id));
    assert.ok(!ok(await ctx.client().get("/doctors?available=Today")).some((d) => d.id === doctor.id));
  });

  it("removes a slot, unless appointment requests refer to it", async () => {
    const [free] = ok(
      await admin.post("/admin/availability", body({ date: day(6), startTime: "15:00", endTime: "15:10" })),
      201,
    );
    assert.equal((await admin.delete(`/admin/availability/${free.id}`)).status, 204);
    fails(await admin.delete(`/admin/availability/${free.id}`), 404);

    const patient = await createUser("patient", "slot-patient@test.local");
    await ctx.prisma.appointment.create({
      data: {
        patientId: patient.id,
        slotId: slot.id,
        doctorId: doctor.id,
        clinicId: clinic.id,
        patientName: "P",
        phone: "+8801700000000",
        email: "p@test.local",
        reason: "Checkup",
      },
    });
    fails(await admin.delete(`/admin/availability/${slot.id}`), 409, "SLOT_IN_USE");
  });
});

describe("appointments", () => {
  let doctor;
  let clinic;
  let slot;
  let first;
  let second;

  before(async () => {
    clinic = ok(
      await admin.post("/admin/clinics", {
        name: "Appointments Clinic",
        type: "clinic",
        address: "Road 5",
        area: "Uttara",
        city: "Dhaka",
        phone: "+8805555555",
      }),
      201,
    );
    doctor = ok(
      await admin.post("/admin/doctors", {
        name: "Dr. Booked",
        email: "booked@test.local",
        specialtyId: "cardiology",
        qualifications: ["MBBS"],
        experienceYears: 7,
        fee: 1200,
        location: "Uttara",
        facilityIds: [clinic.id],
      }),
      201,
    );
    [slot] = ok(
      await admin.post("/admin/availability", {
        doctorId: doctor.id,
        facilityId: clinic.id,
        date: day(2),
        startTime: "17:30",
        endTime: "17:40",
      }),
      201,
    );
    const request = async (email, name, relationship = "self") => {
      const patient = await createUser("patient", email);
      return ctx.prisma.appointment.create({
        data: {
          patientId: patient.id,
          slotId: slot.id,
          doctorId: doctor.id,
          clinicId: clinic.id,
          patientName: name,
          phone: "+8801712345678",
          email,
          reason: "Follow-up visit",
          relationship,
        },
      });
    };
    first = await request("rina@test.local", "Rina Das");
    second = await request("sumi@test.local", "Tuli Akter", "child");
  });

  it("lists every request in the shape the frontend uses", async () => {
    const found = ok(await admin.get("/admin/appointments")).find((a) => a.id === first.id);
    assert.deepEqual(found, {
      id: first.id,
      doctorId: doctor.id,
      facilityId: clinic.id,
      date: day(2),
      time: "5:30 PM",
      patientName: "Rina Das",
      phone: "+8801712345678",
      email: "rina@test.local",
      reason: "Follow-up visit",
      relationship: "self",
      status: "pending",
      doctor: { id: doctor.id, name: "Dr. Booked", specialty: "Cardiology", image: "" },
      facility: {
        id: clinic.id,
        name: "Appointments Clinic",
        address: "Road 5",
        area: "Uttara",
        city: "Dhaka",
      },
    });
    assert.equal(
      ok(await admin.get("/admin/appointments")).find((a) => a.id === second.id).relationship,
      "child",
    );
  });

  it("accepts a request, opens a conversation and marks the slot booked", async () => {
    const accepted = ok(await admin.patch(`/admin/appointments/${first.id}`, { status: "accepted" }));
    assert.equal(accepted.status, "accepted");
    assert.equal(
      await ctx.prisma.conversation.count({ where: { doctorId: doctor.id, patientId: first.patientId } }),
      1,
    );
    const slots = ok(await admin.get(`/admin/availability?doctorId=${doctor.id}`));
    assert.equal(slots.find((s) => s.id === slot.id).status, "booked");
  });

  it("never lets two requests be accepted for one slot", async () => {
    fails(
      await admin.patch(`/admin/appointments/${second.id}`, { status: "accepted" }),
      409,
      "APPOINTMENT_CONFLICT",
    );
    assert.equal(
      ok(await admin.patch(`/admin/appointments/${second.id}`, { status: "rejected" })).status,
      "rejected",
    );
  });

  it("enforces the allowed status changes", async () => {
    fails(
      await admin.patch(`/admin/appointments/${second.id}`, { status: "accepted" }),
      409,
      "INVALID_TRANSITION",
    );
    fails(
      await admin.patch(`/admin/appointments/${first.id}`, { status: "pending" }),
      409,
      "INVALID_TRANSITION",
    );
    assert.equal(
      ok(await admin.patch(`/admin/appointments/${first.id}`, { status: "completed" })).status,
      "completed",
    );
    fails(
      await admin.patch(`/admin/appointments/${first.id}`, { status: "cancelled" }),
      409,
      "INVALID_TRANSITION",
    );
    fails(
      await admin.patch("/admin/appointments/00000000-0000-4000-8000-000000000000", { status: "accepted" }),
      404,
    );
  });
});

describe("summary", () => {
  it("reports live counts for the dashboard", async () => {
    const summary = ok(await admin.get("/admin/summary"));
    assert.equal(
      summary.pendingDoctors,
      await ctx.prisma.doctor.count({ where: { onboardingStatus: "submitted" } }),
    );
    assert.equal(
      summary.verifiedDoctors,
      await ctx.prisma.doctor.count({ where: { verificationStatus: "verified" } }),
    );
    assert.equal(summary.activeFacilities, await ctx.prisma.clinic.count({ where: { active: true } }));
    assert.equal(summary.activeSpecialties, await ctx.prisma.specialty.count({ where: { active: true } }));
    assert.equal(summary.monthlyAppointments.length, 12);
    assert.match(summary.monthlyAppointments[0].month, /^\d{4}-\d{2}$/);
    // The completed appointment above is dated in the future, so it falls outside the 12 past months.
    assert.ok(summary.monthlyAppointments.every((m) => Number.isInteger(m.count)));
    assert.ok(summary.appointmentsToday >= 0);
  });
});

describe("error format", () => {
  it("answers unknown routes with the standard error shape", async () => {
    fails(await ctx.client().get("/nothing-here"), 404, "NOT_FOUND");
  });

  it("answers malformed JSON with 400, not a crash", async () => {
    const response = await fetch(`${ctx.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_JSON");
  });
});
