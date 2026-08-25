import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiClientError } from "../../src/api/client";
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
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
    expect((screen.getByLabelText("Login alias") as HTMLInputElement).value).toBe("demo.owner");
  });

  it("maps login status codes without exposing server error text", async () => {
    const user = userEvent.setup();
    let error: unknown = new ApiClientError(
      "bad credentials",
      401,
      "UNAUTHENTICATED",
      {},
      "123e4567-e89b-12d3-a456-426614174000",
    );
    const { rerender } = render(
      <LoginForm locale="en" onSubmit={async () => Promise.reject(error)} />,
    );

    await user.type(screen.getByLabelText("Login alias"), "demo.owner");
    await user.type(screen.getByLabelText("Password"), "Valid-password-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Invalid login");
      expect(screen.getByRole("alert").textContent).toContain("Support ID");
    });

    error = new ApiClientError("slow down", 429, "RATE_LIMITED");
    rerender(<LoginForm locale="en" onSubmit={async () => Promise.reject(error)} />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Too many requests"),
    );
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
    expect((screen.getByLabelText("Currency") as HTMLInputElement).value).toBe("KZT");
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

  it("suggests country defaults without overwriting manual values", async () => {
    const user = userEvent.setup();
    render(<OnboardingForm locale="en" onSubmit={async () => undefined} />);

    const country = screen.getByRole("textbox", { name: /^Country code/ });
    const currency = screen.getByLabelText("Currency") as HTMLInputElement;
    const timeZone = screen.getByLabelText("Timezone") as HTMLInputElement;

    await user.type(country, "KZ");
    expect(currency.value).toBe("KZT");
    expect(timeZone.value).toBe("Asia/Almaty");

    await user.clear(currency);
    await user.type(currency, "JPY");
    await user.clear(country);
    await user.type(country, "RU");
    expect(currency.value).toBe("JPY");
    expect(timeZone.value).toBe("Europe/Moscow");

    await user.clear(timeZone);
    await user.clear(country);
    await user.type(country, "US");
    expect(timeZone.value).toBe("");

    await user.clear(country);
    await user.type(country, "ZZ");
    expect(currency.value).toBe("JPY");
    expect(timeZone.value).toBe("");
  });
});
