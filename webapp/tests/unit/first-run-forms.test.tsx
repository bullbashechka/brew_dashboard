import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LanguageForm, LoginForm, OnboardingForm } from "../../src/components/first-run-forms";

afterEach(cleanup);

describe("Stage 7 first-run forms", () => {
  it("keeps login credentials after a generic failure and blocks invalid submissions", async () => {
    const user = userEvent.setup();
    let submissions = 0;
    render(
      <LoginForm
        locale="en"
        onSubmit={async () => {
          submissions += 1;
          throw new Error("nope");
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(submissions).toBe(0);
    expect(screen.getByRole("alert").textContent).toContain("Login must be");

    await user.type(screen.getByLabelText("Login alias"), "demo.owner");
    await user.type(screen.getByLabelText("Password"), "Valid-password-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(submissions).toBe(1));
    expect(screen.getByRole("alert").textContent).toContain("Invalid login or password.");
    expect((screen.getByLabelText("Login alias") as HTMLInputElement).value).toBe("demo.owner");
  });

  it("preselects English and persists the selected language", async () => {
    const user = userEvent.setup();
    const submitted: string[] = [];
    render(
      <LanguageForm
        locale="en"
        onSubmit={async (language) => {
          submitted.push(language);
        }}
      />,
    );

    expect((screen.getByRole("radio", { name: "English" }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("radio", { name: "Русский" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(submitted).toEqual(["ru"]));
  });

  it("validates normalized duplicate locations and preserves onboarding values after a server error", async () => {
    const user = userEvent.setup();
    let submissions = 0;
    render(
      <OnboardingForm
        locale="en"
        onSubmit={async () => {
          submissions += 1;
          throw new Error("server");
        }}
      />,
    );

    await user.type(screen.getByLabelText("Network name"), "Roast House");
    await user.type(screen.getByLabelText("Owner name"), "Alex Owner");
    await user.type(screen.getByLabelText("Location 1 name"), "Downtown");
    await user.type(screen.getByLabelText("Location 2 name"), " downtown ");
    await user.type(screen.getByLabelText("Location 3 name"), "Airport");
    await user.type(screen.getByRole("textbox", { name: /^Country code/ }), "KZ");
    await user.type(screen.getByLabelText("Currency"), "KZT");
    const timeZone = screen.getByLabelText("Timezone");
    await user.clear(timeZone);
    await user.type(timeZone, "Asia/Almaty");
    await user.click(screen.getByRole("button", { name: "Create my dashboard" }));

    expect(submissions).toBe(0);
    expect(
      screen
        .getAllByRole("alert")
        .some((element) => element.textContent?.includes("Location names must be unique")),
    ).toBe(true);

    const secondLocation = screen.getByRole("textbox", { name: /^Location 2 name/ });
    await user.clear(secondLocation);
    await user.type(secondLocation, "Riverside");
    await user.click(screen.getByRole("button", { name: "Create my dashboard" }));
    await waitFor(() => expect(submissions).toBe(1));
    expect((screen.getByLabelText("Network name") as HTMLInputElement).value).toBe("Roast House");
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
  });
});
