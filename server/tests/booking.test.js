import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startTestApp } from "./helpers.js";

let ctx;
let clinic;
let otherClinic;
let counter = 0;
const PASSWORD = "Pass-word-123!";
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

/** Creates a doctor account directly in the database and signs them in. */
async function createDoctor({ published = true, clinics = [clinic], specialtyId = "cardiology" } = {}) {
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
          specialtyId,
          qualifications: ["MBBS"],
          experienceYears: 5,
          fee: 1000,
          location: "Banani",
          verificationStatus: published ? "verified" : "pending",
          publicationStatus: published ? "published" : "unpublished",
          onboardingStatus: "approved", // already joined; applications are covered in applications.test.js
          clinics: { create: clinics.map((item) => ({ clinicId: item.id })) },
        },
      },
    },
    include: { doctor: true },
  });
  const client = ctx.client();
  ok(await client.post("/auth/login", { email, password: PASSWORD, portal: "doctor" }));
  return { id: user.doctor.id, userId: user.id, email, client };
}

/** Creates a patient directly in the database and signs them in. */
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
  const client = ctx.client();
  ok(await client.post("/auth/login", { email, password: PASSWORD, portal: "patient" }));
  return { id: user.id, email, client };
}

/** Availability created through the doctor's own API; resolves the first (earliest) slot. */
const addSlot = async (doctor, extra = {}) =>
  ok(
    await doctor.client.post("/doctor/availability", {
      facilityId: clinic.id,
      date: day(2),
      startTime: "09:00",
      endTime: "09:10",
      ...extra,
    }),
    201,
  )[0];

const bookingBody = (doctor, slot, extra = {}) => ({
  doctorId: doctor.id,
  facilityId: slot.facilityId,
  date: slot.date,
  slotId: slot.id,
  relationship: "self",
  patientName: "Nadia Rahman",
  phone: "+880 1711 000000",
  email: "nadia@test.local",
  reason: "Chest pain when climbing stairs",
  ...extra,
});

before(async () => {
  ctx = await startTestApp();
  await ctx.prisma.specialty.createMany({
    data: [
      { id: "cardiology", name: "Cardiology", description: "Heart" },
      { id: "neurology", name: "Neurology", description: "Brain" },
    ],
  });
  const base = { type: "clinic", address: "Road 1", area: "Banani", city: "Dhaka", phone: "+8801111111" };
  clinic = await ctx.prisma.clinic.create({ data: { ...base, name: "Booking Clinic" } });
  otherClinic = await ctx.prisma.clinic.create({ data: { ...base, name: "Other Clinic", area: "Mirpur" } });
});
after(() => ctx.stop());
beforeEach(() => ctx.resetRateLimits());

