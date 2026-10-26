import { describe, expect, it } from "vitest";
import { DEMO_VERIFICATION_CODE } from "../constants.js";
import {
  adminService,
  appointmentService,
  authService,
  availabilityService,
  doctorPortalService,
  doctorService,
  facilityService,
  messagingService,
  notificationService,
  db,
  slotService,
} from "./demoBackend.js";
import { localDateKey } from "../utils/dates.js";

const daysFromNow = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateKey(date);
};

const booking = (overrides = {}) => ({
  doctorId: "d1",
  facilityId: "f1",
  date: daysFromNow(2),
  time: "5:30 PM",
  patientName: "Rina Das",
  phone: "+8801712345678",
  email: "rina@example.test",
  reason: "Follow-up visit",
  ...overrides,
});

const credentials = (portal, email = `${portal}@example.test`) => ({ email, password: "x", portal });
const signInAdmin = () => authService.login(credentials("admin"));
const signInDoctor = () => authService.login(credentials("doctor"));
const signInPatient = () => authService.login(credentials("patient"));

const newAccount = (overrides = {}) => ({
  name: "Nila Akter",
  email: "nila@example.test",
  phone: "+8801811111111",
  password: "Correct-horse-1!",
  ...overrides,
});

describe("public discovery", () => {
  it("lists only published doctors without any sign-in", async () => {
    const doctors = await doctorService.list();
    expect(doctors.map((d) => d.id)).not.toContain("d6"); // pending, unpublished
    expect(doctors).toHaveLength(5);
  });

  it("combines filters", async () => {
    const result = await doctorService.list({ specialty: "dermatology", maxFee: 1300, verified: true });
    expect(result.map((d) => d.id)).toEqual(["d2"]);
    expect(await doctorService.list({ specialty: "dermatology", maxFee: 100 })).toEqual([]);
  });

  it("hides inactive clinics and answers 404 for unlisted doctors", async () => {
    await signInAdmin();
    await adminService.deactivateFacility("f3");
    expect((await facilityService.list()).map((f) => f.id)).not.toContain("f3");
    await expect(doctorService.get("d6")).rejects.toMatchObject({ status: 404 });
  });
});

