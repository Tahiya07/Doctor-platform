import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startTestApp } from "./helpers.js";
import { fails, makePeople, ok } from "./people.js";
import { cleanupStorage, upload, useTestStoragePrefix } from "./uploads.js";

// Joining Carewell as a doctor: self-application and administrator invitation, the BMDC
// certificate check, and the decisions that follow.

let ctx;
let people;
let clinic;
let admin;
let counter = 0;

const lastMail = (to, subject) =>
  [...ctx.outbox].reverse().find((mail) => mail.to === to && (!subject || subject.test(mail.subject)));
const codeFrom = (to) => lastMail(to, /verification code/).subject.slice(0, 6);
const tokenFrom = (mail) => /token=([\w-]+)/.exec(mail.text)[1];
const inbox = async (client) => ok(await client.get("/notifications?limit=100")).items;

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

/** Registers a doctor (step 1) and resolves `{ client, email, doctorId }`. */
async function register() {
  const client = ctx.client();
  const email = `applicant${++counter}@test.local`;
  const { doctor } = ok(
    await client.post("/auth/doctor/register", {
      name: `Dr. Applicant ${counter}`,
      email,
      phone: "+880 1711 000000",
      password: "Doctor-pass-123!",
      specialtyId: "cardiology",
      qualifications: ["MBBS"],
      experienceYears: 4,
      fee: 900,
      location: "Dhaka",
      facilityIds: [clinic.id],
    }),
    201,
  );
  return { client, email, doctorId: doctor.id };
}

/** Registers, confirms the email, uploads a BMDC certificate and submits. */
async function submitted() {
  const applicant = await register();
  ok(await applicant.client.post("/auth/verify-email", { code: codeFrom(applicant.email) }));
  ok(await upload(ctx, applicant.client, "/doctor/certificates", { name: "bmdc.pdf", kind: "bmdc" }), 201);
  ok(await applicant.client.post("/doctor/application/submit"));
  return applicant;
}

const check = (doctorId, result, note) =>
  admin.client.patch(`/admin/doctors/${doctorId}/bmdc-check`, { result, note });

describe("self-application", () => {
  it("walks in order: register, confirm email, BMDC certificate, submit", async () => {
    const { client, email } = await register();
    let application = ok(await client.get("/doctor/application"));
    assert.equal(application.status, "in_progress");
    assert.equal(application.emailVerified, false);
    assert.equal(application.canSubmit, false);
    assert.equal(ok(await client.get("/auth/me")).user.onboardingStatus, "in_progress");

    // Nothing reaches the administrators until the doctor submits.
    assert.equal(
      (await inbox(admin.client)).some((item) => item.title === "New doctor application"),
      false,
    );
    fails(await client.post("/doctor/application/submit"), 409, "EMAIL_NOT_VERIFIED");

    ok(await client.post("/auth/verify-email", { code: codeFrom(email) }));
    fails(await client.post("/doctor/application/submit"), 422, "BMDC_CERTIFICATE_REQUIRED");

    ok(await upload(ctx, client, "/doctor/certificates", { name: "degree.pdf", kind: "degree" }), 201);
    fails(await client.post("/doctor/application/submit"), 422, "BMDC_CERTIFICATE_REQUIRED");
    ok(await upload(ctx, client, "/doctor/certificates", { name: "bmdc.pdf", kind: "bmdc" }), 201);
    application = ok(await client.get("/doctor/application"));
    assert.equal(application.canSubmit, true);
    assert.deepEqual(
      application.certificates.map((item) => item.kind),
      ["degree", "bmdc"],
    );

    ctx.outbox.length = 0;
    application = ok(await client.post("/doctor/application/submit"));
    assert.equal(application.status, "submitted");
    assert.ok(application.submittedAt);
    assert.ok(lastMail(email, /received your Carewell application/));
    assert.ok(lastMail(admin.email, /New doctor application/));
    assert.ok((await inbox(admin.client)).some((item) => item.title === "New doctor application"));
    fails(await client.post("/doctor/application/submit"), 409, "INVALID_TRANSITION");
  });

  it("keeps applicants out of appointments and availability until approved", async () => {
    const { client } = await register();
    fails(await client.get("/doctor/appointments"), 403, "APPLICATION_NOT_APPROVED");
    fails(await client.get("/doctor/availability"), 403, "APPLICATION_NOT_APPROVED");
    ok(await client.get("/doctor/profile")); // completing the profile is allowed
    ok(await client.get("/conversations")); // and so is messaging the administration
  });

  it("freezes the profile and certificates while the administration reviews", async () => {
    const { client, doctorId } = await submitted();
    const files = ok(await client.get("/doctor/certificates"));
    fails(await upload(ctx, client, "/doctor/certificates", { kind: "degree" }), 409, "APPLICATION_LOCKED");
    fails(await client.delete(`/doctor/certificates/${files[0].id}`), 409, "APPLICATION_LOCKED");
    fails(
      await client.patch("/doctor/profile", {
        name: "Dr. Changed",
        specialtyId: "cardiology",
        qualifications: ["MBBS"],
        experienceYears: 4,
        fee: 900,
        location: "Dhaka",
        facilityIds: [clinic.id],
      }),
      409,
      "APPLICATION_LOCKED",
    );
    assert.equal(
      (await ctx.prisma.doctor.findUnique({ where: { id: doctorId } })).onboardingStatus,
      "submitted",
    );
  });

  it("refuses an unknown certificate kind", async () => {
    const { client } = await register();
    fails(await upload(ctx, client, "/doctor/certificates", { kind: "selfie" }), 422, "VALIDATION_FAILED");
  });
});

