import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startTestApp } from "./helpers.js";
import { fails, makePeople, ok } from "./people.js";
import { cleanupStorage, upload, useTestStoragePrefix } from "./uploads.js";

let ctx;
let people;
let clinic;
let admins;

const day = (offset) => ctx.addDays(ctx.dhakaNow().date, offset);
const inbox = async (person) => ok(await person.client.get("/notifications?limit=100")).items;
const titles = async (person) => (await inbox(person)).map((item) => item.title);
const find = async (person, title) => (await inbox(person)).find((item) => item.title === title);

before(async () => {
  useTestStoragePrefix();
  ctx = await startTestApp();
  people = makePeople(ctx);
  ({ clinic } = await people.createCatalog());
  admins = [await people.createAdmin(), await people.createAdmin()];
});
after(async () => {
  await cleanupStorage(ctx);
  await ctx.stop();
});
beforeEach(() => ctx.resetRateLimits());

/** A published doctor with one open slot, and a verified patient who books it through the API. */
async function booked(extra = {}) {
  const doctor = await people.createDoctor(clinic);
  const patient = await people.createPatient();
  const [slot] = ok(
    await doctor.client.post("/doctor/availability", {
      facilityId: clinic.id,
      date: day(2),
      startTime: "10:00",
      endTime: "10:10",
    }),
    201,
  );
  const request = ok(
    await patient.client.post("/appointment-requests", {
      doctorId: doctor.id,
      facilityId: clinic.id,
      date: slot.date,
      slotId: slot.id,
      relationship: "child",
      patientName: "Ayaan Rahman",
      phone: "+880 1711 000000",
      email: patient.email,
      reason: "Fever for two days",
      ...extra,
    }),
    201,
  );
  return { doctor, patient, request, slot };
}

describe("the notification list", () => {
  it("starts empty and rejects guests", async () => {
    const patient = await people.createPatient();
    assert.deepEqual(ok(await patient.client.get("/notifications")), { items: [], unreadCount: 0 });
    assert.deepEqual(ok(await patient.client.get("/notifications/unread-count")), { count: 0 });
    fails(await ctx.client().get("/notifications"), 401, "UNAUTHENTICATED");
    fails(await ctx.client().post("/notifications/read-all"), 401, "UNAUTHENTICATED");
  });

  it("lists newest first with the fields the bell needs, and counts unread", async () => {
    const { patient } = await booked();
    const body = ok(await patient.client.get("/notifications"));
    assert.equal(body.unreadCount, 1);
    const [item] = body.items;
    assert.equal(item.title, "Appointment request sent");
    assert.equal(item.kind, "appointment");
    assert.equal(item.read, false);
    assert.equal(item.link, "/appointments");
    assert.ok(Date.parse(item.createdAt));
    assert.equal(JSON.stringify(item).includes("userId"), false);
  });

  it("marks one notification, then all of them, as read", async () => {
    const { doctor, request } = await booked();
    await ctx.prisma.notification.create({
      data: {
        userId: (await ctx.prisma.doctor.findUnique({ where: { id: doctor.id } })).userId,
        kind: "account",
        title: "Second one",
      },
    });
    const before = ok(await doctor.client.get("/notifications"));
    assert.equal(before.unreadCount, 2);

    const one = ok(await doctor.client.post(`/notifications/${before.items[0].id}/read`));
    assert.equal(one.read, true);
    assert.deepEqual(ok(await doctor.client.get("/notifications/unread-count")), { count: 1 });
    assert.deepEqual(ok(await doctor.client.post("/notifications/read-all")), { updated: 1 });
    assert.deepEqual(ok(await doctor.client.get("/notifications/unread-count")), { count: 0 });
    assert.equal(ok(await doctor.client.get("/notifications?unread=true")).items.length, 0);
    void request;
  });

  it("keeps everyone's notifications private", async () => {
    const { doctor, patient } = await booked();
    const mine = (await inbox(patient))[0];
    fails(await doctor.client.post(`/notifications/${mine.id}/read`), 404, "NOT_FOUND");
    fails(await patient.client.post("/notifications/not-an-id/read"), 404, "NOT_FOUND");
    assert.equal(
      (await inbox(doctor)).some((item) => item.id === mine.id),
      false,
    );
  });

  it("validates the limit", async () => {
    const patient = await people.createPatient();
    fails(await patient.client.get("/notifications?limit=0"), 422, "VALIDATION_FAILED");
    fails(await patient.client.get("/notifications?limit=500"), 422, "VALIDATION_FAILED");
  });
});