describe("open times for a doctor", () => {
  it("lists a day's available times in order, hiding blocked ones", async () => {
    const doctor = await createDoctor();
    const first = await addSlot(doctor, { date: day(3), startTime: "09:00", endTime: "09:10" });
    await addSlot(doctor, { date: day(3), startTime: "17:30", endTime: "17:40" });
    await addSlot(doctor, { date: day(3), startTime: "12:00", endTime: "12:10", status: "unavailable" });
    await addSlot(doctor, { date: day(4), startTime: "10:00", endTime: "10:10" });

    const slots = ok(
      await ctx.client().get(`/doctors/${doctor.id}/slots?facilityId=${clinic.id}&date=${day(3)}`),
    );
    assert.deepEqual(
      slots.map((slot) => [slot.label, slot.status]),
      [
        ["9:00 AM", "available"],
        ["5:30 PM", "available"],
      ],
    );
    assert.equal(slots[0].id, first.id);
  });

  it("marks times that are taken or already past", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    const taken = await addSlot(doctor, { date: day(2), startTime: "11:00", endTime: "11:10" });
    const request = ok(await patient.client.post("/appointment-requests", bookingBody(doctor, taken)), 201);
    ok(await doctor.client.patch(`/doctor/appointments/${request.id}`, { status: "accepted" }));
    await addSlot(doctor, { date: day(0), startTime: "00:00", endTime: "00:10" });

    const later = ok(
      await ctx.client().get(`/doctors/${doctor.id}/slots?facilityId=${clinic.id}&date=${day(2)}`),
    );
    assert.deepEqual(
      later.map((slot) => slot.status),
      ["booked"],
    );
    const today = ok(
      await ctx.client().get(`/doctors/${doctor.id}/slots?facilityId=${clinic.id}&date=${day(0)}`),
    );
    assert.deepEqual(
      today.map((slot) => slot.status),
      ["passed"],
    );
  });

  it("answers 404 for unpublished doctors and clinics the doctor does not use", async () => {
    const hidden = await createDoctor({ published: false });
    fails(
      await ctx.client().get(`/doctors/${hidden.id}/slots?facilityId=${clinic.id}&date=${day(2)}`),
      404,
      "NOT_FOUND",
    );
    const doctor = await createDoctor();
    fails(
      await ctx.client().get(`/doctors/${doctor.id}/slots?facilityId=${otherClinic.id}&date=${day(2)}`),
      404,
      "NOT_FOUND",
    );
    fails(await ctx.client().get("/doctors/not-an-id/slots?facilityId=x&date=y"), 404, "NOT_FOUND");
    fails(await ctx.client().get(`/doctors/${doctor.id}/slots?date=${day(2)}`), 422, "VALIDATION_FAILED");
  });
});

