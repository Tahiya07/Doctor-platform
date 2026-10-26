import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startTestApp } from "./helpers.js";

let ctx;
let counter = 0;

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

const account = (extra = {}) => ({
  name: "Nadia Rahman",
  email: `patient${++counter}@test.local`,
  phone: "+880 1711 000000",
  password: "Correct-horse-1!",
  ...extra,
});
const lastMail = (to) => [...ctx.outbox].reverse().find((mail) => mail.to === to);
const codeFrom = (mail) => mail.text.match(/\b(\d{6})\b/)[1];
const tokenFrom = (mail) => mail.text.match(/token=([\w-]+)/)[1];

/** Signs a new patient up and returns the signed-in client plus their details. */
async function signUp(extra) {
  const details = account(extra);
  const client = ctx.client();
  const { user } = ok(await client.post("/auth/patient/register", details), 201);
  return { client, details, user };
}

before(async () => {
  ctx = await startTestApp();
});
after(() => ctx.stop());
beforeEach(() => ctx.resetRateLimits()); // every request here comes from 127.0.0.1

describe("patient sign-up", () => {
  it("limits how many accounts one connection can create per hour", async () => {
    for (let index = 0; index < 10; index += 1)
      ok(await ctx.client().post("/auth/patient/register", account()), 201);
    fails(await ctx.client().post("/auth/patient/register", account()), 429, "RATE_LIMITED");
  });

  it("creates the account, signs the patient in and emails a verification code", async () => {
    const { client, details, user } = await signUp();
    assert.equal(user.role, "patient");
    assert.equal(user.emailVerified, false);
    assert.equal(user.email, details.email);
    assert.equal(ok(await client.get("/auth/me")).user.id, user.id);
    const mail = lastMail(details.email);
    assert.match(mail.subject, /verification code/);
    assert.match(codeFrom(mail), /^\d{6}$/);
    assert.equal(JSON.stringify(user).includes("password"), false);
  });

  it("stores only hashes: never the password or the code", async () => {
    const { details, user } = await signUp();
    const row = await ctx.prisma.user.findUnique({ where: { id: user.id } });
    assert.notEqual(row.passwordHash, details.password);
    const verification = await ctx.prisma.emailVerification.findFirst({ where: { userId: user.id } });
    assert.notEqual(verification.codeHash, codeFrom(lastMail(details.email)));
  });

  it("lets the new patient sign in again with their password", async () => {
    const { details } = await signUp();
    const again = ctx.client();
    ok(
      await again.post("/auth/login", {
        email: details.email.toUpperCase(),
        password: details.password,
        portal: "patient",
      }),
    );
  });

  it("refuses a second account with the same email", async () => {
    const { details } = await signUp();
    fails(
      await ctx.client().post("/auth/patient/register", account({ email: details.email.toUpperCase() })),
      409,
      "EMAIL_TAKEN",
    );
  });

  it("validates every field and reports each problem", async () => {
    const body = fails(
      await ctx
        .client()
        .post("/auth/patient/register", { name: "N", email: "nope", phone: "12", password: "short" }),
      422,
      "VALIDATION_FAILED",
    );
    assert.deepEqual(Object.keys(body.details).sort(), ["email", "name", "password", "phone"]);
  });

  it("never lets a client choose its own role", async () => {
    const { user } = await signUp({ role: "admin" });
    assert.equal(user.role, "patient");
  });
});