describe("appointment updates", () => {
  it("tells the doctor about a new request and confirms to the patient", async () => {
    const { doctor, patient } = await booked();
    const forDoctor = await find(doctor, "New appointment request");
    assert.match(forDoctor.body, /Ayaan Rahman \(for their child\) asked for/);
    assert.match(forDoctor.body, /Fever for two days/);
    assert.equal(forDoctor.link, "/doctor/dashboard");
    assert.equal((await find(patient, "Appointment request sent")).read, false);
  });

  it("tells the patient when the doctor accepts, and points them to the chat", async () => {
    const { doctor, patient, request } = await booked();
    ok(await doctor.client.patch(`/doctor/appointments/${request.id}`, { status: "accepted" }));
    const accepted = await find(patient, "Appointment accepted");
    assert.match(accepted.body, /accepted your request/);
    assert.equal(accepted.link, "/messages");
    // The doctor did it themselves, so they are not told about their own action.
    assert.equal(
      (await titles(doctor)).some((title) => title.startsWith("Appointment accepted")),
      false,
    );
  });

  it("tells the patient when the doctor rejects", async () => {
    const { doctor, patient, request } = await booked();
    ok(await doctor.client.patch(`/doctor/appointments/${request.id}`, { status: "rejected" }));
    assert.ok(await find(patient, "Appointment not accepted"));
  });

  it("tells the doctor when the patient cancels, but not the patient", async () => {
    const { doctor, patient, request } = await booked();
    ok(await patient.client.patch(`/appointment-requests/${request.id}`, { status: "cancelled" }));
    assert.ok(await find(doctor, "Appointment cancelled by the patient"));
    assert.equal(
      (await titles(patient)).some((title) => title.startsWith("Appointment cancelled")),
      false,
    );
  });

  it("tells both people when an administrator changes a request", async () => {
    const { doctor, patient, request } = await booked();
    ok(await admins[0].client.patch(`/admin/appointments/${request.id}`, { status: "accepted" }));
    assert.match((await find(patient, "Appointment accepted")).body, /accepted/);
    assert.match(
      (await find(doctor, "Appointment accepted by the administration")).body,
      /by the administration/,
    );
    ok(await admins[0].client.patch(`/admin/appointments/${request.id}`, { status: "completed" }));
    assert.ok(await find(patient, "Appointment completed"));
    assert.ok(await find(doctor, "Appointment completed"));
  });
});

describe("messages", () => {
  it("shows one unread entry per conversation, refreshed with the latest message", async () => {
    const { doctor, patient, request } = await booked();
    ok(await doctor.client.patch(`/doctor/appointments/${request.id}`, { status: "accepted" }));
    const [thread] = ok(await patient.client.get("/conversations"));
    for (const text of ["First message", "Second message", "Third message"])
      ok(await patient.client.post(`/conversations/${thread.id}/messages`, { body: text }), 201);

    const entries = (await inbox(doctor)).filter((item) => item.kind === "message");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, `New message from ${patient.name}`);
    assert.equal(entries[0].body, "Third message");
    assert.equal(entries[0].link, "/messages");
  });

  it("clears the entry when the recipient opens the conversation, and notifies the reply", async () => {
    const { doctor, patient, request } = await booked();
    ok(await doctor.client.patch(`/doctor/appointments/${request.id}`, { status: "accepted" }));
    const [thread] = ok(await patient.client.get("/conversations"));
    ok(await patient.client.post(`/conversations/${thread.id}/messages`, { body: "Hello doctor" }), 201);
    assert.equal((await find(doctor, `New message from ${patient.name}`)).read, false);

    ok(await doctor.client.get(`/conversations/${thread.id}/messages`));
    assert.equal((await find(doctor, `New message from ${patient.name}`)).read, true);

    ok(
      await doctor.client.post(`/conversations/${thread.id}/messages`, { body: "Hello, how can I help?" }),
      201,
    );
    const reply = await find(patient, `New message from ${doctor.name}`);
    assert.equal(reply.body, "Hello, how can I help?");
    assert.equal(reply.read, false);
  });

  it("mentions a sent file", async () => {
    const { doctor, patient, request } = await booked();
    ok(await doctor.client.patch(`/doctor/appointments/${request.id}`, { status: "accepted" }));
    const [thread] = ok(await patient.client.get("/conversations"));
    ok(
      await upload(ctx, patient.client, `/conversations/${thread.id}/attachments`, {
        name: "blood test.pdf",
      }),
      201,
    );
    assert.equal(
      (await find(doctor, `New message from ${patient.name}`)).body,
      "Sent a file: blood test.pdf",
    );
  });

  it("notifies every administrator about a doctor's message, and the doctor about the reply", async () => {
    const doctor = await people.createDoctor(clinic);
    const thread = ok(await doctor.client.get("/conversations")).find(
      (item) => item.participantRole === "admin",
    );
    ok(
      await doctor.client.post(`/conversations/${thread.id}/messages`, { body: "Please look at my profile" }),
      201,
    );
    for (const admin of admins)
      assert.equal((await find(admin, `New message from ${doctor.name}`)).body, "Please look at my profile");

    ok(await admins[1].client.post(`/conversations/${thread.id}/messages`, { body: "On it" }), 201);
    assert.equal((await find(doctor, "New message from Carewell administration")).body, "On it");
  });
});