describe("requesting an appointment", () => {
  it("lets a verified patient book for themselves", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    const slot = await addSlot(doctor);
    const created = ok(await patient.client.post("/appointment-requests", bookingBody(doctor, slot)), 201);

    assert.equal(created.status, "pending");
    assert.equal(created.relationship, "self");
    assert.equal(created.date, slot.date);
    assert.equal(created.time, "9:00 AM");
    assert.equal(created.doctorId, doctor.id);
    assert.equal(created.facilityId, clinic.id);
    assert.equal(created.facility.name, "Booking Clinic");
    assert.equal(created.doctor.specialty, "Cardiology");
  });

  it("lets a patient book for a family member, choosing the time by its label", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    const slot = await addSlot(doctor, { startTime: "17:30", endTime: "17:40" });
    const { slotId, ...withoutId } = bookingBody(doctor, slot, {
      relationship: "child",
      patientName: "Ayaan Rahman",
      time: "5:30 PM",
    });
    assert.ok(slotId);
    const created = ok(await patient.client.post("/appointment-requests", withoutId), 201);
    assert.equal(created.relationship, "child");
    assert.equal(created.patientName, "Ayaan Rahman");
    assert.equal(created.time, "5:30 PM");
  });

  it("needs a signed-in patient with a verified email", async () => {
    const doctor = await createDoctor();
    const slot = await addSlot(doctor);
    fails(
      await ctx.client().post("/appointment-requests", bookingBody(doctor, slot)),
      401,
      "UNAUTHENTICATED",
    );
    const unverified = await createPatient({ verified: false });
    fails(
      await unverified.client.post("/appointment-requests", bookingBody(doctor, slot)),
      403,
      "EMAIL_NOT_VERIFIED",
    );
    fails(await doctor.client.post("/appointment-requests", bookingBody(doctor, slot)), 403, "FORBIDDEN");
  });

  it("reports every invalid field", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    const slot = await addSlot(doctor);
    const body = fails(
      await patient.client.post(
        "/appointment-requests",
        bookingBody(doctor, slot, {
          patientName: "N",
          phone: "12",
          email: "nope",
          reason: "hi",
          relationship: "cousin",
        }),
      ),
      422,
      "VALIDATION_FAILED",
    );
    assert.deepEqual(Object.keys(body.details).sort(), [
      "email",
      "patientName",
      "phone",
      "reason",
      "relationship",
    ]);
  });

  it("refuses blocked, past and unknown times", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    const blocked = await addSlot(doctor, { startTime: "13:00", endTime: "13:10", status: "unavailable" });
    fails(
      await patient.client.post("/appointment-requests", bookingBody(doctor, blocked)),
      422,
      "VALIDATION_FAILED",
    );

    const past = await addSlot(doctor, { date: day(0), startTime: "00:00", endTime: "00:10" });
    fails(
      await patient.client.post("/appointment-requests", bookingBody(doctor, past)),
      422,
      "VALIDATION_FAILED",
    );

    const slot = await addSlot(doctor, { startTime: "14:00", endTime: "14:10" });
    fails(
      await patient.client.post(
        "/appointment-requests",
        bookingBody(doctor, slot, { slotId: undefined, time: "3:00 AM" }),
      ),
      422,
      "VALIDATION_FAILED",
    );
    fails(
      await patient.client.post("/appointment-requests", bookingBody(doctor, slot, { slotId: undefined })),
      422,
      "VALIDATION_FAILED",
    );
    fails(
      await patient.client.post("/appointment-requests", bookingBody(doctor, slot, { date: day(5) })),
      422,
      "VALIDATION_FAILED",
    );
  });

  it("only books published doctors at clinics where they practise", async () => {
    const patient = await createPatient();
    const hidden = await createDoctor({ published: false });
    const slot = await addSlot(hidden);
    fails(await patient.client.post("/appointment-requests", bookingBody(hidden, slot)), 404, "NOT_FOUND");

    const doctor = await createDoctor();
    const open = await addSlot(doctor);
    fails(
      await patient.client.post(
        "/appointment-requests",
        bookingBody(doctor, open, { facilityId: otherClinic.id }),
      ),
      404,
      "NOT_FOUND",
    );
  });

  it("refuses the same patient asking twice for one time", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    const slot = await addSlot(doctor);
    ok(await patient.client.post("/appointment-requests", bookingBody(doctor, slot)), 201);
    fails(
      await patient.client.post(
        "/appointment-requests",
        bookingBody(doctor, slot, { relationship: "parent" }),
      ),
      409,
      "DUPLICATE_REQUEST",
    );
  });

  it("lets several patients ask for one time but only one be accepted", async () => {
    const doctor = await createDoctor();
    const [first, second] = [await createPatient(), await createPatient()];
    const slot = await addSlot(doctor);
    const a = ok(await first.client.post("/appointment-requests", bookingBody(doctor, slot)), 201);
    const b = ok(await second.client.post("/appointment-requests", bookingBody(doctor, slot)), 201);

    ok(await doctor.client.patch(`/doctor/appointments/${a.id}`, { status: "accepted" }));
    fails(
      await doctor.client.patch(`/doctor/appointments/${b.id}`, { status: "accepted" }),
      409,
      "APPOINTMENT_CONFLICT",
    );
    // The time is gone for everyone else now.
    const third = await createPatient();
    fails(
      await third.client.post("/appointment-requests", bookingBody(doctor, slot)),
      409,
      "APPOINTMENT_CONFLICT",
    );
  });

  it("limits how many requests one patient can send per hour", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    for (let index = 0; index < 20; index += 1) {
      const slot = await addSlot(doctor, { date: day(10 + index) });
      ok(await patient.client.post("/appointment-requests", bookingBody(doctor, slot)), 201);
    }
    const extra = await addSlot(doctor, { date: day(40) });
    fails(
      await patient.client.post("/appointment-requests", bookingBody(doctor, extra)),
      429,
      "RATE_LIMITED",
    );
  });
});