describe("email verification", () => {
  it("accepts the emailed code once and marks the account verified", async () => {
    const { client, details } = await signUp();
    const code = codeFrom(lastMail(details.email));
    const { user } = ok(await client.post("/auth/verify-email", { code }));
    assert.equal(user.emailVerified, true);
    assert.equal(ok(await client.get("/auth/me")).user.emailVerified, true);
    // The same code cannot be used again after the account is verified, but asking is harmless.
    ok(await client.post("/auth/verify-email", { code }));
  });

  it("rejects a wrong code, then locks the code after too many guesses", async () => {
    const { client, details } = await signUp();
    const real = codeFrom(lastMail(details.email));
    const wrong = real === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 5; attempt += 1)
      fails(await client.post("/auth/verify-email", { code: wrong }), 422, "INVALID_CODE");
    fails(await client.post("/auth/verify-email", { code: real }), 429, "TOO_MANY_ATTEMPTS");
    // A fresh code unlocks it.
    ctx.outbox.length = 0;
    await ctx.prisma.emailVerification.updateMany({ data: { createdAt: new Date(Date.now() - 60_000) } });
    ok(await client.post("/auth/verify-email/resend"));
    ok(await client.post("/auth/verify-email", { code: codeFrom(lastMail(details.email)) }));
  });

  it("expires codes", async () => {
    const { client, details } = await signUp();
    await ctx.prisma.emailVerification.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    fails(
      await client.post("/auth/verify-email", { code: codeFrom(lastMail(details.email)) }),
      410,
      "CODE_EXPIRED",
    );
  });

  it("replaces the old code when a new one is requested, but not within 30 seconds", async () => {
    const { client, details } = await signUp();
    const first = codeFrom(lastMail(details.email));
    fails(await client.post("/auth/verify-email/resend"), 429, "RATE_LIMITED");

    await ctx.prisma.emailVerification.updateMany({ data: { createdAt: new Date(Date.now() - 60_000) } });
    ctx.outbox.length = 0;
    ok(await client.post("/auth/verify-email/resend"));
    const second = codeFrom(lastMail(details.email));
    if (second !== first)
      fails(await client.post("/auth/verify-email", { code: first }), 422, "INVALID_CODE");
    ok(await client.post("/auth/verify-email", { code: second }));
  });

  it("needs a signed-in patient and a well-formed code", async () => {
    fails(await ctx.client().post("/auth/verify-email", { code: "123456" }), 401, "UNAUTHENTICATED");
    const { client } = await signUp();
    fails(await client.post("/auth/verify-email", { code: "12ab" }), 422, "VALIDATION_FAILED");
  });
});