describe("doctor onboarding", () => {
  const registration = (email) => ({
    name: "Dr. Notify Me",
    email,
    phone: "+880 1711 000000",
    password: "Doctor-pass-123!",
    specialtyId: "cardiology",
    qualifications: ["MBBS"],
    experienceYears: 3,
    fee: 800,
    location: "Dhaka",
    facilityIds: [clinic.id],
  });

  it("tells the administrators when an application is submitted, not at registration", async () => {
    const client = ctx.client();
    ok(await client.post("/auth/doctor/register", registration("notify.me@test.local")), 201);
    ok(await upload(ctx, client, "/doctor/certificates", { name: "bmdc.pdf", kind: "bmdc" }), 201);
    assert.equal(await find(admins[0], "New doctor application"), undefined);

    const code = [...ctx.outbox]
      .reverse()
      .find((mail) => mail.to === "notify.me@test.local")
      .subject.slice(0, 6);
    ok(await client.post("/auth/verify-email", { code }));
    ok(await client.post("/doctor/application/submit"));
    for (const admin of admins)
      assert.match((await find(admin, "New doctor application")).body, /Dr\. Notify Me submitted/);
  });

  it("tells the administrators when an approved doctor uploads a certificate", async () => {
    const doctor = await people.createDoctor(clinic);
    ok(await upload(ctx, doctor.client, "/doctor/certificates", { name: "degree.pdf" }), 201);
    ok(await upload(ctx, doctor.client, "/doctor/certificates", { name: "licence.pdf" }), 201);
    const uploads = (await inbox(admins[0])).filter(
      (item) => item.title === "A doctor uploaded a certificate",
    );
    assert.equal(uploads.length >= 1, true);
  });

  it("tells the doctor when the administration verifies, publishes and hides the profile", async () => {
    const doctor = await people.createDoctor(clinic, { published: false });
    ok(await admins[0].client.patch(`/admin/doctors/${doctor.id}/verification`, { status: "verified" }));
    assert.ok(await find(doctor, "Your profile was verified"));
    ok(await admins[0].client.patch(`/admin/doctors/${doctor.id}/publication`, { status: "published" }));
    assert.ok(await find(doctor, "Your profile is now visible to patients"));
    ok(await admins[0].client.patch(`/admin/doctors/${doctor.id}/verification`, { status: "suspended" }));
    assert.ok(await find(doctor, "Your profile was suspended"));
    // Setting the same status again says nothing new.
    const count = (await inbox(doctor)).length;
    ok(await admins[0].client.patch(`/admin/doctors/${doctor.id}/verification`, { status: "suspended" }));
    assert.equal((await inbox(doctor)).length, count);
  });

  it("tells the doctor when the administration edits their profile or schedule", async () => {
    const doctor = await people.createDoctor(clinic);
    ok(
      await admins[0].client.patch(`/admin/doctors/${doctor.id}`, {
        name: "Dr. Renamed",
        specialtyId: "cardiology",
        qualifications: ["MBBS"],
        experienceYears: 6,
        fee: 900,
        location: "Banani",
        facilityIds: [clinic.id],
      }),
    );
    assert.ok(await find(doctor, "Your profile was updated"));
    const [slot] = ok(
      await admins[0].client.post("/admin/availability", {
        doctorId: doctor.id,
        facilityId: clinic.id,
        date: day(3),
        startTime: "09:00",
        endTime: "09:10",
      }),
      201,
    );
    ok(await admins[0].client.patch(`/admin/availability/${slot.id}`, { status: "unavailable" }));
    assert.equal((await admins[0].client.delete(`/admin/availability/${slot.id}`)).status, 204);
    const schedule = (await inbox(doctor)).filter(
      (item) => item.title === "Your schedule was changed by the administration",
    );
    assert.equal(schedule.length, 1); // three changes, one unread line
  });

  it("tells the administrators when a doctor's changes need review", async () => {
    const doctor = await people.createDoctor(clinic);
    ok(
      await doctor.client.patch("/doctor/profile", {
        name: "Dr. Number Review",
        specialtyId: "neurology",
        qualifications: ["MBBS", "FCPS"],
        experienceYears: 5,
        fee: 1000,
        location: "Banani",
        facilityIds: [clinic.id],
      }),
    );
    for (const admin of admins) {
      const note = await find(admin, "A doctor profile needs review");
      assert.match(note.body, /specialty, qualifications/);
    }
  });

  it("handles deactivation requests in both directions", async () => {
    const leaving = await people.createDoctor(clinic);
    ok(
      await leaving.client.post("/doctor/account/deactivation-requests", { reason: "I am moving abroad" }),
      201,
    );
    assert.match((await find(admins[0], "Deactivation request")).body, /moving abroad/);

    const staying = await people.createDoctor(clinic);
    ok(
      await staying.client.post("/doctor/account/deactivation-requests", { reason: "Taking a long break" }),
      201,
    );
    const requests = ok(await admins[0].client.get("/admin/deactivation-requests"));
    ok(
      await admins[0].client.post(
        `/admin/deactivation-requests/${requests.find((item) => item.doctorId === staying.id).id}/decline`,
      ),
    );
    assert.ok(await find(staying, "Deactivation request declined"));

    ok(
      await admins[0].client.post(
        `/admin/deactivation-requests/${requests.find((item) => item.doctorId === leaving.id).id}/approve`,
      ),
    );
    const row = await ctx.prisma.notification.findFirst({
      where: { userId: leaving.userId, title: "Your account was deactivated" },
    });
    assert.ok(row); // waiting for the doctor, even though the account is closed now
  });
});