describe("a patient's own requests", () => {
  it("lists only their requests, family bookings included", async () => {
    const doctor = await createDoctor();
    const [mine, theirs] = [await createPatient(), await createPatient()];
    const a = await addSlot(doctor, { startTime: "09:00", endTime: "09:10" });
    const b = await addSlot(doctor, { startTime: "10:00", endTime: "10:10" });
    const c = await addSlot(doctor, { startTime: "11:00", endTime: "11:10" });
    ok(await mine.client.post("/appointment-requests", bookingBody(doctor, a)), 201);
    ok(
      await mine.client.post(
        "/appointment-requests",
        bookingBody(doctor, b, { relationship: "spouse", patientName: "Karim Uddin" }),
      ),
      201,
    );
    ok(await theirs.client.post("/appointment-requests", bookingBody(doctor, c)), 201);

    const list = ok(await mine.client.get("/appointments"));
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((item) => item.relationship).sort(), ["self", "spouse"]);
    fails(await ctx.client().get("/appointments"), 401, "UNAUTHENTICATED");
  });

  it("cancels a pending or accepted request, once", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    const slot = await addSlot(doctor);
    const request = ok(await patient.client.post("/appointment-requests", bookingBody(doctor, slot)), 201);

    assert.equal(
      ok(await patient.client.patch(`/appointment-requests/${request.id}`, { status: "cancelled" })).status,
      "cancelled",
    );
    fails(
      await patient.client.patch(`/appointment-requests/${request.id}`, { status: "cancelled" }),
      409,
      "INVALID_TRANSITION",
    );
  });

  it("frees the time when an accepted request is cancelled", async () => {
    const doctor = await createDoctor();
    const [first, second] = [await createPatient(), await createPatient()];
    const slot = await addSlot(doctor);
    const request = ok(await first.client.post("/appointment-requests", bookingBody(doctor, slot)), 201);
    ok(await doctor.client.patch(`/doctor/appointments/${request.id}`, { status: "accepted" }));
    fails(
      await second.client.post("/appointment-requests", bookingBody(doctor, slot)),
      409,
      "APPOINTMENT_CONFLICT",
    );

    ok(await first.client.patch(`/appointment-requests/${request.id}`, { status: "cancelled" }));
    ok(await second.client.post("/appointment-requests", bookingBody(doctor, slot)), 201);
  });

  it("treats someone else's request like one that does not exist, and rejects other statuses", async () => {
    const doctor = await createDoctor();
    const [owner, stranger] = [await createPatient(), await createPatient()];
    const slot = await addSlot(doctor);
    const request = ok(await owner.client.post("/appointment-requests", bookingBody(doctor, slot)), 201);

    fails(
      await stranger.client.patch(`/appointment-requests/${request.id}`, { status: "cancelled" }),
      404,
      "NOT_FOUND",
    );
    fails(
      await owner.client.patch(`/appointment-requests/${request.id}`, { status: "accepted" }),
      422,
      "VALIDATION_FAILED",
    );
    fails(
      await owner.client.patch("/appointment-requests/not-an-id", { status: "cancelled" }),
      404,
      "NOT_FOUND",
    );
  });
});

