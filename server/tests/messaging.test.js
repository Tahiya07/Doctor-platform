import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startTestApp } from "./helpers.js";
import { fails, makePeople, ok } from "./people.js";
import { cleanupStorage, download, pdfBytes, pngBytes, upload, useTestStoragePrefix } from "./uploads.js";

let ctx;
let people;
let clinic;

before(async () => {
  useTestStoragePrefix();
  ctx = await startTestApp();
  people = makePeople(ctx);
  ({ clinic } = await people.createCatalog());
});
after(async () => {
  await cleanupStorage(ctx);
  await ctx.stop();
});
beforeEach(() => ctx.resetRateLimits());

/** A doctor, a patient and an accepted appointment (so a conversation exists). */
async function pair(options) {
  const doctor = await people.createDoctor(clinic);
  const patient = await people.createPatient();
  const { conversation } = await people.createAppointment(doctor, patient, clinic, options);
  return { doctor, patient, conversation };
}

describe("conversations", () => {
  it("shows each side the other person, with the unread count and eligibility", async () => {
    const { doctor, patient, conversation } = await pair();
    const [forPatient] = ok(await patient.client.get("/conversations"));
    assert.equal(forPatient.id, conversation.id);
    assert.equal(forPatient.participantRole, "doctor");
    assert.equal(forPatient.participantName, doctor.name);
    assert.equal(forPatient.participantId, doctor.id);
    assert.equal(forPatient.unread, 0);
    assert.equal(forPatient.canMessage, true);

    const threads = ok(await doctor.client.get("/conversations"));
    const withPatient = threads.find((item) => item.id === conversation.id);
    assert.equal(withPatient.participantRole, "patient");
    assert.equal(withPatient.participantName, patient.name);
  });

  it("shows a patient only their own conversations", async () => {
    const { conversation } = await pair();
    const stranger = await people.createPatient();
    assert.deepEqual(ok(await stranger.client.get("/conversations")), []);
    fails(await stranger.client.get(`/conversations/${conversation.id}/messages`), 404, "NOT_FOUND");
    fails(
      await stranger.client.post(`/conversations/${conversation.id}/messages`, { body: "hello" }),
      404,
      "NOT_FOUND",
    );
    fails(await ctx.client().get("/conversations"), 401, "UNAUTHENTICATED");
  });

  it("keeps patient↔doctor threads away from other doctors and from administrators", async () => {
    const { conversation } = await pair();
    const otherDoctor = await people.createDoctor(clinic);
    const admin = await people.createAdmin();
    fails(await otherDoctor.client.get(`/conversations/${conversation.id}/messages`), 404, "NOT_FOUND");
    fails(await admin.client.get(`/conversations/${conversation.id}/messages`), 404, "NOT_FOUND");
    assert.equal(
      ok(await admin.client.get("/conversations")).some((item) => item.id === conversation.id),
      false,
    );
  });

  it("answers 404 for ids that cannot exist", async () => {
    const patient = await people.createPatient();
    fails(await patient.client.get("/conversations/not-an-id/messages"), 404, "NOT_FOUND");
    fails(await patient.client.get("/attachments/not-an-id"), 404, "NOT_FOUND");
  });
});

