import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App, { AppProviders } from "../../App.jsx";
import { PATHS } from "../../constants.js";

vi.setConfig({ testTimeout: 20000 });

const openHome = () =>
  render(
    <MemoryRouter initialEntries={[PATHS.discover]}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>,
  );

describe("home page", () => {
  it("opens with a banner that says what the site holds, then the sections below it", async () => {
    openHome();
    expect(await screen.findByRole("heading", { level: 1, name: /Good care starts/ })).toBeInTheDocument();
    const stats = screen.getByText("verified doctors").closest("ul");
    expect(within(stats).getByText("hospitals & clinics")).toBeInTheDocument();
    expect(within(stats).getByText("specialties")).toBeInTheDocument();

    for (const heading of [/Care for every/, /Meet our/, /Three steps to/, /Hospitals & clinics near you/]) {
      expect(await screen.findByRole("heading", { level: 2, name: heading })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { level: 2, name: /Made to be/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Reach patients who are/ })).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: /Join as a doctor/ }))
      expect(link).toHaveAttribute("href", PATHS.doctorRegister);
  });

  it("answers the common questions in place", async () => {
    const user = userEvent.setup();
    openHome();
    const question = await screen.findByText("How do I pay?");
    const item = question.closest("details");
    expect(item).not.toHaveAttribute("open");
    await user.click(question);
    expect(item).toHaveAttribute("open");
    expect(within(item).getByText(/does not take payments/)).toBeInTheDocument();
  });

  it("opens the directory for a specialty chosen from the grid", async () => {
    const user = userEvent.setup();
    openHome();
    const card = (await screen.findAllByRole("button", { name: /\d+ doctors?$/ }))[0];
    await user.click(card);
    expect(await screen.findByRole("heading", { level: 1, name: /Find your doctor/ })).toBeInTheDocument();
  });
});
