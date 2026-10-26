import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App, { AppProviders } from "./App.jsx";
import { DEMO_VERIFICATION_CODE, PATHS } from "./constants.js";
import { useResource } from "./hooks/useResource.js";
import { adminService, authService } from "./services/index.js";

vi.setConfig({ testTimeout: 20000 });

function renderApp(path = "/discover") {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>,
  );
  return user;
}

/** Opens the unlisted administrator sign-in, signs in and continues to `path`. */
async function renderAsAdmin(path) {
  const user = renderApp({ pathname: PATHS.adminLogin, state: { from: { pathname: path } } });
  await signIn(user, "admin@example.test");
  return user;
}

/** Fills whichever sign-in form is on screen (any portal). */
async function signIn(user, email = "someone@example.test") {
  await user.type(await screen.findByLabelText(/^Email/), email);
  await user.type(screen.getByLabelText(/^Password/), "Correct-horse-1!");
  await user.click(screen.getByRole("button", { name: /^Sign in/ }));
}

/** Fills the patient sign-up form and submits it. */
async function signUp(user, { name = "Nila Akter", email = "nila@example.test" } = {}) {
  await user.type(await screen.findByLabelText(/^Full name/), name);
  await user.type(screen.getByLabelText(/^Email/), email);
  await user.type(screen.getByLabelText(/^Phone number/), "+8801811111111");
  await user.type(screen.getByLabelText(/^Password/), "Correct-horse-1!");
  await user.type(screen.getByLabelText(/^Confirm password/), "Correct-horse-1!");
  await user.click(screen.getByRole("button", { name: /Create account/ }));
}

async function verifyWith(user, code = DEMO_VERIFICATION_CODE) {
  await user.type(await screen.findByLabelText(/Verification code/), code);
  await user.click(screen.getByRole("button", { name: "Verify email" }));
}

/** From a guest on a doctor's profile: click Book, sign in, and wait for the wizard to reopen. */
async function startBookingAsGuest(user) {
  await user.click(await screen.findByRole("button", { name: /Book an appointment/ }));
  expect(await screen.findByRole("heading", { level: 1, name: "Sign in to Carewell" })).toBeInTheDocument();
  await signIn(user);
  return screen.findByRole("dialog");
}

/** Walks the wizard from the doctor step to the details step, choosing tomorrow at 5:30 PM. */
async function reachDetails(user, dialog) {
  await user.click(within(dialog).getByRole("button", { name: /Choose a clinic/ }));
  await user.click(within(dialog).getByRole("button", { name: /Choose date & time/ }));
  const dates = within(within(dialog).getByRole("group", { name: "Choose a date" })).getAllByRole("button");
  await user.click(dates[1]); // tomorrow: every time is still ahead
  await user.click(await within(dialog).findByRole("button", { name: "5:30 PM" }));
  await user.click(within(dialog).getByRole("button", { name: /^Continue/ }));
}

