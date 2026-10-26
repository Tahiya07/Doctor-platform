import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startTestApp } from "./helpers.js";
import { fails, makePeople, ok } from "./people.js";
import { cleanupStorage, pdfBytes, pngBytes, upload, useTestStoragePrefix } from "./uploads.js";

let ctx;
let people;
let clinic;
let other;
let counter = 0;

const registration = (extra = {}) => ({
  name: "Dr. Farhana Ahmed",
  email: `new.doctor${++counter}@test.local`,
  phone: "+880 1711 000000",
  password: "Doctor-pass-123!",
  specialtyId: "cardiology",
  qualifications: ["MBBS", "FCPS"],
  experienceYears: 8,
  fee: 1500,
  location: "Banani, Dhaka",
  facilityIds: [clinic.id],
  ...extra,
});

before(async () => {
  useTestStoragePrefix();
  ctx = await startTestApp();
  people = makePeople(ctx);
  ({ clinic, other } = await people.createCatalog());
});
after(async () => {
  await cleanupStorage(ctx);
  await ctx.stop();
});
beforeEach(() => ctx.resetRateLimits());

describe("doctor self-registration", () => {
  it("creates a pending, unpublished profile and signs the doctor in", async () => {
    const client = ctx.client();
    const body = registration();
    const { user, doctor } = ok(await client.post("/auth/doctor/register", body), 201);

    assert.equal(user.role, "doctor");
    assert.equal(user.doctorId, doctor.id);
    assert.equal(doctor.verificationStatus, "pending");
    assert.equal(doctor.publicationStatus, "unpublished");
    assert.deepEqual(doctor.facilityIds, [clinic.id]);
    assert.equal(doctor.qualifications.length, 2);
    assert.equal(ok(await client.get("/auth/me")).user.doctorId, doctor.id);
    assert.equal(JSON.stringify({ user, doctor }).includes("password"), false);
  });

  it("keeps the new profile out of the public list until an administrator publishes it", async () => {
    const { doctor } = ok(await ctx.client().post("/auth/doctor/register", registration()), 201);
    const listed = ok(await ctx.client().get("/doctors"));
    assert.equal(
      listed.some((item) => item.id === doctor.id),
      false,
    );
    fails(await ctx.client().get(`/doctors/${doctor.id}`), 404, "NOT_FOUND");
  });

  it("lets the doctor sign in again with the chosen password", async () => {
    const body = registration();
    ok(await ctx.client().post("/auth/doctor/register", body), 201);
    ok(
      await ctx
        .client()
        .post("/auth/login", { email: body.email.toUpperCase(), password: body.password, portal: "doctor" }),
    );
  });

  it("refuses a second account with the same email", async () => {
    const body = registration();
    ok(await ctx.client().post("/auth/doctor/register", body), 201);
    fails(
      await ctx.client().post("/auth/doctor/register", registration({ email: body.email })),
      409,
      "EMAIL_TAKEN",
    );
  });

  it("reports every invalid field", async () => {
    const body = fails(
      await ctx.client().post("/auth/doctor/register", {
        name: "D",
        email: "nope",
        phone: "1",
        password: "short",
        specialtyId: "",
        qualifications: [],
        experienceYears: -1,
        fee: -5,
        location: "",
        facilityIds: [],
      }),
      422,
      "VALIDATION_FAILED",
    );
    for (const field of [
      "name",
      "email",
      "phone",
      "password",
      "specialtyId",
      "qualifications",
      "experienceYears",
      "fee",
      "location",
      "facilityIds",
    ])
      assert.ok(body.details[field], `missing message for ${field}`);
  });

  it("checks that the specialty and clinics exist and are active", async () => {
    const unknown = registration({
      specialtyId: "astrology",
      facilityIds: ["00000000-0000-4000-8000-000000000000"],
    });
    const body = fails(await ctx.client().post("/auth/doctor/register", unknown), 422, "VALIDATION_FAILED");
    assert.ok(body.details.specialtyId && body.details.facilityIds);
    await ctx.prisma.clinic.update({ where: { id: other.id }, data: { active: false } });
    fails(
      await ctx.client().post("/auth/doctor/register", registration({ facilityIds: [other.id] })),
      422,
      "VALIDATION_FAILED",
    );
    await ctx.prisma.clinic.update({ where: { id: other.id }, data: { active: true } });
  });

  it("never lets a client choose its own role", async () => {
    const { user } = ok(
      await ctx.client().post("/auth/doctor/register", { ...registration(), role: "admin" }),
      201,
    );
    assert.equal(user.role, "doctor");
  });

  it("limits registrations per connection", async () => {
    for (let index = 0; index < 5; index += 1)
      ok(await ctx.client().post("/auth/doctor/register", registration()), 201);
    fails(await ctx.client().post("/auth/doctor/register", registration()), 429, "RATE_LIMITED");
  });
});

