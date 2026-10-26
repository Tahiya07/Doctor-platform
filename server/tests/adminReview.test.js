import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startTestApp } from "./helpers.js";
import { fails, makePeople, ok } from "./people.js";
import { cleanupStorage, download, pdfBytes, pngBytes, upload, useTestStoragePrefix } from "./uploads.js";

let ctx;
let people;
let clinic;
let admin;

before(async () => {
  useTestStoragePrefix();
  ctx = await startTestApp();
  people = makePeople(ctx);
  ({ clinic } = await people.createCatalog());
  admin = await people.createAdmin();
});
after(async () => {
  await cleanupStorage(ctx);
  await ctx.stop();
});
beforeEach(() => ctx.resetRateLimits());

describe("reviewing a doctor's certificates", () => {
  it("lists doctors with their certificate files for the verification screen", async () => {
    const doctor = await people.createDoctor(clinic, { published: false });
    const bare = await people.createDoctor(clinic, { published: false });
    ok(await upload(ctx, doctor.client, "/doctor/certificates", { name: "degree.pdf" }), 201);

    const doctors = ok(await admin.client.get("/admin/doctors"));
    const withFile = doctors.find((item) => item.id === doctor.id);
    assert.equal(withFile.certificateFiles.length, 1);
    assert.equal(withFile.certificateFiles[0].fileName, "degree.pdf");
    assert.equal(
      withFile.certificateFiles[0].url,
      `/api/v1/admin/doctors/${doctor.id}/certificates/${withFile.certificateFiles[0].id}`,
    );
    assert.deepEqual(doctors.find((item) => item.id === bare.id).certificateFiles, []);
    assert.equal(withFile.email, doctor.email); // the normal doctor fields are still there
    assert.equal(JSON.stringify(doctors).includes("storage"), false);
  });

  it("lets an administrator open a certificate, and nobody else", async () => {
    const doctor = await people.createDoctor(clinic, { published: false });
    const bytes = pdfBytes(200);
    const file = ok(
      await upload(ctx, doctor.client, "/doctor/certificates", { name: "degree.pdf", bytes }),
      201,
    );
    const path = `/admin/doctors/${doctor.id}/certificates/${file.id}`;

    const opened = await download(ctx, admin.client, path);
    assert.equal(opened.status, 200);
    assert.equal(opened.type, "application/pdf");
    assert.ok(opened.bytes.equals(bytes));

    assert.equal((await download(ctx, doctor.client, path)).status, 403); // not even the owner, via the admin route
    assert.equal((await download(ctx, ctx.client(), path)).status, 401);
    const other = await people.createDoctor(clinic);
    assert.equal(
      (await download(ctx, admin.client, `/admin/doctors/${other.id}/certificates/${file.id}`)).status,
      404,
    );
    const image = ok(
      await upload(ctx, doctor.client, "/doctor/certificates", {
        name: "photo.png",
        type: "image/png",
        bytes: pngBytes(),
      }),
      201,
    );
    assert.equal(
      (await download(ctx, admin.client, `/admin/doctors/${doctor.id}/certificates/${image.id}`)).type,
      "image/png",
    );
  });

  it("keeps the rest of the administrator tools working alongside it", async () => {
    const doctor = await people.createDoctor(clinic, { published: false });
    assert.equal(
      ok(await admin.client.patch(`/admin/doctors/${doctor.id}/verification`, { status: "verified" }))
        .verificationStatus,
      "verified",
    );
    assert.equal(ok(await admin.client.get("/admin/clinics")).length >= 1, true);
    fails(await doctor.client.get("/admin/doctors"), 403, "FORBIDDEN");
    fails(await ctx.client().get("/admin/doctors"), 401, "UNAUTHENTICATED");
  });
});

