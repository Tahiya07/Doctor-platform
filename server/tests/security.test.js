import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startTestApp } from "./helpers.js";
import { fails, makePeople, ok, PASSWORD } from "./people.js";

let ctx;
let people;
let clinic;
let counter = 0;

before(async () => {
  ctx = await startTestApp();
  people = makePeople(ctx);
  ({ clinic } = await people.createCatalog());
});
after(() => ctx.stop());
beforeEach(() => ctx.resetRateLimits());

const lastMail = (to) => [...ctx.outbox].reverse().find((mail) => mail.to === to);
const tokenFrom = (mail) => mail.text.match(/token=([\w-]+)/)[1];
const BENGALI = /[ঀ-৿]/;

/** Emails are sent after the response, so wait a moment for one to arrive. */
async function waitForMail(to, matcher = () => true) {
  for (let i = 0; i < 40; i += 1) {
    const found = [...ctx.outbox].reverse().find((mail) => mail.to === to && matcher(mail));
    if (found) return found;
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.fail(`no email arrived for ${to}`);
}

const newPatient = (extra = {}) => ({
  name: "Nadia Rahman",
  email: `security${++counter}@test.local`,
  phone: "+880 1711 000000",
  password: "Correct-horse-1!",
  ...extra,
});

describe("passwords must be strong", () => {
  it("explains what is missing from a weak password", async () => {
    const weak = {
      short: "Ab1!",
      "no capital": "lowercase-only-1!",
      "no lowercase": "UPPERCASE-ONLY-1!",
      "no number": "No-numbers-here!",
      "no symbol": "NoSymbols12345",
      obvious: "My-Password-12!",
    };
    for (const [why, password] of Object.entries(weak)) {
      const body = fails(
        await ctx.client().post("/auth/patient/register", newPatient({ password })),
        422,
        "VALIDATION_FAILED",
      );
      assert.equal(typeof body.details.password, "string", `${why} should be refused`);
    }
  });

  it("accepts a strong one, and applies the same rule when changing it", async () => {
    const client = ctx.client();
    ok(await client.post("/auth/patient/register", newPatient()), 201);
    fails(
      await client.post("/auth/change-password", {
        currentPassword: "Correct-horse-1!",
        newPassword: "weakpassword",
      }),
      422,
    );
    ok(
      await client.post("/auth/change-password", {
        currentPassword: "Correct-horse-1!",
        newPassword: "Another-strong-2@",
      }),
    );
  });

  it("does not stop older, simpler passwords from signing in", async () => {
    const email = `old${++counter}@test.local`;
    await ctx.prisma.user.create({
      data: { name: "Old Account", email, passwordHash: await ctx.hashPassword("simple"), role: "patient" },
    });
    ok(await ctx.client().post("/auth/login", { email, password: "simple", portal: "patient" }));
  });
});

describe("administrator sign-in lock", () => {
  const attempt = (client, email, password, portal = "admin") =>
    client.post("/auth/login", { email, password, portal });

  it("locks the account on the 4th wrong password, even for the right one afterwards", async () => {
    const admin = await people.createAdmin();
    ctx.outbox.length = 0;
    const client = ctx.client();
    for (let i = 0; i < 3; i += 1)
      fails(await attempt(client, admin.email, "wrong"), 401, "INVALID_CREDENTIALS");
    fails(await attempt(client, admin.email, "wrong"), 423, "ACCOUNT_LOCKED");
    fails(await attempt(client, admin.email, PASSWORD), 423, "ACCOUNT_LOCKED");

    const row = await ctx.prisma.user.findUnique({ where: { email: admin.email } });
    assert.ok(row.lockedUntil > new Date());
    const mail = await waitForMail(admin.email, (item) => /locked/i.test(item.subject));
    assert.match(mail.text, /4 wrong password/);
  });

  it("counts only wrong passwords in a row", async () => {
    const admin = await people.createAdmin();
    const client = ctx.client();
    for (let i = 0; i < 3; i += 1) fails(await attempt(client, admin.email, "wrong"), 401);
    ok(await attempt(client, admin.email, PASSWORD));
    const other = ctx.client();
    for (let i = 0; i < 3; i += 1) fails(await attempt(other, admin.email, "wrong"), 401);
    ok(await attempt(other, admin.email, PASSWORD));
  });

  it("is unlocked by resetting the password through the emailed link", async () => {
    const admin = await people.createAdmin();
    const client = ctx.client();
    for (let i = 0; i < 4; i += 1) await attempt(client, admin.email, "wrong");
    fails(await attempt(client, admin.email, PASSWORD), 423);

    ctx.outbox.length = 0;
    ok(await ctx.client().post("/auth/forgot-password", { email: admin.email }));
    const token = tokenFrom(await waitForMail(admin.email, (item) => /Reset/i.test(item.subject)));
    ok(await ctx.client().post("/auth/reset-password", { token, password: "Brand-new-pass-9!" }));
    ok(await attempt(ctx.client(), admin.email, "Brand-new-pass-9!"));
  });

  it("is also locked from the other sign-in pages, so the password cannot be guessed there", async () => {
    const admin = await people.createAdmin();
    const client = ctx.client();
    for (let i = 0; i < 3; i += 1) fails(await attempt(client, admin.email, "wrong", "patient"), 401);
    fails(await attempt(client, admin.email, "wrong", "patient"), 423, "ACCOUNT_LOCKED");
  });

  it("answers the same for emails that are not administrators", async () => {
    const patient = await people.createPatient();
    for (const email of [patient.email, "nobody@test.local"]) {
      const client = ctx.client();
      for (let i = 0; i < 3; i += 1) fails(await attempt(client, email, "wrong"), 401, "INVALID_CREDENTIALS");
      fails(await attempt(client, email, "wrong"), 423, "ACCOUNT_LOCKED");
    }
    // ...while the patient's own sign-in page is not affected by that
    ok(await attempt(ctx.client(), patient.email, PASSWORD, "patient"));
  });

  it("does not lock doctors or patients after 4 tries", async () => {
    const doctor = await people.createDoctor(clinic);
    const client = ctx.client();
    for (let i = 0; i < 6; i += 1) fails(await attempt(client, doctor.email, "wrong", "doctor"), 401);
    ok(await attempt(client, doctor.email, PASSWORD, "doctor"));
  });
});

describe("emails in the person's language", () => {
  it("writes the verification email in Bengali when the website is in Bengali", async () => {
    const details = newPatient();
    ok(await ctx.client().post("/auth/patient/register", details, { "X-Language": "bn" }), 201);
    const mail = await waitForMail(details.email);
    assert.match(mail.subject, BENGALI);
    assert.match(mail.text, /প্রিয় Nadia Rahman/);
    assert.match(mail.text, /\d{6}/); // the code itself stays in digits you can type
    assert.equal((await ctx.prisma.user.findUnique({ where: { email: details.email } })).language, "bn");
  });

  it("writes it in English otherwise", async () => {
    const details = newPatient();
    ok(await ctx.client().post("/auth/patient/register", details), 201);
    const mail = await waitForMail(details.email);
    assert.doesNotMatch(mail.text, BENGALI);
    assert.match(mail.subject, /verification code/);
  });

  it("remembers a language change made while signed in", async () => {
    const patient = await people.createPatient();
    ok(await patient.client.get("/auth/me", { "X-Language": "bn" }));
    for (let i = 0; i < 40; i += 1) {
      if ((await ctx.prisma.user.findUnique({ where: { id: patient.id } })).language === "bn") break;
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.equal((await ctx.prisma.user.findUnique({ where: { id: patient.id } })).language, "bn");
    ok(await patient.client.get("/auth/me", { "X-Language": "en" }));
    await new Promise((done) => setTimeout(done, 300));
    assert.equal((await ctx.prisma.user.findUnique({ where: { id: patient.id } })).language, "en");
  });

  it("sends the password reset email in the language of the request", async () => {
    const patient = await people.createPatient();
    ok(await ctx.client().post("/auth/forgot-password", { email: patient.email }, { "X-Language": "bn" }));
    const mail = await waitForMail(patient.email, (item) => /পাসওয়ার্ড/.test(item.subject));
    assert.match(mail.text, /৬০ মিনিট/); // 60 minutes, in Bengali digits
    assert.match(mail.text, /token=/);
  });

  it("sends an invited doctor both languages in one email", async () => {
    const admin = await people.createAdmin();
    const email = `invited${++counter}@test.local`;
    ok(
      await admin.client.post("/admin/doctors", {
        name: "Dr. Invited One",
        email,
        specialtyId: "cardiology",
        qualifications: ["MBBS"],
        experienceYears: 3,
        fee: 800,
        location: "Banani",
        facilityIds: [clinic.id],
      }),
      201,
    );
    const mail = await waitForMail(email);
    assert.match(mail.text, BENGALI);
    assert.match(mail.text, /administration has added you/);
  });

  it("emails about appointments, each person in their own language", async () => {
    const doctor = await people.createDoctor(clinic);
    const patient = await people.createPatient();
    await ctx.prisma.user.update({ where: { id: patient.id }, data: { language: "bn" } });

    const [slot] = ok(
      await doctor.client.post("/doctor/availability", {
        facilityId: clinic.id,
        date: people.day(2),
        startTime: "15:00",
        endTime: "15:10",
      }),
      201,
    );
    ctx.outbox.length = 0;
    const booked = ok(
      await patient.client.post("/appointment-requests", {
        doctorId: doctor.id,
        facilityId: clinic.id,
        date: slot.date,
        slotId: slot.id,
        relationship: "self",
        patientName: patient.name,
        phone: "+880 1711 000000",
        email: patient.email,
        reason: "A private health reason",
      }),
      201,
    );

    const toPatient = await waitForMail(patient.email, (mail) => /আমরা আপনার/.test(mail.subject));
    assert.match(toPatient.text, /বিকাল ৩:০০/); // 3:00 PM, as people say it
    const toDoctor = await waitForMail(doctor.email, (mail) => /New appointment request/.test(mail.subject));
    assert.doesNotMatch(toDoctor.text, /private health reason/); // the reason stays out of email

    ok(await doctor.client.patch(`/doctor/appointments/${booked.id}`, { status: "accepted" }));
    const accepted = await waitForMail(patient.email, (mail) => /গ্রহণ করা হয়েছে/.test(mail.subject));
    assert.match(accepted.text, /ডাক্তারকে বার্তা পাঠাতে পারেন/);

    ok(await patient.client.patch(`/appointment-requests/${booked.id}`, { status: "cancelled" }));
    const cancelled = await waitForMail(doctor.email, (mail) => /cancelled/.test(mail.subject));
    assert.match(cancelled.text, new RegExp(patient.name));
    assert.ok(lastMail(patient.email));
  });
});