describe("certificates", () => {
  it("stores a PDF or image for the signed-in doctor and lists it", async () => {
    const doctor = await people.createDoctor(clinic, { published: false });
    const first = ok(
      await upload(ctx, doctor.client, "/doctor/certificates", { name: "MBBS degree.pdf" }),
      201,
    );
    assert.equal(first.fileName, "MBBS degree.pdf");
    ok(
      await upload(ctx, doctor.client, "/doctor/certificates", {
        name: "licence.png",
        type: "image/png",
        bytes: pngBytes(),
      }),
      201,
    );

    const list = ok(await doctor.client.get("/doctor/certificates"));
    assert.deepEqual(
      list.map((item) => item.fileName),
      ["MBBS degree.pdf", "licence.png"],
    );
    assert.equal(JSON.stringify(list).includes("storage"), false); // storage keys never leave the server
  });

  it("refuses wrong types, disguised files and oversized files", async () => {
    const doctor = await people.createDoctor(clinic);
    fails(
      await upload(ctx, doctor.client, "/doctor/certificates", {
        name: "notes.txt",
        type: "text/plain",
        bytes: Buffer.from("hello"),
      }),
      422,
      "UNSUPPORTED_FILE",
    );
    fails(
      await upload(ctx, doctor.client, "/doctor/certificates", {
        name: "virus.pdf",
        type: "application/pdf",
        bytes: Buffer.from("MZ not a pdf at all"),
      }),
      422,
      "UNSUPPORTED_FILE",
    );
    fails(
      await upload(ctx, doctor.client, "/doctor/certificates", {
        name: "huge.pdf",
        bytes: pdfBytes(10 * 1024 * 1024),
      }),
      413,
      "FILE_TOO_LARGE",
    );
    const noFile = await fetch(`${ctx.baseUrl}/doctor/certificates`, {
      method: "POST",
      headers: { cookie: `carewell_session=${doctor.client.cookies().carewell_session}` },
    });
    assert.equal(noFile.status, 422);
  });

  it("allows at most five files and lets the doctor remove their own", async () => {
    const doctor = await people.createDoctor(clinic);
    const ids = [];
    for (let index = 0; index < 5; index += 1)
      ids.push(
        ok(await upload(ctx, doctor.client, "/doctor/certificates", { name: `file-${index}.pdf` }), 201).id,
      );
    fails(
      await upload(ctx, doctor.client, "/doctor/certificates", { name: "sixth.pdf" }),
      409,
      "TOO_MANY_FILES",
    );
    assert.equal((await doctor.client.delete(`/doctor/certificates/${ids[0]}`)).status, 204);
    ok(await upload(ctx, doctor.client, "/doctor/certificates", { name: "sixth.pdf" }), 201);
  });

  it("keeps one doctor's certificates away from everyone else", async () => {
    const [owner, stranger] = [await people.createDoctor(clinic), await people.createDoctor(clinic)];
    const file = ok(await upload(ctx, owner.client, "/doctor/certificates"), 201);
    assert.deepEqual(ok(await stranger.client.get("/doctor/certificates")), []);
    fails(await stranger.client.delete(`/doctor/certificates/${file.id}`), 404, "NOT_FOUND");

    const patient = await people.createPatient();
    fails(await patient.client.get("/doctor/certificates"), 403, "FORBIDDEN");
    fails(await upload(ctx, patient.client, "/doctor/certificates"), 403, "FORBIDDEN");
    fails(await upload(ctx, ctx.client(), "/doctor/certificates"), 401, "UNAUTHENTICATED");
  });
});

describe("asking to leave (deactivation request)", () => {
  it("records the request and marks the account as waiting", async () => {
    const doctor = await people.createDoctor(clinic);
    assert.deepEqual(
      ok(
        await doctor.client.post("/doctor/account/deactivation-requests", { reason: "I am moving abroad" }),
        201,
      ),
      { status: "deactivation_requested" },
    );
    assert.equal(ok(await doctor.client.get("/auth/me")).user.accountStatus, "deactivation_requested");
    // The account keeps working while the administrator decides.
    ok(await doctor.client.get("/doctor/certificates"));
  });

  it("allows only one open request and needs a reason", async () => {
    const doctor = await people.createDoctor(clinic);
    fails(
      await doctor.client.post("/doctor/account/deactivation-requests", { reason: "" }),
      422,
      "VALIDATION_FAILED",
    );
    ok(
      await doctor.client.post("/doctor/account/deactivation-requests", { reason: "Retiring from practice" }),
      201,
    );
    fails(
      await doctor.client.post("/doctor/account/deactivation-requests", { reason: "Retiring from practice" }),
      409,
      "ALREADY_REQUESTED",
    );
  });

  it("is only for doctors", async () => {
    const patient = await people.createPatient();
    fails(
      await patient.client.post("/doctor/account/deactivation-requests", { reason: "Leaving the platform" }),
      403,
      "FORBIDDEN",
    );
    fails(
      await ctx.client().post("/doctor/account/deactivation-requests", { reason: "Leaving the platform" }),
      401,
      "UNAUTHENTICATED",
    );
  });
});