describe("who can talk to whom", () => {
  it("opens a thread for an accepted appointment that has none, for both sides", async () => {
    const doctor = await people.createDoctor(clinic);
    const patient = await people.createPatient();
    await people.createAppointment(doctor, patient, clinic, { withConversation: false });

    const forPatient = ok(await patient.client.get("/conversations"));
    assert.equal(forPatient.length, 1);
    assert.equal(forPatient[0].participantName, doctor.name);
    assert.equal(forPatient[0].canMessage, true);
    assert.equal(
      ok(await doctor.client.get("/conversations")).filter((item) => item.participantRole === "patient")
        .length,
      1,
    );
  });

  it("lets the doctor write first, and the patient answer", async () => {
    const { doctor, patient, conversation } = await pair();
    ok(
      await doctor.client.post(`/conversations/${conversation.id}/messages`, {
        body: "Please bring your last report.",
      }),
      201,
    );
    assert.equal(ok(await patient.client.get("/conversations"))[0].unread, 1);
    ok(
      await patient.client.post(`/conversations/${conversation.id}/messages`, {
        body: "Will do, thank you.",
      }),
      201,
    );
    assert.deepEqual(
      ok(await doctor.client.get(`/conversations/${conversation.id}/messages`)).map(
        (message) => message.isMine,
      ),
      [true, false],
    );
  });

  it("gives every new doctor a thread with the administration from the start", async () => {
    const admin = await people.createAdmin();
    const created = ok(
      await admin.client.post("/admin/doctors", {
        name: "Dr. Brand New",
        email: "brand.new@test.local",
        specialtyId: "cardiology",
        qualifications: ["MBBS"],
        experienceYears: 2,
        fee: 500,
        location: "Dhaka",
        facilityIds: [clinic.id],
      }),
      201,
    );
    const seen = ok(await admin.client.get("/conversations")).find(
      (item) => item.participantId === created.id,
    );
    assert.equal(seen.participantName, "Dr. Brand New");
    assert.equal(seen.canMessage, true);

    const registered = await ctx.client().post("/auth/doctor/register", {
      name: "Dr. Self Registered",
      email: "self.reg@test.local",
      phone: "+880 1711 000000",
      password: "Doctor-pass-123!",
      specialtyId: "cardiology",
      qualifications: ["MBBS"],
      experienceYears: 2,
      fee: 500,
      location: "Dhaka",
      facilityIds: [clinic.id],
    });
    const doctorId = ok(registered, 201).doctor.id;
    assert.ok(ok(await admin.client.get("/conversations")).some((item) => item.participantId === doctorId));
  });
});

describe("messages", () => {
  it("lets both sides write, in order, with isMine for each viewer", async () => {
    const { doctor, patient, conversation } = await pair();
    const path = `/conversations/${conversation.id}/messages`;
    const sent = ok(
      await patient.client.post(path, { body: "  Hello doctor, can I send my reports?  " }),
      201,
    );
    assert.equal(sent.body, "Hello doctor, can I send my reports?");
    assert.equal(sent.isMine, true);
    assert.equal(sent.sender, "patient");
    ok(await doctor.client.post(path, { body: "Yes, please send them here." }), 201);

    const asDoctor = ok(await doctor.client.get(path));
    assert.deepEqual(
      asDoctor.map((message) => [message.sender, message.isMine]),
      [
        ["patient", false],
        ["doctor", true],
      ],
    );
    const asPatient = ok(await patient.client.get(path));
    assert.deepEqual(
      asPatient.map((message) => message.isMine),
      [true, false],
    );
  });

  it("validates the text: 1 to 2000 characters", async () => {
    const { patient, conversation } = await pair();
    const path = `/conversations/${conversation.id}/messages`;
    fails(await patient.client.post(path, { body: "   " }), 422, "VALIDATION_FAILED");
    fails(await patient.client.post(path, { body: "x".repeat(2001) }), 422, "VALIDATION_FAILED");
    ok(await patient.client.post(path, { body: "x".repeat(2000) }), 201);
  });

  it("counts unread messages until the other side opens the conversation", async () => {
    const { doctor, patient, conversation } = await pair();
    const path = `/conversations/${conversation.id}/messages`;
    ok(await patient.client.post(path, { body: "First" }), 201);
    ok(await patient.client.post(path, { body: "Second" }), 201);

    const unread = (threads) => threads.find((item) => item.id === conversation.id).unread;
    assert.equal(unread(ok(await doctor.client.get("/conversations"))), 2);
    assert.equal(unread(ok(await patient.client.get("/conversations"))), 0); // your own messages are never unread
    assert.deepEqual(ok(await doctor.client.get("/conversations/unread-count")), { count: 2 });

    const opened = ok(await doctor.client.get(path));
    assert.equal(opened[0].readAt, undefined); // read receipts show the state before this visit
    assert.equal(unread(ok(await doctor.client.get("/conversations"))), 0);
    assert.deepEqual(ok(await doctor.client.get("/conversations/unread-count")), { count: 0 });
    assert.ok(ok(await patient.client.get(path))[0].readAt); // the sender can now see it was read
  });

  it("sorts conversations by their latest message", async () => {
    const doctor = await people.createDoctor(clinic);
    const [first, second] = [await people.createPatient(), await people.createPatient()];
    const a = (await people.createAppointment(doctor, first, clinic, { hour: 8 })).conversation;
    const b = (await people.createAppointment(doctor, second, clinic, { hour: 9 })).conversation;
    ok(await first.client.post(`/conversations/${a.id}/messages`, { body: "older" }), 201);
    ok(await second.client.post(`/conversations/${b.id}/messages`, { body: "newer" }), 201);
    const order = ok(await doctor.client.get("/conversations"))
      .filter((item) => item.participantRole === "patient")
      .map((item) => item.id);
    assert.deepEqual(order, [b.id, a.id]);
  });

  it("allows messaging only while the doctor has accepted the patient's request", async () => {
    const { patient, doctor, conversation } = await pair({ status: "cancelled" });
    const path = `/conversations/${conversation.id}/messages`;
    assert.equal(ok(await patient.client.get("/conversations"))[0].canMessage, false);
    fails(await patient.client.get(path), 403, "MESSAGING_NOT_ELIGIBLE");
    fails(await patient.client.post(path, { body: "Hello?" }), 403, "MESSAGING_NOT_ELIGIBLE");
    fails(await doctor.client.post(path, { body: "Hello?" }), 403, "MESSAGING_NOT_ELIGIBLE");
  });

  it("limits how fast one person can send", async () => {
    const { patient, conversation } = await pair();
    const path = `/conversations/${conversation.id}/messages`;
    // Sent together: the limit is 60 per minute, and one-by-one over a remote database can outlast the minute.
    const burst = await Promise.all(
      Array.from({ length: 60 }, (_, index) => patient.client.post(path, { body: `message ${index}` })),
    );
    for (const response of burst) ok(response, 201);
    fails(await patient.client.post(path, { body: "one too many" }), 429, "RATE_LIMITED");
  });
});