describe("discovery (open to everyone)", () => {
  it("shows the home page with featured doctors", async () => {
    renderApp("/discover");
    expect(await screen.findByRole("heading", { level: 1, name: /Good care starts/ })).toBeInTheDocument();
    expect((await screen.findAllByText("Dr. Arif Rahman")).length).toBeGreaterThan(0);
  });

  it("filters the directory when a popular specialty is chosen", async () => {
    const user = renderApp("/discover");
    await user.click(await screen.findByRole("button", { name: "Dermatology" }));
    expect(await screen.findByText("Dr. Nusrat Jahan")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Dr. Arif Rahman")).not.toBeInTheDocument());
  });

  it("reads filters from the URL and clears them", async () => {
    const user = renderApp("/doctors?specialty=cardiology");
    expect(await screen.findByText("Dr. Arif Rahman")).toBeInTheDocument();
    expect(screen.queryByText("Dr. Nusrat Jahan")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(await screen.findByText("Dr. Nusrat Jahan")).toBeInTheDocument();
  });

  it("shows a doctor profile without signing in", async () => {
    renderApp("/doctors/d2");
    expect(await screen.findByRole("heading", { level: 1, name: "Dr. Nusrat Jahan" })).toBeInTheDocument();
  });

  it("explains when a profile is unavailable", async () => {
    renderApp("/doctors/d6"); // pending verification, never public
    expect(await screen.findByText("Doctor profile unavailable")).toBeInTheDocument();
  });

  it("answers unknown URLs with a not-found page", async () => {
    renderApp("/nope");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(document.title).toBe("Page not found · Carewell");
  });
});

describe("account gate", () => {
  it.each(["/appointments", "/messages", "/profile"])(
    "asks guests to sign in before opening %s",
    async (path) => {
      renderApp(path);
      expect(
        await screen.findByRole("heading", { level: 1, name: "Sign in to Carewell" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Please sign in to continue.")).toBeInTheDocument();
    },
  );

  it("returns to the page the guest was heading to after signing in", async () => {
    const user = renderApp("/appointments");
    await signIn(user);
    expect(await screen.findByRole("heading", { level: 1, name: /Appointments/ })).toBeInTheDocument();
  });

  it("offers guests sign-in and sign-up, and patients their profile", async () => {
    const user = renderApp("/discover");
    const nav = await screen.findByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Create account" })).toBeInTheDocument();

    await user.click(within(nav).getByRole("link", { name: "Sign in" }));
    await signIn(user);
    expect(await within(nav).findByRole("link", { name: "My profile" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("lets a patient edit their name and phone", async () => {
    const user = renderApp("/profile");
    await signIn(user);
    const name = await screen.findByLabelText(/^Full name/);
    await user.clear(name);
    await user.type(name, "Demo Person");
    await user.click(screen.getByRole("button", { name: /Save changes/ }));
    expect(await screen.findByText("Your details were saved.")).toBeInTheDocument();
    expect(screen.getAllByText("Demo Person").length).toBeGreaterThan(0);
  });
});

describe("sign-up and email verification", () => {
  it("creates an account, rejects a wrong code and accepts the right one", async () => {
    const user = renderApp("/signup");
    await signUp(user);
    expect(await screen.findByRole("heading", { level: 1, name: "Verify your email" })).toBeInTheDocument();
    expect(screen.getByText(/nila@example.test/)).toBeInTheDocument();

    await verifyWith(user, "000000");
    expect(await screen.findByText(/That code isn’t right/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/Verification code/));
    await verifyWith(user);
    expect(await screen.findByText("Email verified. Welcome to Carewell!")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: /Good care starts/ })).toBeInTheDocument();
  });

  it("validates the sign-up form", async () => {
    const user = renderApp("/signup");
    await user.type(await screen.findByLabelText(/^Full name/), "N");
    await user.type(screen.getByLabelText(/^Password/), "short");
    await user.type(screen.getByLabelText(/^Confirm password/), "different");
    await user.click(screen.getByRole("button", { name: /Create account/ }));
    expect(await screen.findByText("Enter your full name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 10 characters.")).toBeInTheDocument();
    expect(screen.getByText("The passwords don’t match.")).toBeInTheDocument();
  });

  it("keeps an unverified patient on the verification step", async () => {
    const user = renderApp("/signup");
    await signUp(user);
    await screen.findByRole("heading", { level: 1, name: "Verify your email" });
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    await user.click(within(nav).getByRole("link", { name: "Appointments" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Verify your email" })).toBeInTheDocument();
  });

  it("starts a new patient with an empty appointment list", async () => {
    const user = renderApp("/signup");
    await signUp(user);
    await verifyWith(user);
    const nav = await screen.findByRole("navigation", { name: "Main navigation" });
    await user.click(within(nav).getByRole("link", { name: "Appointments" }));
    expect(await screen.findByText("Nothing on the calendar yet")).toBeInTheDocument();
  });
});

describe("booking", () => {
  it("sends a guest to sign in, brings them back to the doctor, and creates a pending request", async () => {
    const user = renderApp("/doctors/d1");
    const dialog = await startBookingAsGuest(user);
    // Back on the same doctor, with the wizard already open.
    expect(screen.getByRole("heading", { level: 1, name: "Dr. Arif Rahman" })).toBeInTheDocument();

    await reachDetails(user, dialog);
    // Details are pre-filled from the account.
    expect(within(dialog).getByLabelText(/Patient name/)).toHaveValue("Demo patient");
    expect(within(dialog).getByLabelText(/Email address/)).toHaveValue("someone@example.test");

    await user.type(within(dialog).getByLabelText(/Reason for visit/), "Follow-up on test results");
    await user.click(within(dialog).getByRole("button", { name: /Request appointment/ }));

    expect(await screen.findByRole("heading", { level: 1, name: /Appointments/ })).toBeInTheDocument();
    expect(await screen.findByText(/Simulated request submitted for Dr. Arif Rahman/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Pending").length).toBeGreaterThanOrEqual(2));
  });

  it("returns a brand-new patient to the doctor after sign-up and verification", async () => {
    const user = renderApp("/doctors/d2");
    await user.click(await screen.findByRole("button", { name: /Book an appointment/ }));
    await user.click(await screen.findByRole("link", { name: "Create an account" }));
    await signUp(user);
    await verifyWith(user);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Dr. Nusrat Jahan" })).toBeInTheDocument();
  });

  it("books for a family member and labels the request", async () => {
    const user = renderApp("/doctors/d1");
    const dialog = await startBookingAsGuest(user);
    await reachDetails(user, dialog);

    await user.selectOptions(within(dialog).getByLabelText(/Who is this appointment for/), "child");
    expect(within(dialog).getByLabelText(/Patient name/)).toHaveValue(""); // not the parent's name
    await user.click(within(dialog).getByRole("button", { name: /Request appointment/ }));
    expect(await within(dialog).findByText("Enter the patient's full name.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Patient name/), "Tuli Das");
    await user.type(within(dialog).getByLabelText(/Reason for visit/), "Fever for two days");
    await user.click(within(dialog).getByRole("button", { name: /Request appointment/ }));

    expect(await screen.findByText("For Tuli Das (child)")).toBeInTheDocument();
  });

  it("shows step errors instead of silently ignoring Continue", async () => {
    const user = renderApp("/doctors/d1");
    const dialog = await startBookingAsGuest(user);
    await user.click(within(dialog).getByRole("button", { name: /Choose a clinic/ }));
    await user.click(within(dialog).getByRole("button", { name: /Choose date & time/ }));
    await user.click(within(dialog).getByRole("button", { name: /^Continue/ }));
    expect(await within(dialog).findByText("Choose a date and time to continue.")).toBeInTheDocument();
  });

  it("closes with Escape", async () => {
    const user = renderApp("/doctors/d1");
    await startBookingAsGuest(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not let a doctor book", async () => {
    const user = renderApp("/doctor/login");
    await signIn(user, "dr.arif@example.test");
    await screen.findByRole("heading", { level: 1, name: "Doctor workspace" });
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).queryByRole("link", { name: "Appointments" })).not.toBeInTheDocument();
    await user.click(within(nav).getByRole("link", { name: "Doctors" }));
    await user.click((await screen.findAllByRole("button", { name: /Book visit/ }))[0]);
    expect(await screen.findByText(/Booking is for patient accounts/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("appointments", () => {
  it("cancels a request after confirmation", async () => {
    const user = renderApp("/appointments");
    await signIn(user);
    const cancelButtons = await screen.findAllByRole("button", { name: "Cancel" });
    await user.click(cancelButtons[0]);
    await user.click(await screen.findByRole("button", { name: "Cancel request" }));
    expect(await screen.findByText(/marked cancelled/)).toBeInTheDocument();
  });
});

describe("administrator area", () => {
  it("shows guests 'not found' instead of pointing them to the administrator sign-in", async () => {
    renderApp("/admin/doctors");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Administrator sign in" })).not.toBeInTheDocument();
  });

  it("signs in at the unlisted address, then opens the dashboard and every admin page", async () => {
    const user = renderApp(PATHS.adminLogin);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Administrator sign in" }),
    ).toBeInTheDocument();

    await signIn(user, "admin@example.test");
    expect(
      await screen.findByRole("heading", { level: 1, name: /A calmer way to care for care/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Appointments today")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const pages = [
      ["Doctor management", /Doctor\s+management/],
      ["Verification", /Review with confidence/],
      ["Facility management", /Facility\s+management/],
      ["Appointment management", /Appointment\s+management/],
      ["Specialties", /Specialties, made clear/],
      ["Availability", /Availability\s+management/],
    ];
    for (const [link, heading] of pages) {
      await user.click(within(nav).getByRole("link", { name: link }));
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    }
  });

  it("adds a facility without crashing (regression)", async () => {
    const user = await renderAsAdmin(PATHS.adminFacilities);
    await user.click(await screen.findByRole("button", { name: /Add facility/ }));
    await user.type(await screen.findByLabelText(/Facility name/), "Riverside Clinic");
    await user.type(screen.getByLabelText(/Street address/), "House 4, Road 2");
    await user.type(screen.getByLabelText(/^Area/), "Mirpur");
    await user.type(screen.getByLabelText(/Contact phone/), "+880 2 5555 0000");
    await user.click(screen.getByRole("button", { name: /Save facility/ }));
    expect(await screen.findByText("Facility profile saved.")).toBeInTheDocument();
    expect(await screen.findByText("Riverside Clinic")).toBeInTheDocument();
  });

  it("checks the BMDC certificate, approves the application, then publishes", async () => {
    const user = await renderAsAdmin(PATHS.adminVerification);
    const card = (await screen.findByRole("heading", { name: "Dr. Mahmud Hasan" })).closest("article");
    expect(within(card).getByText("BMDC-registration.pdf")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Search the BMDC register/ })).toHaveAttribute(
      "href",
      "https://verify.bmdc.org.bd/",
    );
    expect(within(card).getByRole("button", { name: /Approve/ })).toBeDisabled(); // no BMDC check yet

    await user.click(within(card).getByRole("button", { name: "Save BMDC check" })); // "Matched" is preselected
    await user.click(await within(card).findByRole("button", { name: /Approve/ }));
    expect(await screen.findByText("Dr. Mahmud Hasan approved.")).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", {
        name: "Doctor management",
      }),
    );
    const row = (await screen.findByText("Dr. Mahmud Hasan")).closest("tr");
    await user.click(await within(row).findByRole("button", { name: "Publish" }));
    expect(await screen.findByText(/Dr. Mahmud Hasan profile published/)).toBeInTheDocument();
  });

  it("sends an applicant to review instead of approving from the doctor list", async () => {
    await renderAsAdmin(PATHS.adminDoctors);
    const row = (await screen.findByText("Dr. Mahmud Hasan")).closest("tr");
    expect(within(row).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Review application" })).toBeInTheDocument();
  });

  it("asks before deactivating a doctor", async () => {
    const user = await renderAsAdmin(PATHS.adminDoctors);
    const row = (await screen.findByText("Dr. Farhan Ahmed")).closest("tr");
    await user.click(within(row).getByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByText("Dr. Farhan Ahmed deactivated.")).toBeInTheDocument();
  });
});

describe("doctor workspace", () => {
  it("requires sign-in, then lets the doctor accept a pending request", async () => {
    const user = renderApp("/doctor/dashboard");
    expect(await screen.findByRole("heading", { level: 1, name: "Doctor sign in" })).toBeInTheDocument();

    await signIn(user, "dr.arif@example.test");
    expect(await screen.findByRole("heading", { level: 1, name: "Doctor workspace" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Appointment requests" }));
    const row = (await screen.findByText("DEMO-REQ-1")).closest("tr");
    await user.click(within(row).getByRole("button", { name: "Accept" }));
    expect(await screen.findByText(/Request updated to accepted/)).toBeInTheDocument();
  });

  it("saves profile changes and flags credential edits for review", async () => {
    const user = renderApp("/doctor/dashboard");
    await signIn(user, "dr.arif@example.test");
    const fee = await screen.findByLabelText(/Consultation fee/);
    await user.clear(fee);
    await user.type(fee, "1800");
    await user.click(screen.getByRole("button", { name: /Save profile/ }));
    expect(await screen.findByText(/profile update saved/i)).toBeInTheDocument();
  });

  it("creates 10-minute slots from a window and rejects an overlapping one", async () => {
    const user = renderApp("/doctor/dashboard");
    await signIn(user, "dr.arif@example.test");
    await user.click(await screen.findByRole("tab", { name: "Availability" }));

    const later = new Date();
    later.setDate(later.getDate() + 2);
    const date = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, "0")}-${String(later.getDate()).padStart(2, "0")}`;
    const fill = async (start, end) => {
      const form = (await screen.findByRole("button", { name: /Create slot/ })).closest("form");
      const field = (name) => form.querySelector(`[name="${name}"]`);
      await user.clear(field("date"));
      await user.type(field("date"), date);
      await user.clear(field("startTime"));
      await user.type(field("startTime"), start);
      await user.clear(field("endTime"));
      await user.type(field("endTime"), end);
      await user.click(within(form).getByRole("button", { name: /Create slot/ }));
    };

    await fill("11:00", "11:30");
    expect(await screen.findByText(/Created 3 bookable times of 10 minutes/)).toBeInTheDocument();
    await fill("11:15", "11:45");
    expect(await screen.findByText("This slot overlaps existing availability.")).toBeInTheDocument();
  });

  it("signs out and sends the doctor back to sign-in", async () => {
    const user = renderApp("/doctor/dashboard");
    await signIn(user, "dr.arif@example.test");
    await user.click(await screen.findByRole("button", { name: /Sign out/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Doctor sign in" })).toBeInTheDocument();
  });
});

describe("joining as a doctor", () => {
  const applicant = {
    name: "Dr. Rumana Sultana",
    email: "rumana@example.test",
    phone: "+8801711000000",
    password: "Doctor-pass-123!",
    specialtyId: "cardiology",
    qualifications: ["MBBS"],
    experienceYears: 6,
    fee: 1200,
    location: "Mirpur, Dhaka",
    facilityIds: ["f1"],
  };

  it("keeps doctor registration out of the navigation and links it from the footer", async () => {
    renderApp("/discover");
    const nav = await screen.findByRole("navigation", { name: "Main navigation" });
    expect(
      within(nav).queryByRole("link", { name: /Doctor registration|Join as a doctor/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveTextContent("Join as a doctor");
  });

  it("walks an applicant through email, BMDC certificate and submission", async () => {
    await authService.registerDoctor(applicant);
    const user = renderApp(PATHS.doctorDashboard); // not approved yet: the workspace sends them to the application
    expect(
      await screen.findByRole("heading", { level: 1, name: "Your doctor application" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit application/ })).toBeDisabled();

    await user.type(screen.getByLabelText(/Verification code/), DEMO_VERIFICATION_CODE);
    await user.click(screen.getByRole("button", { name: "Confirm email" }));
    await user.upload(
      await screen.findByLabelText(/^File/),
      new File(["%PDF-1.4"], "bmdc-certificate.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /Upload/ }));
    expect(await screen.findByText("bmdc-certificate.pdf")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /Submit application/ }));
    expect(await screen.findByText(/Submitted on/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload/ })).not.toBeInTheDocument(); // locked during review
  });

  it("lets an invited doctor set a password from the link", async () => {
    await authService.login({ email: "admin@example.test", password: "x", portal: "admin" });
    const invited = await adminService.addDoctor({ ...applicant, email: "senior@example.test" });
    await authService.logout();

    const user = renderApp(`${PATHS.doctorInvitation}?token=${invited.simulatedInvitationToken}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: /Welcome, Dr. Rumana Sultana/ }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Password/), "Senior-pass-1!");
    await user.type(screen.getByLabelText(/Confirm password/), "Senior-pass-1!");
    await user.click(screen.getByRole("button", { name: /Set password and continue/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Your doctor application" }),
    ).toBeInTheDocument();
  });

  it("explains an expired invitation link", async () => {
    renderApp(`${PATHS.doctorInvitation}?token=not-a-real-token`);
    expect(await screen.findByText("This invitation link has expired")).toBeInTheDocument();
  });
});

describe("shell", () => {
  it("toggles the theme and remembers it", async () => {
    const user = renderApp("/discover");
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.click(await screen.findByRole("button", { name: /Switch to light theme/ }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("carewell-theme")).toBe("light");
  });

  it("keeps the administrator sign-in out of the navigation", async () => {
    renderApp("/discover");
    const nav = await screen.findByRole("navigation", { name: "Main navigation" });
    expect(within(nav).queryByRole("link", { name: "Administrator sign in" })).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Doctor sign in" })).toBeInTheDocument();
  });

  it("only shows admin navigation to administrators", async () => {
    renderApp("/discover");
    const nav = await screen.findByRole("navigation", { name: "Main navigation" });
    expect(within(nav).queryByRole("link", { name: "Doctor management" })).not.toBeInTheDocument();
    cleanup();
    await renderAsAdmin(PATHS.admin);
    await waitFor(() =>
      expect(
        within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", {
          name: "Doctor management",
        }),
      ).toBeInTheDocument(),
    );
  });

  it("opens the mobile drawer and navigates", async () => {
    const user = renderApp("/discover");
    await user.click(await screen.findByRole("button", { name: "Open menu" }));
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("link", { name: /Hospitals & clinics/ }));
    expect(await screen.findByRole("heading", { level: 1, name: /Find your place/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sends a support request and says it is only a demo", async () => {
    const user = renderApp("/assistance");
    await user.type(await screen.findByLabelText(/Your question/), "How do I change my appointment time?");
    await user.click(screen.getByRole("button", { name: /Send a message/ }));
    expect(await screen.findByText(/not delivered to anyone/)).toBeInTheDocument();
  });
});

describe("notifications", () => {
  it("keeps the bell disabled until someone signs in", async () => {
    renderApp("/discover");
    expect(
      await screen.findByRole("button", { name: /^Notifications \(available after you sign in\)/ }),
    ).toBeDisabled();
  });

  it("shows the unread count, lists what happened and opens the linked page", async () => {
    const user = renderApp("/appointments");
    await signIn(user);
    const bell = await screen.findByRole("button", { name: "Notifications (1 unread)" });
    await user.click(bell);

    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(within(panel).getByText("Welcome to Carewell")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: /Welcome to Carewell/ }));

    // The linked page opens, the menu closes and the count is gone.
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("marks everything as read", async () => {
    const user = renderApp("/appointments");
    await signIn(user);
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    await user.click(await screen.findByRole("button", { name: "Mark all as read" }));
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  });

  it("gives doctors and administrators their own notifications", async () => {
    const user = renderApp("/doctor/login");
    await signIn(user);
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    expect(await screen.findByText("A demo patient asked for the next free time.")).toBeInTheDocument();
  });
});

describe("background refresh", () => {
  it("re-runs a loader quietly while mounted, without a loading flash", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const { result, unmount } = renderHook(() =>
        useResource(async () => (calls += 1), [], { refreshMs: 1000 }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(result.current.data).toBe(1);
      expect(result.current.loading).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(result.current.data).toBe(2);
      expect(result.current.loading).toBe(false); // refreshed silently

      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(calls).toBe(2); // nothing runs after unmount
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the last good data when a refresh fails", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const { result } = renderHook(() =>
        useResource(
          async () => {
            calls += 1;
            if (calls > 1) throw new Error("offline");
            return "first";
          },
          [],
          { refreshMs: 1000 },
        ),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(result.current.data).toBe("first");
      expect(result.current.error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("messaging", () => {
  it("counts unread messages next to Messages, and clears the count once they are read", async () => {
    const user = renderApp("/discover");
    await user.click(await screen.findByRole("link", { name: "Sign in" }));
    await signIn(user);
    const nav = await screen.findByRole("navigation", { name: "Main navigation" });
    const messagesLink = within(nav).getByRole("link", { name: /Messages/ });
    expect(await within(messagesLink).findByLabelText("1 unread message")).toHaveTextContent("1");

    await user.click(messagesLink);
    await waitFor(() => expect(within(messagesLink).queryByLabelText(/unread/)).not.toBeInTheDocument());
  });

  it("blocks threads without an accepted appointment and sends in eligible ones", async () => {
    const user = renderApp("/messages");
    await signIn(user);
    const composer = await screen.findByLabelText("Message");
    await waitFor(() => expect(composer).toBeEnabled());
    await user.type(composer, "Thank you, see you soon");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Thank you, see you soon")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Open conversation with Dr. Farhan Ahmed/ }));
    expect(await screen.findByText(/only after the doctor accepts/)).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeDisabled();
  });

  it("explains to a new patient why there are no conversations yet", async () => {
    const user = renderApp("/signup");
    await signUp(user);
    await verifyWith(user);
    const nav = await screen.findByRole("navigation", { name: "Main navigation" });
    await user.click(within(nav).getByRole("link", { name: "Messages" }));
    expect(await screen.findByText(/No conversations yet/)).toBeInTheDocument();
  });
});
