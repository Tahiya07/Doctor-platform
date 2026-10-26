import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App, { AppProviders } from "../../App.jsx";
import { PATHS } from "../../constants.js";
import PasswordInput from "./PasswordInput.jsx";

describe("PasswordInput", () => {
  it("shows and hides what was typed", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Secret" />);
    const box = screen.getByLabelText("Secret");
    expect(box).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(box).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(box).toHaveAttribute("type", "password");
  });

  it("has no eye when `reveal` is off", () => {
    render(<PasswordInput aria-label="Secret" reveal={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ticks off the rules of a new password as they are met", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Secret" rules />);
    const rules = screen.getByRole("list");
    expect(rules.querySelectorAll(".is-met")).toHaveLength(0);
    await user.type(screen.getByLabelText("Secret"), "abcdefghij");
    expect(rules.querySelectorAll(".is-met")).toHaveLength(2); // 10 characters, a lowercase letter
    await user.clear(screen.getByLabelText("Secret"));
    await user.type(screen.getByLabelText("Secret"), "Abcdefghi1!");
    expect(rules.querySelectorAll(".is-met")).toHaveLength(5);
  });
});

describe("sign-in pages", () => {
  const open = (path) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>,
    );

  it("lets patients and doctors show their password", async () => {
    for (const path of [PATHS.login, PATHS.doctorLogin]) {
      const { unmount } = open(path);
      expect(await screen.findByRole("button", { name: "Show password" })).toBeInTheDocument();
      unmount();
    }
  });

  it("does not offer it on the administrator sign-in", async () => {
    open(PATHS.adminLogin);
    expect(await screen.findByLabelText(/^Password/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show password" })).not.toBeInTheDocument();
  });
});