describe("the doctor ↔ administration thread", () => {
  it("is created for the doctor the first time they open their messages", async () => {
    const doctor = await people.createDoctor(clinic);
    const threads = ok(await doctor.client.get("/conversations"));
    const thread = threads.find((item) => item.participantRole === "admin");
    assert.equal(thread.participantName, "Carewell administration");
    assert.equal(thread.canMessage, true);
    // Asking again does not create a second one.
    assert.equal(
      ok(await doctor.client.get("/conversations")).filter((item) => item.participantRole === "admin").length,
      1,
    );
  });

  it("lets the doctor and an administrator talk to each other", async () => {
    const doctor = await people.createDoctor(clinic);
    const admin = await people.createAdmin();
    const thread = ok(await doctor.client.get("/conversations")).find(
      (item) => item.participantRole === "admin",
    );
    const path = `/conversations/${thread.id}/messages`;
    ok(await doctor.client.post(path, { body: "Please verify my profile." }), 201);

    const seen = ok(await admin.client.get("/conversations")).find((item) => item.id === thread.id);
    assert.equal(seen.participantName, doctor.name);
    assert.equal(seen.participantRole, "doctor");
    assert.equal(seen.unread, 1);
    ok(await admin.client.post(path, { body: "Done, you are verified." }), 201);

    const asAdmin = ok(await admin.client.get(path));
    assert.deepEqual(
      asAdmin.map((message) => [message.sender, message.isMine]),
      [
        ["doctor", false],
        ["admin", true],
      ],
    );
    assert.deepEqual(ok(await doctor.client.get("/conversations/unread-count")), { count: 1 });
    assert.deepEqual(
      ok(await doctor.client.get(path)).map((message) => message.isMine),
      [true, false],
    );
  });

  it("is shared by every administrator and stays private to the doctor", async () => {
    const doctor = await people.createDoctor(clinic);
    const [first, second] = [await people.createAdmin(), await people.createAdmin()];
    const thread = ok(await doctor.client.get("/conversations")).find(
      (item) => item.participantRole === "admin",
    );
    ok(
      await first.client.post(`/conversations/${thread.id}/messages`, { body: "Hello from admin one" }),
      201,
    );
    assert.equal(ok(await second.client.get(`/conversations/${thread.id}/messages`))[0].isMine, true);

    const otherDoctor = await people.createDoctor(clinic);
    fails(await otherDoctor.client.get(`/conversations/${thread.id}/messages`), 404, "NOT_FOUND");
    const patient = await people.createPatient();
    fails(await patient.client.get(`/conversations/${thread.id}/messages`), 404, "NOT_FOUND");
  });

  it("lets an administrator open a thread with a doctor, once", async () => {
    const doctor = await people.createDoctor(clinic);
    const admin = await people.createAdmin();
    const created = ok(await admin.client.post("/conversations", { doctorId: doctor.id }), 201);
    const again = ok(await admin.client.post("/conversations", { doctorId: doctor.id }), 201);
    assert.equal(created.id, again.id);
    fails(
      await admin.client.post("/conversations", { doctorId: "00000000-0000-4000-8000-000000000000" }),
      404,
      "NOT_FOUND",
    );
    fails(await doctor.client.post("/conversations", { doctorId: doctor.id }), 403, "FORBIDDEN");
  });
});