describe("the BMDC check and the decision", () => {
  it("approves only after a matched BMDC check, then opens the workspace", async () => {
    const { client, email, doctorId } = await submitted();
    fails(await admin.client.post(`/admin/doctors/${doctorId}/application/approve`), 409, "BMDC_NOT_MATCHED");
    fails(await check(doctorId, "mismatch"), 422, "VALIDATION_FAILED"); // a mismatch needs a note
    ok(await check(doctorId, "mismatch", "Registration number differs"));
    fails(await admin.client.post(`/admin/doctors/${doctorId}/application/approve`), 409, "BMDC_NOT_MATCHED");

    const checked = ok(await check(doctorId, "matched"));
    assert.equal(checked.application.bmdcCheck.result, "matched");
    assert.equal(checked.application.bmdcCheck.checkedBy, `Admin 1`);

    ctx.outbox.length = 0;
    const approved = ok(await admin.client.post(`/admin/doctors/${doctorId}/application/approve`));
    assert.equal(approved.application.status, "approved");
    assert.equal(approved.verificationStatus, "verified");
    assert.equal(approved.publicationStatus, "unpublished");
    assert.ok(lastMail(email, /was approved/));
    assert.ok((await inbox(client)).some((item) => item.title === "Your application was approved"));
    ok(await client.get("/doctor/appointments"));
    ok(await client.get("/doctor/availability"));

    // Publishing emails the doctor too.
    ok(await admin.client.patch(`/admin/doctors/${doctorId}/publication`, { status: "published" }));
    assert.ok(lastMail(email, /profile is live/));

    const audit = await ctx.prisma.auditLog.findMany({ where: { entityId: doctorId } });
    assert.ok(audit.some((row) => row.action === "doctor.bmdc_check"));
    assert.ok(audit.some((row) => row.action === "doctor.application.approved"));
  });

  it("never shows the doctor the administrator's BMDC note", async () => {
    const { client, doctorId } = await submitted();
    ok(await check(doctorId, "not_found", "Private: no such registration number"));
    assert.equal(JSON.stringify(ok(await client.get("/doctor/application"))).includes("Private"), false);
  });

  it("sends an application back with a note, and takes it again after the changes", async () => {
    const { client, email, doctorId } = await submitted();
    fails(
      await admin.client.post(`/admin/doctors/${doctorId}/application/request-changes`, { note: "" }),
      422,
    );
    ok(
      await admin.client.post(`/admin/doctors/${doctorId}/application/request-changes`, {
        note: "Upload a clearer scan of the BMDC certificate.",
      }),
    );
    const application = ok(await client.get("/doctor/application"));
    assert.equal(application.status, "changes_requested");
    assert.equal(application.note, "Upload a clearer scan of the BMDC certificate.");
    assert.match(lastMail(email, /needs changes/).text, /clearer scan/);

    // A new BMDC certificate means the earlier comparison no longer counts.
    ok(await check(doctorId, "matched"));
    ok(await upload(ctx, client, "/doctor/certificates", { name: "bmdc-clear.pdf", kind: "bmdc" }), 201);
    const doctor = await ctx.prisma.doctor.findUnique({ where: { id: doctorId } });
    assert.equal(doctor.bmdcCheck, "unchecked");

    assert.equal(ok(await client.post("/doctor/application/submit")).status, "submitted");
    assert.equal(ok(await client.get("/doctor/application")).note, undefined);
  });

  it("rejects with a reason, and lets the doctor reapply only after 30 days", async () => {
    const { client, email, doctorId } = await submitted();
    const rejected = ok(
      await admin.client.post(`/admin/doctors/${doctorId}/application/reject`, {
        note: "The certificate does not match the BMDC register.",
      }),
    );
    assert.equal(rejected.application.status, "rejected");
    assert.equal(rejected.verificationStatus, "rejected");
    assert.match(lastMail(email, /not approved/).text, /apply again from/);

    const application = ok(await client.get("/doctor/application"));
    assert.ok(application.reapplyAt);
    fails(await client.post("/doctor/application/reopen"), 409, "REAPPLY_TOO_SOON");
    fails(await upload(ctx, client, "/doctor/certificates", { kind: "bmdc" }), 409, "APPLICATION_LOCKED");

    await ctx.prisma.doctor.update({
      where: { id: doctorId },
      data: { decidedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });
    const reopened = ok(await client.post("/doctor/application/reopen"));
    assert.equal(reopened.status, "in_progress");
    assert.equal(reopened.note, undefined);
    const doctor = await ctx.prisma.doctor.findUnique({ where: { id: doctorId } });
    assert.equal(doctor.verificationStatus, "pending");
    assert.equal(doctor.bmdcCheck, "unchecked");
  });

  it("only decides applications that are waiting", async () => {
    const { doctorId } = await register();
    fails(
      await admin.client.post(`/admin/doctors/${doctorId}/application/approve`),
      409,
      "INVALID_TRANSITION",
    );
    fails(
      await admin.client.post(`/admin/doctors/${doctorId}/application/request-changes`, {
        note: "Please add more detail.",
      }),
      409,
      "INVALID_TRANSITION",
    );
    fails(await check(doctorId, "matched"), 422, "BMDC_CERTIFICATE_REQUIRED");
  });

  it("does not let the old verification switch skip the application review", async () => {
    const { doctorId } = await submitted();
    fails(
      await admin.client.patch(`/admin/doctors/${doctorId}/verification`, { status: "verified" }),
      409,
      "APPLICATION_NOT_APPROVED",
    );
  });

  it("is for administrators only", async () => {
    const { client, doctorId } = await submitted();
    fails(await client.post(`/admin/doctors/${doctorId}/application/approve`), 403, "FORBIDDEN");
    fails(
      await client.patch(`/admin/doctors/${doctorId}/bmdc-check`, { result: "matched" }),
      403,
      "FORBIDDEN",
    );
    fails(await ctx.client().post(`/admin/doctors/${doctorId}/application/approve`), 401, "UNAUTHENTICATED");
  });
});

describe("invitations from the administration", () => {
  const invite = async () => {
    const email = `invited${++counter}@test.local`;
    const doctor = ok(
      await admin.client.post("/admin/doctors", {
        name: `Prof. Invited ${counter}`,
        email,
        specialtyId: "cardiology",
        qualifications: ["MBBS", "FRCP"],
        experienceYears: 25,
        fee: 3000,
        location: "Dhaka",
        facilityIds: [clinic.id],
      }),
      201,
    );
    return { email, doctor };
  };

  it("emails a 48-hour link that sets the password and continues the application", async () => {
    const { email, doctor } = await invite();
    assert.equal(doctor.application.status, "invited");
    const hours = (new Date(doctor.application.invitationExpiresAt) - Date.now()) / 3_600_000;
    assert.ok(hours > 47 && hours <= 48, `expected 48 hours, got ${hours}`);

    const mail = lastMail(email, /invited to join Carewell/);
    assert.match(mail.text, /#\/doctor\/invitation\?token=/);
    const token = tokenFrom(mail);

    const client = ctx.client();
    assert.equal(ok(await client.get(`/auth/doctor/invitation?token=${token}`)).email, email);
    fails(await client.post("/auth/doctor/invitation/accept", { token, password: "short" }), 422);
    const { user } = ok(
      await client.post("/auth/doctor/invitation/accept", { token, password: "My-new-pass-1!" }),
    );
    assert.equal(user.role, "doctor");
    assert.equal(user.emailVerified, true);
    assert.equal(user.onboardingStatus, "in_progress");

    // Same rules as everyone else: a BMDC certificate before submitting.
    fails(await client.post("/doctor/application/submit"), 422, "BMDC_CERTIFICATE_REQUIRED");
    ok(await upload(ctx, client, "/doctor/certificates", { kind: "bmdc" }), 201);
    assert.equal(ok(await client.post("/doctor/application/submit")).status, "submitted");

    // The link works once.
    fails(
      await ctx.client().post("/auth/doctor/invitation/accept", { token, password: "Another-pass-1!" }),
      410,
    );
    ok(await ctx.client().post("/auth/login", { email, password: "My-new-pass-1!", portal: "doctor" }));
  });

  it("refuses expired and replaced links", async () => {
    const { email, doctor } = await invite();
    const first = tokenFrom(lastMail(email, /invited/));
    const resent = ok(await admin.client.post(`/admin/doctors/${doctor.id}/invitation`));
    assert.ok(resent.application.invitationExpiresAt);
    const second = tokenFrom(lastMail(email, /invited/));
    assert.notEqual(first, second);
    fails(await ctx.client().get(`/auth/doctor/invitation?token=${first}`), 410, "INVITATION_INVALID");

    await ctx.prisma.doctorInvitation.updateMany({
      where: { doctorId: doctor.id, usedAt: null, revokedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    fails(
      await ctx
        .client()
        .post("/auth/doctor/invitation/accept", { token: second, password: "My-new-pass-1!" }),
      410,
      "INVITATION_INVALID",
    );
    fails(await ctx.client().get("/auth/doctor/invitation?token=nonsense"), 410, "INVITATION_INVALID");
  });

  it("lets the administration hand over the BMDC certificate and check it", async () => {
    const { doctor } = await invite();
    const updated = ok(
      await upload(ctx, admin.client, `/admin/doctors/${doctor.id}/certificates`, { kind: "bmdc" }),
      201,
    );
    assert.equal(updated.certificateFiles[0].kind, "bmdc");
    assert.equal(ok(await check(doctor.id, "matched")).application.bmdcCheck.result, "matched");
  });

  it("only resends to doctors who have not set up their account", async () => {
    const { doctorId } = await register();
    fails(await admin.client.post(`/admin/doctors/${doctorId}/invitation`), 409, "INVALID_TRANSITION");
  });
});