describe("support and accounts", () => {
  it("tells the administrators about a support request", async () => {
    ok(await ctx.client().post("/support-requests", { message: "I cannot see my appointment history" }), 201);
    for (const admin of admins) assert.equal((await titles(admin)).includes("New support request"), true);
  });

  it("tells a signed-in person when support replies or resolves", async () => {
    const patient = await people.createPatient();
    const created = ok(
      await patient.client.post("/support-requests", { message: "My code never arrived" }),
      201,
    );
    ok(await admins[0].client.patch(`/admin/support-requests/${created.id}`, { status: "in_progress" }));
    assert.ok(await find(patient, "Your support request is being handled"));
    ok(
      await admins[0].client.post(`/admin/support-requests/${created.id}/reply`, {
        message: "We resent it, please check again.",
      }),
    );
    assert.equal((await find(patient, "Carewell support replied")).body, "We resent it, please check again.");
  });

  it("sends security and welcome notices", async () => {
    const client = ctx.client();
    const email = "welcome.new@test.local";
    ok(
      await client.post("/auth/patient/register", {
        name: "New Patient",
        email,
        phone: "+880 1711 000000",
        password: "Correct-horse-1!",
      }),
      201,
    );
    const code = ctx.outbox
      .filter((mail) => mail.to === email)
      .at(-1)
      .text.match(/\b(\d{6})\b/)[1];
    ok(await client.post("/auth/verify-email", { code }));
    const patient = { client };
    assert.ok(await find(patient, "Email verified"));
    ok(
      await client.post("/auth/change-password", {
        currentPassword: "Correct-horse-1!",
        newPassword: "Another-pass-1!23",
      }),
    );
    assert.ok(await find(patient, "Your password was changed"));
  });

  it("never lets a notification failure break the action that caused it", async () => {
    const { doctor, request } = await booked();
    const original = ctx.prisma.notification.create;
    ctx.prisma.notification.create = () => Promise.reject(new Error("boom"));
    try {
      assert.equal(
        ok(await doctor.client.patch(`/doctor/appointments/${request.id}`, { status: "accepted" })).status,
        "accepted",
      );
    } finally {
      ctx.prisma.notification.create = original;
    }
  });
});
