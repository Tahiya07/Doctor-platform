import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App, { AppProviders } from "../../App.jsx";
import { DEMO_RESET_TOKEN, PATHS } from "../../constants.js";
import { authService } from "../../services/index.js";

function renderApp(path) {
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

describe("password reset service (demo adapter)", () => {
  it("answers the same way for any well-formed email, so accounts cannot be discovered", async () => {
    await expect(authService.requestPasswordReset("nobody@example.test")).resolves.toEqual({ sent: true });
    await expect(authService.requestPasswordReset("demo.patient@example.test")).resolves.toEqual({
      sent: true,
    });
  });

  it("rejects a malformed email", async () => {
    await expect(authService.requestPasswordReset("not-an-email")).rejects.toMatchObject({ status: 422 });
  });

  it("accepts a valid token and a strong enough password", async () => {
    await expect(
      authService.resetPassword({ token: DEMO_RESET_TOKEN, password: "A-brand-new-one-1!" }),
    ).resolves.toEqual({ reset: true });
  });

  it("refuses a wrong or expired token (410) and a short password (422)", async () => {
    await expect(
      authService.resetPassword({ token: "expired", password: "A-brand-new-one-1!" }),
    ).rejects.toMatchObject({ status: 410, code: "RESET_TOKEN_INVALID" });
    await expect(
      authService.resetPassword({ token: DEMO_RESET_TOKEN, password: "short" }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("forgot password screens", () => {
  it("links to the reset page from every sign-in screen", async () => {
    for (const path of [PATHS.login, PATHS.doctorLogin, PATHS.adminLogin]) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <AppProviders>
            <App />
          </AppProviders>
        </MemoryRouter>,
      );
      expect(await screen.findByRole("link", { name: "Forgot your password?" })).toBeInTheDocument();
      unmount();
    }
  });

  it("walks a user from sign-in to a new password and back to sign-in", async () => {
    const user = renderApp("/login");
    await user.click(await screen.findByRole("link", { name: "Forgot your password?" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Reset your password" })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Email/), "someone@example.test");
    await user.click(screen.getByRole("button", { name: /Send reset link/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Reset link sent" })).toBeInTheDocument();
    expect(screen.getByText(/If an account exists for someone@example.test/)).toBeInTheDocument();

    // Demo mode shows the link a real email would contain.
    await user.click(screen.getByRole("link", { name: "Open the demo reset link" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Choose a new password" }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^New password/), "A-brand-new-one-1!");
    await user.type(screen.getByLabelText(/^Confirm new password/), "A-brand-new-one-1!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in to Carewell" })).toBeInTheDocument();
    expect(
      screen.getByText("Your password was updated. Sign in with your new password."),
    ).toBeInTheDocument();
  });

  it("validates the email before sending", async () => {
    const user = renderApp("/forgot-password");
    await user.type(await screen.findByLabelText(/^Email/), "nope");
    await user.click(screen.getByRole("button", { name: /Send reset link/ }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.queryByText("Reset link sent")).not.toBeInTheDocument();
  });

  it("disables 'send again' for a moment after sending", async () => {
    const user = renderApp("/forgot-password");
    await user.type(await screen.findByLabelText(/^Email/), "someone@example.test");
    await user.click(screen.getByRole("button", { name: /Send reset link/ }));
    expect(await screen.findByRole("button", { name: /Send again in \d+s/ })).toBeDisabled();
  });
});

describe("reset password screen", () => {
  it("checks the new password before submitting", async () => {
    const user = renderApp(`/reset-password?token=${DEMO_RESET_TOKEN}`);
    await user.type(await screen.findByLabelText(/^New password/), "short");
    await user.type(screen.getByLabelText(/^Confirm new password/), "different");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Use at least 10 characters.")).toBeInTheDocument();
    expect(screen.getByText("The passwords don’t match.")).toBeInTheDocument();
  });

  it("explains an expired link and offers a new one", async () => {
    const user = renderApp("/reset-password?token=expired-token");
    await user.type(await screen.findByLabelText(/^New password/), "A-brand-new-one-1!");
    await user.type(screen.getByLabelText(/^Confirm new password/), "A-brand-new-one-1!");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("This link has expired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      expect.stringContaining("/forgot-password"),
    );
  });

  it("handles a link without a token", async () => {
    renderApp("/reset-password");
    expect(await screen.findByText("This link is incomplete")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toBeInTheDocument();
  });
});