describe("patient accounts", () => {
  it("registers an unverified patient and signs them in", async () => {
    const { user } = await authService.registerPatient(newAccount());
    expect(user).toMatchObject({ role: "patient", name: "Nila Akter", emailVerified: false });
    expect(await authService.getCurrentUser()).toMatchObject({ email: "nila@example.test" });
  });

  it("validates sign-up details and rejects duplicate emails", async () => {
    await expect(authService.registerPatient(newAccount({ email: "nope" }))).rejects.toMatchObject({
      status: 422,
      details: { email: expect.any(String) },
    });
    await authService.registerPatient(newAccount());
    await authService.logout();
    await expect(authService.registerPatient(newAccount())).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
  });

  it("verifies the email with the right code only", async () => {
    await authService.registerPatient(newAccount());
    await expect(authService.verifyEmail("000000")).rejects.toMatchObject({ status: 422 });
    const { user } = await authService.verifyEmail(DEMO_VERIFICATION_CODE);
    expect(user.emailVerified).toBe(true);
    expect((await authService.getCurrentUser()).emailVerified).toBe(true);
  });

  it("remembers a registered patient across sign-ins", async () => {
    await authService.registerPatient(newAccount());
    await authService.verifyEmail(DEMO_VERIFICATION_CODE);
    await authService.logout();
    const { user } = await authService.login(credentials("patient", "NILA@example.test"));
    expect(user).toMatchObject({ name: "Nila Akter", emailVerified: true });
  });

  it("updates name and phone", async () => {
    await signInPatient();
    const { user } = await authService.updateProfile({ name: "Demo Person", phone: "+8801722222222" });
    expect(user).toMatchObject({ name: "Demo Person", phone: "+8801722222222" });
    await expect(authService.updateProfile({ name: "", phone: "1" })).rejects.toMatchObject({ status: 422 });
  });

  it("changes the password only with the current one and a long enough new one", async () => {
    await signInPatient();
    await expect(
      authService.changePassword({ currentPassword: "", newPassword: "Long-enough-1!" }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      authService.changePassword({ currentPassword: "old-pass-123", newPassword: "short" }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      authService.changePassword({ currentPassword: "old-pass-123", newPassword: "Long-enough-1!" }),
    ).resolves.toMatchObject({ changed: true });
  });
});

describe("appointment requests", () => {
  it("requires a signed-in patient with a verified email", async () => {
    await expect(appointmentService.submit(booking())).rejects.toMatchObject({ status: 401 });
    await expect(appointmentService.list()).rejects.toMatchObject({ status: 401 });

    await authService.registerPatient(newAccount());
    await expect(appointmentService.submit(booking())).rejects.toMatchObject({
      status: 403,
      code: "EMAIL_NOT_VERIFIED",
    });
    await authService.verifyEmail(DEMO_VERIFICATION_CODE);
    await expect(appointmentService.submit(booking())).resolves.toMatchObject({ status: "pending" });
  });

  it("does not let doctors or admins book", async () => {
    await signInDoctor();
    await expect(appointmentService.submit(booking())).rejects.toMatchObject({ status: 403 });
    await authService.logout();
    await signInAdmin();
    await expect(appointmentService.submit(booking())).rejects.toMatchObject({ status: 403 });
  });

  it("creates pending requests with embedded doctor and clinic summaries", async () => {
    await signInPatient();
    const created = await appointmentService.submit(booking());
    expect(created.status).toBe("pending");
    expect(created.relationship).toBe("self");
    expect(created.doctor.name).toBe("Dr. Arif Rahman");
    expect(created.facility.id).toBe("f1");
  });

  it("rejects invalid input and clinics the doctor does not use", async () => {
    await signInPatient();
    await expect(appointmentService.submit(booking({ date: daysFromNow(-1) }))).rejects.toMatchObject({
      status: 422,
    });
    await expect(appointmentService.submit(booking({ email: "nope" }))).rejects.toMatchObject({
      status: 422,
    });
    await expect(appointmentService.submit(booking({ facilityId: "f3" }))).rejects.toMatchObject({
      status: 422,
    });
    await expect(appointmentService.submit(booking({ relationship: "stranger" }))).rejects.toMatchObject({
      status: 422,
    });
  });

  it("records bookings made for a family member", async () => {
    await signInPatient();
    const created = await appointmentService.submit(
      booking({ patientName: "Tuli Das", relationship: "child" }),
    );
    expect(created).toMatchObject({
      patientName: "Tuli Das",
      relationship: "child",
      email: "rina@example.test",
    });
    expect((await appointmentService.list()).find((item) => item.id === created.id)).toBeTruthy();
  });

  it("shows each patient only their own requests", async () => {
    await signInPatient();
    expect((await appointmentService.list()).length).toBeGreaterThanOrEqual(4);
    await authService.logout();

    await authService.registerPatient(newAccount());
    await authService.verifyEmail(DEMO_VERIFICATION_CODE);
    expect(await appointmentService.list()).toEqual([]);
    await expect(appointmentService.cancel("a2")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a time that already has an accepted request", async () => {
    await signInPatient();
    const first = await appointmentService.submit(booking());
    await signInDoctor();
    await doctorPortalService.updateAppointmentStatus(first.id, "accepted");
    await signInPatient();
    await expect(appointmentService.submit(booking())).rejects.toMatchObject({
      status: 409,
      code: "APPOINTMENT_CONFLICT",
    });
    const slots = await slotService.listOpen({ doctorId: "d1", facilityId: "f1", date: booking().date });
    expect(slots.find((s) => s.label === "5:30 PM").status).toBe("booked");
  });

  it("lets patients cancel only pending or accepted requests", async () => {
    await signInPatient();
    const created = await appointmentService.submit(booking());
    expect((await appointmentService.cancel(created.id)).status).toBe("cancelled");
    await expect(appointmentService.cancel(created.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(appointmentService.cancel("a3")).rejects.toMatchObject({ status: 409 }); // completed
  });
});

describe("authorisation", () => {
  it("rejects protected calls without a session (401) or with the wrong role (403)", async () => {
    await expect(adminService.listDoctors()).rejects.toMatchObject({ status: 401 });
    await signInDoctor();
    await expect(adminService.listDoctors()).rejects.toMatchObject({ status: 403 });
    await authService.logout();
    await expect(doctorPortalService.getProfile()).rejects.toMatchObject({ status: 401 });
    await signInPatient();
    await expect(doctorPortalService.getProfile()).rejects.toMatchObject({ status: 403 });
  });

  it("restores the session and clears it on logout", async () => {
    expect(await authService.getCurrentUser()).toBeNull();
    await signInDoctor();
    expect((await authService.getCurrentUser()).role).toBe("doctor");
    await authService.logout();
    expect(await authService.getCurrentUser()).toBeNull();
  });

  it("scopes doctors to their own requests", async () => {
    await signInDoctor();
    const mine = await doctorPortalService.listAppointments();
    expect(mine.every((item) => item.doctorId === "d1")).toBe(true);
    await expect(doctorPortalService.updateAppointmentStatus("a2", "accepted")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("allows doctors to decide only pending requests", async () => {
    await signInDoctor();
    const updated = await doctorPortalService.updateAppointmentStatus("DEMO-REQ-1", "rejected");
    expect(updated.status).toBe("rejected");
    await expect(doctorPortalService.updateAppointmentStatus("DEMO-REQ-1", "accepted")).rejects.toMatchObject(
      {
        status: 409,
      },
    );
  });
});

describe("admin rules", () => {
  it("publishes only verified profiles and unpublishes on suspension", async () => {
    await signInAdmin();
    await expect(adminService.setPublication("d6", "published")).rejects.toMatchObject({
      code: "NOT_VERIFIED",
    });
    // d6 is an open application: it is verified only through the review, after a BMDC check.
    await expect(adminService.setVerification("d6", "verified")).rejects.toMatchObject({
      code: "APPLICATION_NOT_APPROVED",
    });
    await adminService.recordBmdcCheck("d6", { result: "matched" });
    await adminService.approveApplication("d6");
    expect((await adminService.setPublication("d6", "published")).publicationStatus).toBe("published");
    expect((await doctorService.list()).map((d) => d.id)).toContain("d6");

    const suspended = await adminService.setVerification("d6", "suspended");
    expect(suspended.publicationStatus).toBe("unpublished");
    expect((await doctorService.list()).map((d) => d.id)).not.toContain("d6");
  });

  it("deactivating a doctor hides the profile", async () => {
    await signInAdmin();
    await adminService.deactivateDoctor("d1");
    await expect(doctorService.get("d1")).rejects.toMatchObject({ status: 404 });
    await authService.logout();
    await expect(signInDoctor()).rejects.toMatchObject({ code: "ACCOUNT_RESTRICTED" });
  });

  it("enforces appointment transitions", async () => {
    await signInAdmin();
    expect((await adminService.updateAppointmentStatus("DEMO-REQ-1", "accepted")).status).toBe("accepted");
    expect((await adminService.updateAppointmentStatus("DEMO-REQ-1", "completed")).status).toBe("completed");
    await expect(adminService.updateAppointmentStatus("DEMO-REQ-1", "pending")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("requires a specialty, clinic and valid fee when adding a doctor", async () => {
    await signInAdmin();
    const base = {
      name: "Dr. Test Person",
      specialtyId: "cardiology",
      qualifications: ["MBBS"],
      experienceYears: 3,
      fee: 900,
      location: "Gulshan",
      facilityIds: ["f2"],
    };
    await expect(adminService.addDoctor({ ...base, facilityIds: [] })).rejects.toMatchObject({ status: 422 });
    await expect(adminService.addDoctor({ ...base, fee: -1 })).rejects.toMatchObject({ status: 422 });
    const created = await adminService.addDoctor(base);
    expect(created).toMatchObject({ verificationStatus: "pending", publicationStatus: "unpublished" });
  });

  it("summarises live counts", async () => {
    await signInAdmin();
    const summary = await adminService.getSummary();
    expect(summary).toMatchObject({ pendingDoctors: 1, verifiedDoctors: 5, activeFacilities: 3 });
    expect(summary.monthlyAppointments).toHaveLength(12);
  });
});

describe("availability", () => {
  const slot = (overrides = {}) => ({
    facilityId: "f1",
    date: daysFromNow(3),
    startTime: "10:00",
    endTime: "10:30",
    ...overrides,
  });

  it("validates ranges, dates, clinics and overlaps", async () => {
    await signInDoctor();
    await expect(availabilityService.save("d1", slot({ endTime: "09:00" }))).rejects.toMatchObject({
      status: 422,
    });
    await expect(availabilityService.save("d1", slot({ date: daysFromNow(-1) }))).rejects.toMatchObject({
      status: 422,
    });
    await expect(availabilityService.save("d1", slot({ facilityId: "f3" }))).rejects.toMatchObject({
      status: 422,
    });

    const saved = await availabilityService.save("d1", slot());
    await expect(
      availabilityService.save("d1", slot({ startTime: "10:10", endTime: "10:40" })),
    ).rejects.toMatchObject({ code: "SLOT_OVERLAP" });
    // Blocked slots free the time.
    for (const item of saved) await availabilityService.update(item.id, { status: "unavailable" });
    await expect(
      availabilityService.save("d1", slot({ startTime: "10:10", endTime: "10:40" })),
    ).resolves.toBeTruthy();
  });

  it("cuts a window into back-to-back 10-minute slots", async () => {
    await signInDoctor();
    const saved = await availabilityService.save("d1", slot({ startTime: "16:00", endTime: "16:30" }));
    expect(saved.map((item) => `${item.startTime}-${item.endTime}`)).toEqual([
      "16:00-16:10",
      "16:10-16:20",
      "16:20-16:30",
    ]);
    await expect(
      availabilityService.save("d1", slot({ startTime: "17:00", endTime: "17:25" })),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("shows patients each 10-minute time, and an accepted one as booked", async () => {
    await signInDoctor();
    await availabilityService.save("d1", slot({ startTime: "16:00", endTime: "16:30" }));
    db.appointments.push({
      id: "taken",
      doctorId: "d1",
      facilityId: "f1",
      date: daysFromNow(3),
      time: "4:10 PM",
      status: "accepted",
    });
    const open = await slotService.listOpen({ doctorId: "d1", facilityId: "f1", date: daysFromNow(3) });
    expect(open.map((item) => [item.label, item.status])).toEqual([
      ["4:00 PM", "available"],
      ["4:10 PM", "booked"],
      ["4:20 PM", "available"],
    ]);
  });

  it("keeps doctors out of each other's schedules but lets admins manage any", async () => {
    await signInDoctor();
    const [mine] = await availabilityService.save("d1", slot());
    await authService.logout();
    await signInAdmin();
    expect((await availabilityService.list("d1", { admin: true })).map((s) => s.id)).toContain(mine.id);
    await availabilityService.remove(mine.id, { admin: true });
    expect((await availabilityService.list("d1", { admin: true })).map((s) => s.id)).not.toContain(mine.id);
  });
});

describe("notifications", () => {
  const titles = async () => (await notificationService.list()).items.map((item) => item.title);

  it("requires sign-in and is private to each role", async () => {
    await expect(notificationService.list()).rejects.toMatchObject({ status: 401 });
    await signInPatient();
    const mine = await notificationService.list();
    expect(mine.unreadCount).toBe(1);
    expect(mine.items[0]).toMatchObject({ title: "Welcome to Carewell", read: false });
    await expect(notificationService.markRead("demo-note-1")).rejects.toMatchObject({ status: 404 }); // the doctor's
  });

  it("marks one, then every notification as read", async () => {
    await signInPatient();
    await appointmentService.submit(booking());
    expect((await notificationService.list()).unreadCount).toBe(2);
    const [first] = (await notificationService.list()).items;
    await notificationService.markRead(first.id);
    expect((await notificationService.list()).unreadCount).toBe(1);
    await expect(notificationService.markAllRead()).resolves.toMatchObject({ updated: 1 });
    expect((await notificationService.list()).unreadCount).toBe(0);
  });

  it("tells the doctor about a new request and the patient about the answer", async () => {
    await signInPatient();
    await appointmentService.submit(booking());
    const [request] = await appointmentService.list();
    await authService.logout();

    await signInDoctor();
    expect(await titles()).toContain("New appointment request");
    expect((await notificationService.list()).unreadCount).toBe(2);
    await doctorPortalService.updateAppointmentStatus(request.id, "accepted");
    await authService.logout();

    await signInPatient();
    const patientTitles = await titles();
    expect(patientTitles).toContain("Appointment accepted");
    expect(patientTitles).toContain("Appointment request sent");
  });

  it("tells the other side about a message", async () => {
    await signInPatient();
    await messagingService.sendMessage("c1", "Hello doctor");
    await authService.logout();
    await signInDoctor();
    const [latest] = (await notificationService.list()).items;
    expect(latest).toMatchObject({ kind: "message", link: "/messages" });
    expect(latest.body).toBe("Hello doctor");
  });
});

describe("messaging", () => {
  it("requires sign-in", async () => {
    await expect(messagingService.listConversations()).rejects.toMatchObject({ status: 401 });
  });

  it("opens patient threads only after an accepted request", async () => {
    await signInPatient();
    const threads = await messagingService.listConversations();
    expect(threads.find((t) => t.id === "c1").canMessage).toBe(true); // d1 has an accepted request
    expect(threads.find((t) => t.id === "c3").canMessage).toBe(false); // d3 only has a completed one
    await expect(messagingService.sendMessage("c3", "hello")).rejects.toMatchObject({ status: 403 });
    await expect(messagingService.listMessages("c3")).rejects.toMatchObject({ status: 403 });
    const sent = await messagingService.sendMessage("c1", "  Thank you  ");
    expect(sent).toMatchObject({ body: "Thank you", isMine: true });
  });

  it("validates message length and refuses uploads in demo mode", async () => {
    await signInPatient();
    await expect(messagingService.sendMessage("c1", "   ")).rejects.toMatchObject({ status: 422 });
    await expect(messagingService.sendMessage("c1", "x".repeat(2001))).rejects.toMatchObject({ status: 422 });
    await expect(messagingService.sendAttachment("c1", new Blob(["x"]))).rejects.toMatchObject({
      status: 501,
    });
  });

  it("keeps one patient's threads away from another", async () => {
    await authService.registerPatient(newAccount());
    await authService.verifyEmail(DEMO_VERIFICATION_CODE);
    expect(await messagingService.listConversations()).toEqual([]);
    await expect(messagingService.listMessages("c1")).rejects.toMatchObject({ status: 404 });
  });

  it("opens a thread for a new patient once a doctor accepts their request", async () => {
    await authService.registerPatient(newAccount());
    await authService.verifyEmail(DEMO_VERIFICATION_CODE);
    const request = await appointmentService.submit(booking());
    await signInDoctor();
    await doctorPortalService.updateAppointmentStatus(request.id, "accepted");
    await authService.login(credentials("patient", "nila@example.test"));
    const threads = await messagingService.listConversations();
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ participantName: "Dr. Arif Rahman", canMessage: true });
  });

  it("gives doctors a thread with administration", async () => {
    await signInDoctor();
    const threads = await messagingService.listConversations();
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ id: "c-admin", canMessage: true });
  });
});

describe("doctor applications", () => {
  const bmdcFile = () => new File(["%PDF-1.4"], "bmdc.pdf", { type: "application/pdf" });
  const register = () =>
    authService.registerDoctor({
      name: "Dr. New Applicant",
      email: "applicant@example.test",
      phone: "+8801711000000",
      password: "Doctor-pass-123!",
      specialtyId: "cardiology",
      qualifications: ["MBBS"],
      experienceYears: 4,
      fee: 900,
      location: "Dhaka",
      facilityIds: ["f1"],
    });

  it("goes in order: confirm email, BMDC certificate, submit", async () => {
    const { user } = await register();
    expect(user).toMatchObject({ onboardingStatus: "in_progress", emailVerified: false });
    await expect(doctorPortalService.listAppointments()).rejects.toMatchObject({
      code: "APPLICATION_NOT_APPROVED",
    });
    await expect(doctorPortalService.submitApplication()).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });

    await authService.verifyEmail(DEMO_VERIFICATION_CODE);
    await expect(doctorPortalService.submitApplication()).rejects.toMatchObject({
      code: "BMDC_CERTIFICATE_REQUIRED",
    });
    await doctorPortalService.uploadCertificate(bmdcFile(), "bmdc");
    expect((await doctorPortalService.getApplication()).canSubmit).toBe(true);

    const submitted = await doctorPortalService.submitApplication();
    expect(submitted.status).toBe("submitted");
    await expect(doctorPortalService.uploadCertificate(bmdcFile(), "degree")).rejects.toMatchObject({
      code: "APPLICATION_LOCKED",
    });
  });

  it("approves only after a matched BMDC check, and sends back or rejects with a note", async () => {
    const { doctor } = await register();
    await authService.verifyEmail(DEMO_VERIFICATION_CODE);
    await doctorPortalService.uploadCertificate(bmdcFile(), "bmdc");
    await doctorPortalService.submitApplication();
    await authService.logout();

    await signInAdmin();
    await expect(adminService.approveApplication(doctor.id)).rejects.toMatchObject({
      code: "BMDC_NOT_MATCHED",
    });
    await expect(adminService.recordBmdcCheck(doctor.id, { result: "mismatch" })).rejects.toMatchObject({
      status: 422,
    });
    await expect(adminService.requestApplicationChanges(doctor.id, "")).rejects.toMatchObject({
      status: 422,
    });
    const sentBack = await adminService.requestApplicationChanges(doctor.id, "Upload a clearer scan.");
    expect(sentBack.application).toMatchObject({
      status: "changes_requested",
      note: "Upload a clearer scan.",
    });

    const rejected = await adminService.rejectApplication(doctor.id, "Not on the BMDC register.");
    expect(rejected.application.status).toBe("rejected");
    expect(rejected.application.reapplyAt).toBeTruthy();
    await authService.logout();

    await authService.login(credentials("doctor", "applicant@example.test"));
    await expect(doctorPortalService.reopenApplication()).rejects.toMatchObject({ code: "REAPPLY_TOO_SOON" });
  });

  it("invites a doctor with a single link that sets the password", async () => {
    await signInAdmin();
    const invited = await adminService.addDoctor({
      name: "Prof. Senior Doctor",
      email: "senior@example.test",
      specialtyId: "cardiology",
      qualifications: ["MBBS", "FRCP"],
      experienceYears: 30,
      fee: 3000,
      location: "Dhaka",
      facilityIds: ["f1"],
    });
    expect(invited.application.status).toBe("invited");
    const hours = (new Date(invited.application.invitationExpiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47);
    expect(hours).toBeLessThanOrEqual(48);
    await authService.logout();

    const token = invited.simulatedInvitationToken;
    expect((await authService.getInvitation(token)).email).toBe("senior@example.test");
    const { user } = await authService.acceptInvitation({ token, password: "Senior-pass-1!" });
    expect(user).toMatchObject({ onboardingStatus: "in_progress", emailVerified: true });
    await expect(authService.getInvitation(token)).rejects.toMatchObject({ status: 410 });
  });
});

describe("completing a visit", () => {
  it("lets the doctor complete an accepted visit once its time has come, not before", async () => {
    await signInDoctor();
    // a1 is an accepted fixture appointment on a past date.
    expect((await doctorPortalService.updateAppointmentStatus("a1", "completed")).status).toBe("completed");
    await expect(doctorPortalService.updateAppointmentStatus("a1", "completed")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });

    db.appointments.push({
      id: "future-visit",
      doctorId: "d1",
      facilityId: "f1",
      date: daysFromNow(3),
      time: "4:00 PM",
      status: "accepted",
    });
    await expect(
      doctorPortalService.updateAppointmentStatus("future-visit", "completed"),
    ).rejects.toMatchObject({
      code: "TOO_EARLY",
    });
  });
});