describe("the doctor's requests", () => {
  it("shows a doctor only their own requests", async () => {
    const [one, two] = [await createDoctor(), await createDoctor()];
    const patient = await createPatient();
    const slot = await addSlot(one);
    const request = ok(
      await patient.client.post(
        "/appointment-requests",
        bookingBody(one, slot, { reason: "Needs a checkup" }),
      ),
      201,
    );

    const mine = ok(await one.client.get("/doctor/appointments"));
    assert.deepEqual(
      mine.map((item) => item.id),
      [request.id],
    );
    assert.equal(mine[0].phone, "+880 1711 000000"); // contact details are visible to the treating doctor
    assert.deepEqual(ok(await two.client.get("/doctor/appointments")), []);
    fails(
      await two.client.patch(`/doctor/appointments/${request.id}`, { status: "accepted" }),
      404,
      "NOT_FOUND",
    );
  });

  it("accepts and rejects pending requests, opening a conversation on accept", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    const [a, b] = [
      await addSlot(doctor, { startTime: "09:00", endTime: "09:10" }),
      await addSlot(doctor, { startTime: "10:00", endTime: "10:10" }),
    ];
    const toAccept = ok(await patient.client.post("/appointment-requests", bookingBody(doctor, a)), 201);
    const toReject = ok(await patient.client.post("/appointment-requests", bookingBody(doctor, b)), 201);

    assert.equal(
      ok(await doctor.client.patch(`/doctor/appointments/${toAccept.id}`, { status: "accepted" })).status,
      "accepted",
    );
    assert.equal(
      ok(await doctor.client.patch(`/doctor/appointments/${toReject.id}`, { status: "rejected" })).status,
      "rejected",
    );
    const threads = await ctx.prisma.conversation.findMany({
      where: { doctorId: doctor.id, patientId: patient.id },
    });
    assert.equal(threads.length, 1);
    assert.equal(threads[0].kind, "patient_doctor");
  });

  it("accepts or rejects pending requests, and completes an accepted visit once its time has come", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    const slot = await addSlot(doctor);
    const request = ok(await patient.client.post("/appointment-requests", bookingBody(doctor, slot)), 201);
    const patch = (status) => doctor.client.patch(`/doctor/appointments/${request.id}`, { status });

    fails(await patch("completed"), 409, "INVALID_TRANSITION"); // not accepted yet
    fails(await patch("cancelled"), 422, "VALIDATION_FAILED");
    ok(await patch("accepted"));
    fails(await patch("rejected"), 409, "INVALID_TRANSITION");
    fails(await patch("completed"), 409, "TOO_EARLY"); // the visit is in two days

    // The visit time arrives.
    await ctx.prisma.availabilitySlot.update({
      where: { id: slot.id },
      data: { date: new Date(`${day(-1)}T00:00:00Z`) },
    });
    assert.equal(ok(await patch("completed")).status, "completed");
    fails(await patch("completed"), 409, "INVALID_TRANSITION");
  });

  it("keeps patients, administrators and guests out of the doctor workspace", async () => {
    const patient = await createPatient();
    fails(await patient.client.get("/doctor/appointments"), 403, "FORBIDDEN");
    fails(await patient.client.get("/doctor/profile"), 403, "FORBIDDEN");
    fails(await ctx.client().get("/doctor/availability"), 401, "UNAUTHENTICATED");
  });
});