describe("deactivation requests", () => {
  async function requested(reason = "I am relocating") {
    const doctor = await people.createDoctor(clinic);
    ok(await doctor.client.post("/doctor/account/deactivation-requests", { reason }), 201);
    const [request] = ok(await admin.client.get("/admin/deactivation-requests")).filter(
      (item) => item.doctorId === doctor.id,
    );
    return { doctor, request };
  }

  it("lists open requests with the doctor's name and reason", async () => {
    const { doctor, request } = await requested("Retiring next month");
    assert.equal(request.doctorName, doctor.name);
    assert.equal(request.doctorEmail, doctor.email);
    assert.equal(request.reason, "Retiring next month");
    assert.equal(request.status, "open");
    fails(await doctor.client.get("/admin/deactivation-requests"), 403, "FORBIDDEN");
  });

  it("approving deactivates the account, hides the profile and ends their sessions", async () => {
    const { doctor, request } = await requested();
    const decided = ok(await admin.client.post(`/admin/deactivation-requests/${request.id}/approve`));
    assert.equal(decided.status, "approved");
    assert.ok(decided.decidedAt);

    fails(await doctor.client.get("/auth/me"), 401, "UNAUTHENTICATED");
    fails(
      await ctx.client().post("/auth/login", { email: doctor.email, password: "Pass-word-123!" }),
      403,
      "ACCOUNT_RESTRICTED",
    );
    const profile = (await ctx.prisma.doctor.findUnique({ where: { id: doctor.id } })).publicationStatus;
    assert.equal(profile, "inactive");
    assert.equal(
      ok(await admin.client.get("/admin/deactivation-requests?status=open")).some(
        (item) => item.id === request.id,
      ),
      false,
    );
    assert.equal(
      ok(await admin.client.get("/admin/deactivation-requests?status=approved")).some(
        (item) => item.id === request.id,
      ),
      true,
    );
  });

  it("declining returns the doctor to a normal active account", async () => {
    const { doctor, request } = await requested();
    assert.equal(
      ok(await admin.client.post(`/admin/deactivation-requests/${request.id}/decline`)).status,
      "declined",
    );
    assert.equal(ok(await doctor.client.get("/auth/me")).user.accountStatus, "active");
    // They may ask again later.
    ok(
      await doctor.client.post("/doctor/account/deactivation-requests", { reason: "Still want to leave" }),
      201,
    );
  });

  it("decides each request only once", async () => {
    const { request } = await requested();
    ok(await admin.client.post(`/admin/deactivation-requests/${request.id}/decline`));
    fails(
      await admin.client.post(`/admin/deactivation-requests/${request.id}/approve`),
      409,
      "ALREADY_DECIDED",
    );
    fails(await admin.client.post("/admin/deactivation-requests/not-an-id/approve"), 404, "NOT_FOUND");
    fails(await admin.client.get("/admin/deactivation-requests?status=weird"), 422, "VALIDATION_FAILED");
  });

  it("records each decision in the audit log", async () => {
    const { doctor, request } = await requested();
    ok(await admin.client.post(`/admin/deactivation-requests/${request.id}/approve`));
    const entries = await ctx.prisma.auditLog.findMany({
      where: { entityId: doctor.id, action: "deactivation.approve" },
    });
    assert.equal(entries.length, 1);
  });
});