describe("forgot and reset password", () => {
  it("emails a one-time link and the new password works", async () => {
    const { details } = await signUp();
    ctx.outbox.length = 0;
    assert.deepEqual(ok(await ctx.client().post("/auth/forgot-password", { email: details.email })), {
      sent: true,
    });
    const mail = lastMail(details.email);
    assert.match(mail.text, /#\/reset-password\?token=/);

    const token = tokenFrom(mail);
    assert.deepEqual(
      ok(await ctx.client().post("/auth/reset-password", { token, password: "Brand-new-pass-9!" })),
      { reset: true },
    );

    fails(
      await ctx.client().post("/auth/login", { email: details.email, password: details.password }),
      401,
      "INVALID_CREDENTIALS",
    );
    ok(await ctx.client().post("/auth/login", { email: details.email, password: "Brand-new-pass-9!" }));
  });

  it("answers the same for an unknown email and sends nothing", async () => {
    ctx.outbox.length = 0;
    const known = await signUp();
    ctx.outbox.length = 0;
    const a = ok(await ctx.client().post("/auth/forgot-password", { email: known.details.email }));
    const b = ok(await ctx.client().post("/auth/forgot-password", { email: "ghost@test.local" }));
    assert.deepEqual(a, b);
    assert.equal(ctx.outbox.filter((mail) => mail.to === "ghost@test.local").length, 0);
  });

  it("works only once, and a newer link replaces an older one", async () => {
    const { details } = await signUp();
    ctx.outbox.length = 0;
    ok(await ctx.client().post("/auth/forgot-password", { email: details.email }));
    const older = tokenFrom(lastMail(details.email));
    ok(await ctx.client().post("/auth/forgot-password", { email: details.email }));
    const newer = tokenFrom(lastMail(details.email));

    fails(
      await ctx.client().post("/auth/reset-password", { token: older, password: "Another-pass-77!" }),
      410,
      "RESET_TOKEN_INVALID",
    );
    ok(await ctx.client().post("/auth/reset-password", { token: newer, password: "Another-pass-77!" }));
    fails(
      await ctx.client().post("/auth/reset-password", { token: newer, password: "Another-pass-88!" }),
      410,
      "RESET_TOKEN_INVALID",
    );
  });

  it("refuses expired and made-up links, and weak passwords", async () => {
    const { details } = await signUp();
    ctx.outbox.length = 0;
    ok(await ctx.client().post("/auth/forgot-password", { email: details.email }));
    const token = tokenFrom(lastMail(details.email));

    fails(
      await ctx.client().post("/auth/reset-password", { token: "made-up", password: "Another-pass-77!" }),
      410,
      "RESET_TOKEN_INVALID",
    );
    fails(
      await ctx.client().post("/auth/reset-password", { token, password: "short" }),
      422,
      "VALIDATION_FAILED",
    );

    await ctx.prisma.passwordReset.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    fails(
      await ctx.client().post("/auth/reset-password", { token, password: "Another-pass-77!" }),
      410,
      "RESET_TOKEN_INVALID",
    );
  });

  it("signs the account out everywhere and counts the email as verified", async () => {
    const { client, details } = await signUp();
    ok(await client.get("/auth/me"));
    ctx.outbox.length = 0;
    ok(await ctx.client().post("/auth/forgot-password", { email: details.email }));
    const login = ctx.client();
    ok(
      await login.post("/auth/reset-password", {
        token: tokenFrom(lastMail(details.email)),
        password: "Another-pass-77!",
      }),
    );

    fails(await client.get("/auth/me"), 401, "UNAUTHENTICATED");
    const { user } = ok(
      await ctx.client().post("/auth/login", { email: details.email, password: "Another-pass-77!" }),
    );
    assert.equal(user.emailVerified, true);
  });

  it("does not email suspended accounts", async () => {
    const { details, user } = await signUp();
    await ctx.prisma.user.update({ where: { id: user.id }, data: { accountStatus: "suspended" } });
    ctx.outbox.length = 0;
    ok(await ctx.client().post("/auth/forgot-password", { email: details.email }));
    assert.equal(ctx.outbox.length, 0);
  });

  it("lets an administrator-created doctor set a first password", async () => {
    const email = "invited.doctor@test.local";
    await ctx.prisma.user.create({
      data: {
        name: "Dr Invited",
        email,
        passwordHash: await ctx.hashPassword("unusable-random-1"),
        role: "doctor",
      },
    });
    ctx.outbox.length = 0;
    ok(await ctx.client().post("/auth/forgot-password", { email }));
    ok(
      await ctx
        .client()
        .post("/auth/reset-password", {
          token: tokenFrom(lastMail(email)),
          password: "Doctor-first-pass-1!",
        }),
    );
    ok(await ctx.client().post("/auth/login", { email, password: "Doctor-first-pass-1!", portal: "doctor" }));
  });
});

describe("profile and password change", () => {
  it("updates the signed-in user's name and phone", async () => {
    const { client } = await signUp();
    const { user } = ok(await client.patch("/auth/me", { name: "Nadia R. Khan", phone: "01911 222333" }));
    assert.equal(user.name, "Nadia R. Khan");
    assert.equal(user.phone, "01911 222333");
    assert.equal(ok(await client.get("/auth/me")).user.name, "Nadia R. Khan");
    fails(await client.patch("/auth/me", { name: "X", phone: "1" }), 422, "VALIDATION_FAILED");
    fails(
      await ctx.client().patch("/auth/me", { name: "Nadia", phone: "01911 222333" }),
      401,
      "UNAUTHENTICATED",
    );
  });

  it("cannot change the email or role through the profile", async () => {
    const { client, details } = await signUp();
    const { user } = ok(
      await client.patch("/auth/me", {
        name: "Nadia R.",
        phone: "01911 222333",
        email: "x@test.local",
        role: "admin",
      }),
    );
    assert.equal(user.email, details.email);
    assert.equal(user.role, "patient");
  });

  it("changes the password after checking the current one, keeping this device signed in", async () => {
    const { client, details } = await signUp();
    const otherDevice = ctx.client();
    ok(await otherDevice.post("/auth/login", { email: details.email, password: details.password }));

    fails(
      await client.post("/auth/change-password", {
        currentPassword: "wrong-one-123",
        newPassword: "Fresh-pass-4567!",
      }),
      422,
      "VALIDATION_FAILED",
    );
    fails(
      await client.post("/auth/change-password", {
        currentPassword: details.password,
        newPassword: details.password,
      }),
      422,
      "VALIDATION_FAILED",
    );
    ok(
      await client.post("/auth/change-password", {
        currentPassword: details.password,
        newPassword: "Fresh-pass-4567!",
      }),
    );

    ok(await client.get("/auth/me")); // this device stays signed in
    fails(await otherDevice.get("/auth/me"), 401, "UNAUTHENTICATED"); // the other one does not
    ok(await ctx.client().post("/auth/login", { email: details.email, password: "Fresh-pass-4567!" }));
    fails(
      await ctx.client().post("/auth/login", { email: details.email, password: details.password }),
      401,
      "INVALID_CREDENTIALS",
    );
  });
});