describe("attachments", () => {
  it("sends a file as a message that the other side can open", async () => {
    const { doctor, patient, conversation } = await pair();
    const bytes = pngBytes();
    const sent = ok(
      await upload(ctx, patient.client, `/conversations/${conversation.id}/attachments`, {
        name: "scan result.png",
        type: "image/png",
        bytes,
      }),
      201,
    );
    assert.equal(sent.attachmentName, "scan result.png");
    assert.equal(sent.body, "");
    assert.equal(sent.isMine, true);
    assert.match(sent.attachmentUrl, /^\/api\/v1\/attachments\/[0-9a-f-]{36}$/);

    const seenByDoctor = ok(await doctor.client.get(`/conversations/${conversation.id}/messages`));
    assert.equal(seenByDoctor[0].attachmentName, "scan result.png");
    const file = await download(ctx, doctor.client, sent.attachmentUrl.replace("/api/v1", ""));
    assert.equal(file.status, 200);
    assert.equal(file.type, "image/png");
    assert.ok(file.bytes.equals(bytes));
  });

  it("opens only for the two people in the conversation", async () => {
    const { patient, conversation } = await pair();
    const sent = ok(
      await upload(ctx, patient.client, `/conversations/${conversation.id}/attachments`, {
        name: "report.pdf",
      }),
      201,
    );
    const path = sent.attachmentUrl.replace("/api/v1", "");
    const stranger = await people.createPatient();
    const otherDoctor = await people.createDoctor(clinic);
    const admin = await people.createAdmin();
    assert.equal((await download(ctx, stranger.client, path)).status, 404);
    assert.equal((await download(ctx, otherDoctor.client, path)).status, 404);
    assert.equal((await download(ctx, admin.client, path)).status, 404);
    assert.equal((await download(ctx, ctx.client(), path)).status, 401);
    assert.equal((await download(ctx, patient.client, path)).status, 200);
  });

  it("refuses other file types, disguised files and files over 10 MB", async () => {
    const { patient, conversation } = await pair();
    const path = `/conversations/${conversation.id}/attachments`;
    fails(
      await upload(ctx, patient.client, path, {
        name: "run.exe",
        type: "application/x-msdownload",
        bytes: Buffer.from("MZ"),
      }),
      422,
      "UNSUPPORTED_FILE",
    );
    fails(
      await upload(ctx, patient.client, path, {
        name: "fake.png",
        type: "image/png",
        bytes: Buffer.from("not a png"),
      }),
      422,
      "UNSUPPORTED_FILE",
    );
    fails(
      await upload(ctx, patient.client, path, { name: "huge.pdf", bytes: pdfBytes(10 * 1024 * 1024) }),
      413,
      "FILE_TOO_LARGE",
    );
    assert.equal(ok(await patient.client.get(`/conversations/${conversation.id}/messages`)).length, 0);
  });

  it("follows the same eligibility and access rules as text messages", async () => {
    const closed = await pair({ status: "cancelled" });
    fails(
      await upload(ctx, closed.patient.client, `/conversations/${closed.conversation.id}/attachments`),
      403,
      "MESSAGING_NOT_ELIGIBLE",
    );
    const open = await pair();
    const stranger = await people.createPatient();
    fails(
      await upload(ctx, stranger.client, `/conversations/${open.conversation.id}/attachments`),
      404,
      "NOT_FOUND",
    );
  });
});