describe("the doctor's availability", () => {
  it("creates, lists, blocks, moves and removes their own slots", async () => {
    const doctor = await createDoctor();
    const slot = await addSlot(doctor);
    assert.deepEqual(
      { ...slot, id: undefined },
      {
        id: undefined,
        doctorId: doctor.id,
        facilityId: clinic.id,
        date: day(2),
        startTime: "09:00",
        endTime: "09:10",
        status: "available",
      },
    );
    assert.equal((await ok(await doctor.client.get("/doctor/availability"))).length, 1);

    assert.equal(
      ok(await doctor.client.patch(`/doctor/availability/${slot.id}`, { status: "unavailable" })).status,
      "unavailable",
    );
    assert.equal(
      ok(
        await doctor.client.patch(`/doctor/availability/${slot.id}`, {
          startTime: "15:00",
          endTime: "15:30",
        }),
      ).startTime,
      "15:00",
    );
    assert.equal((await doctor.client.delete(`/doctor/availability/${slot.id}`)).status, 204);
    assert.deepEqual(ok(await doctor.client.get("/doctor/availability")), []);
  });

  it("validates times, dates, clinics and overlaps", async () => {
    const doctor = await createDoctor();
    await addSlot(doctor);
    const post = (extra) =>
      doctor.client.post("/doctor/availability", {
        facilityId: clinic.id,
        date: day(2),
        startTime: "09:00",
        endTime: "09:10",
        ...extra,
      });
    fails(await post({ startTime: "08:50", endTime: "09:20" }), 409, "SLOT_OVERLAP");
    // All or nothing: the free 08:50 and 09:10 slots of that refused window were not created.
    assert.equal(ok(await doctor.client.get("/doctor/availability")).length, 1);
    fails(await post({ startTime: "11:00", endTime: "10:00" }), 422, "VALIDATION_FAILED");
    fails(await post({ date: day(-1), startTime: "12:00", endTime: "12:10" }), 422, "VALIDATION_FAILED");
    fails(
      await post({ facilityId: otherClinic.id, startTime: "12:00", endTime: "12:10" }),
      422,
      "VALIDATION_FAILED",
    );
    ok(await post({ startTime: "09:10", endTime: "09:20" }), 201); // back-to-back is fine
  });

  it("never lets a doctor read or change another doctor's schedule", async () => {
    const [owner, other] = [await createDoctor(), await createDoctor()];
    const slot = await addSlot(owner);
    assert.deepEqual(ok(await other.client.get("/doctor/availability")), []);
    fails(
      await other.client.patch(`/doctor/availability/${slot.id}`, { status: "unavailable" }),
      404,
      "NOT_FOUND",
    );
    fails(await other.client.delete(`/doctor/availability/${slot.id}`), 404, "NOT_FOUND");
    // A doctor id in the body is ignored: the slot still belongs to whoever is signed in.
    const [created] = ok(
      await other.client.post("/doctor/availability", {
        doctorId: owner.id,
        facilityId: clinic.id,
        date: day(2),
        startTime: "09:00",
        endTime: "09:30",
      }),
      201,
    );
    assert.equal(created.doctorId, other.id);
  });

  it("keeps a slot that has appointment requests: block it instead", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    const slot = await addSlot(doctor);
    ok(await patient.client.post("/appointment-requests", bookingBody(doctor, slot)), 201);
    fails(await doctor.client.delete(`/doctor/availability/${slot.id}`), 409, "SLOT_IN_USE");
    ok(await doctor.client.patch(`/doctor/availability/${slot.id}`, { status: "unavailable" }));
  });

  it("shows a new slot in the public next-available time", async () => {
    const doctor = await createDoctor();
    assert.equal(ok(await ctx.client().get(`/doctors/${doctor.id}`)).nextAvailable, "To be scheduled");
    await addSlot(doctor, { date: day(1), startTime: "16:00", endTime: "16:10" });
    assert.equal(ok(await ctx.client().get(`/doctors/${doctor.id}`)).nextAvailable, "Tomorrow, 4:00 PM");
  });
});