describe("support requests", () => {
  it("accepts a message from a guest, with or without an email", async () => {
    const created = ok(
      await ctx.client().post("/support-requests", {
        message: "I cannot find my doctor's profile",
        email: "Guest@Test.Local",
      }),
      201,
    );
    assert.equal(created.status, "received");
    assert.ok(created.id);
    ok(
      await ctx.client().post("/support-requests", { message: "No email on this one, sorry", email: "" }),
      201,
    );
    const row = await ctx.prisma.supportRequest.findUnique({ where: { id: created.id } });
    assert.equal(row.email, "guest@test.local");
    assert.equal(row.userId, null);
  });

  it("links a signed-in person's message to their account", async () => {
    const patient = await people.createPatient();
    const created = ok(
      await patient.client.post("/support-requests", { message: "My email code never arrived" }),
      201,
    );
    const row = await ctx.prisma.supportRequest.findUnique({ where: { id: created.id } });
    assert.equal(row.userId, patient.id);
    assert.equal(row.email, patient.email);
  });

  it("validates the message and the email, and limits how often it can be sent", async () => {
    fails(await ctx.client().post("/support-requests", { message: "short" }), 422, "VALIDATION_FAILED");
    fails(
      await ctx.client().post("/support-requests", { message: "x".repeat(2001) }),
      422,
      "VALIDATION_FAILED",
    );
    fails(
      await ctx.client().post("/support-requests", { message: "A proper message here", email: "nope" }),
      422,
      "VALIDATION_FAILED",
    );
    ctx.resetRateLimits();
    for (let index = 0; index < 5; index += 1)
      ok(
        await ctx.client().post("/support-requests", { message: `Message number ${index} for support` }),
        201,
      );
    fails(
      await ctx.client().post("/support-requests", { message: "Message number six for support" }),
      429,
      "RATE_LIMITED",
    );
  });

  it("lists requests for administrators, filters by status and updates it", async () => {
    const mine = ok(
      await ctx
        .client()
        .post("/support-requests", { message: "Please call me about billing", email: "billing@test.local" }),
      201,
    );
    const list = ok(await admin.client.get("/admin/support-requests"));
    const found = list.find((item) => item.id === mine.id);
    assert.equal(found.email, "billing@test.local");
    assert.equal(found.status, "received");

    assert.equal(
      ok(await admin.client.patch(`/admin/support-requests/${mine.id}`, { status: "in_progress" })).status,
      "in_progress",
    );
    assert.equal(
      ok(await admin.client.get("/admin/support-requests?status=in_progress")).some(
        (item) => item.id === mine.id,
      ),
      true,
    );
    assert.equal(
      ok(await admin.client.get("/admin/support-requests?status=received")).some(
        (item) => item.id === mine.id,
      ),
      false,
    );
    fails(
      await admin.client.patch(`/admin/support-requests/${mine.id}`, { status: "closed" }),
      422,
      "VALIDATION_FAILED",
    );
    fails(
      await admin.client.patch("/admin/support-requests/00000000-0000-4000-8000-000000000000", {
        status: "resolved",
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("emails a reply and marks the request resolved", async () => {
    const mine = ok(
      await ctx
        .client()
        .post("/support-requests", { message: "How do I change my phone number?", email: "ask@test.local" }),
      201,
    );
    ctx.outbox.length = 0;
    const replied = ok(
      await admin.client.post(`/admin/support-requests/${mine.id}/reply`, {
        message: "Open My profile and edit your phone number.",
      }),
    );
    assert.equal(replied.status, "resolved");
    const mail = ctx.outbox.find((item) => item.to === "ask@test.local");
    assert.match(mail.text, /Open My profile/);
    assert.match(mail.text, /How do I change my phone number\?/);

    const another = ok(
      await ctx
        .client()
        .post("/support-requests", { message: "A second question for you", email: "ask2@test.local" }),
      201,
    );
    assert.equal(
      ok(
        await admin.client.post(`/admin/support-requests/${another.id}/reply`, {
          message: "Looking into it.",
          resolve: false,
        }),
      ).status,
      "in_progress",
    );
  });

  it("cannot reply to someone who left no address", async () => {
    const anonymous = ok(
      await ctx.client().post("/support-requests", { message: "Anonymous question with no email" }),
      201,
    );
    fails(
      await admin.client.post(`/admin/support-requests/${anonymous.id}/reply`, { message: "Hello there" }),
      422,
      "NO_ADDRESS",
    );
  });

  it("keeps the support inbox away from everyone except administrators", async () => {
    const patient = await people.createPatient();
    fails(await patient.client.get("/admin/support-requests"), 403, "FORBIDDEN");
    fails(await ctx.client().get("/admin/support-requests"), 401, "UNAUTHENTICATED");
    fails(
      await patient.client.post("/admin/support-requests/00000000-0000-4000-8000-000000000000/reply", {
        message: "Hi",
      }),
      403,
      "FORBIDDEN",
    );
  });
});