describe("the doctor's own profile", () => {
  const profile = (doctor, extra = {}) => ({
    name: "Dr. Updated Name",
    specialtyId: "cardiology",
    qualifications: ["MBBS"],
    experienceYears: 7,
    fee: 1200,
    location: "Banani",
    facilityIds: [clinic.id],
    ...extra,
  });

  it("shows the doctor their own profile, even before it is published", async () => {
    const doctor = await createDoctor({ published: false });
    const own = ok(await doctor.client.get("/doctor/profile"));
    assert.equal(own.id, doctor.id);
    assert.equal(own.publicationStatus, "unpublished");
  });

  it("saves ordinary changes without sending the profile back to review", async () => {
    const doctor = await createDoctor();
    const saved = ok(await doctor.client.patch("/doctor/profile", profile(doctor)));
    assert.equal(saved.reviewRequired, false);
    assert.equal(saved.fee, 1200);
    assert.equal(saved.name, "Dr. Updated Name");
    assert.equal(saved.profileReviewRequired, false);
  });

  it("flags the profile for review when the specialty, qualifications or clinics change", async () => {
    const doctor = await createDoctor();
    const saved = ok(
      await doctor.client.patch("/doctor/profile", profile(doctor, { specialtyId: "neurology" })),
    );
    assert.equal(saved.reviewRequired, true);
    assert.equal(saved.profileReviewRequired, true);
    assert.equal(saved.specialty, "Neurology");

    const second = await createDoctor();
    assert.equal(
      ok(await second.client.patch("/doctor/profile", profile(second, { qualifications: ["MBBS", "FCPS"] })))
        .reviewRequired,
      true,
    );
    const third = await createDoctor();
    const withClinic = ok(
      await third.client.patch(
        "/doctor/profile",
        profile(third, { facilityIds: [clinic.id, otherClinic.id] }),
      ),
    );
    assert.equal(withClinic.reviewRequired, true);
    assert.deepEqual(withClinic.facilityIds.sort(), [clinic.id, otherClinic.id].sort());
  });

  it("keeps a clinic that still has availability", async () => {
    const doctor = await createDoctor({ clinics: [clinic, otherClinic] });
    await addSlot(doctor, { facilityId: otherClinic.id });
    fails(
      await doctor.client.patch("/doctor/profile", profile(doctor, { facilityIds: [clinic.id] })),
      409,
      "CLINIC_IN_USE",
    );
  });

  it("validates the profile and its references", async () => {
    const doctor = await createDoctor();
    const body = fails(
      await doctor.client.patch(
        "/doctor/profile",
        profile(doctor, { name: "D", fee: -5, qualifications: [], facilityIds: [] }),
      ),
      422,
      "VALIDATION_FAILED",
    );
    assert.ok(
      body.details.name && body.details.fee && body.details.qualifications && body.details.facilityIds,
    );
    fails(
      await doctor.client.patch("/doctor/profile", profile(doctor, { specialtyId: "astrology" })),
      422,
      "VALIDATION_FAILED",
    );
  });
});

describe("10-minute slots", () => {
  const window = (doctor, startTime, endTime, extra = {}) =>
    doctor.client.post("/doctor/availability", {
      facilityId: clinic.id,
      date: day(5),
      startTime,
      endTime,
      ...extra,
    });

  it("cuts a window into back-to-back 10-minute slots from the start to the end time", async () => {
    const doctor = await createDoctor();
    const slots = ok(await window(doctor, "09:00", "10:00"), 201);
    assert.deepEqual(
      slots.map((slot) => `${slot.startTime}-${slot.endTime}`),
      ["09:00-09:10", "09:10-09:20", "09:20-09:30", "09:30-09:40", "09:40-09:50", "09:50-10:00"],
    );
    assert.ok(slots.every((slot) => slot.status === "available" && slot.doctorId === doctor.id));
  });

  it("refuses a window that does not divide into 10-minute slots", async () => {
    const doctor = await createDoctor();
    const body = fails(await window(doctor, "09:00", "09:25"), 422, "VALIDATION_FAILED");
    assert.ok(body.details.endTime);
    assert.deepEqual(ok(await doctor.client.get("/doctor/availability")), []);
  });

  it("shows patients every 10-minute time, and an accepted one as booked", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient();
    const slots = ok(await window(doctor, "16:00", "16:30"), 201);
    const request = ok(
      await patient.client.post("/appointment-requests", bookingBody(doctor, slots[1])),
      201,
    );
    ok(await doctor.client.patch(`/doctor/appointments/${request.id}`, { status: "accepted" }));

    const open = ok(
      await ctx.client().get(`/doctors/${doctor.id}/slots?facilityId=${clinic.id}&date=${day(5)}`),
    );
    assert.deepEqual(
      open.map((slot) => [slot.label, slot.status]),
      [
        ["4:00 PM", "available"],
        ["4:10 PM", "booked"],
        ["4:20 PM", "available"],
      ],
    );
    // A booked time cannot be requested again, by this patient or anyone else.
    const other = await createPatient();
    fails(
      await other.client.post("/appointment-requests", bookingBody(doctor, slots[1])),
      409,
      "APPOINTMENT_CONFLICT",
    );
    ok(await other.client.post("/appointment-requests", bookingBody(doctor, slots[2])), 201);
  });
});
