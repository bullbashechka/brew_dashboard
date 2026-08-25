import { useState, type FormEvent } from "react";
import { useForm } from "@tanstack/react-form";
import {
  languageSchema,
  loginRequestSchema,
  onboardingRequestSchema,
  type OnboardingRequest,
} from "@brew-dashboard/contracts";

import { Button } from "@/components/ui/button";
import { FormError, ProgressState } from "@/components/ui/states";
import { type AppLocale, translate } from "@/lib/i18n";

type LoginValues = { login: string; password: string };
export type OnboardingFormValues = Omit<OnboardingRequest, "idempotencyKey">;

const locationFieldNames = [
  "locations[0].name",
  "locations[1].name",
  "locations[2].name",
  "locations[3].name",
  "locations[4].name",
] as const;

const validateOnboarding = ({ value }: { value: OnboardingFormValues }) => {
  const parsed = onboardingRequestSchema.safeParse({
    ...value,
    idempotencyKey: "00000000-0000-4000-8000-000000000000",
  });
  if (parsed.success) return undefined;
  return {
    fields: Object.fromEntries(
      parsed.error.issues.map((issue) => [
        issue.path
          .map((segment, index) =>
            typeof segment === "number"
              ? `[${segment}]`
              : index
                ? `.${String(segment)}`
                : String(segment),
          )
          .join(""),
        issue.message,
      ]),
    ),
  };
};

const messageFor = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = value.message;
    return typeof message === "string" ? message : null;
  }
  return null;
};

function ValidationMessage({ errors }: { errors: unknown[] }) {
  const messages = errors.map(messageFor).filter((message): message is string => Boolean(message));
  if (!messages.length) return null;
  return (
    <p role="alert" className="mt-1 text-sm text-red-800">
      {messages.join(" ")}
    </p>
  );
}

export function LoginForm({
  locale,
  onSubmit,
}: {
  locale: AppLocale;
  onSubmit: (value: LoginValues) => Promise<void>;
}) {
  const [values, setValues] = useState<LoginValues>({ login: "", password: "" });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = loginRequestSchema.safeParse(values);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? translate(locale, "errors.validation"));
      return;
    }
    setValidationError(null);
    setSubmitError(null);
    setPending(true);
    try {
      await onSubmit(parsed.data);
    } catch (error) {
      setSubmitError(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={(event) => void submit(event)} noValidate>
      <label className="grid gap-1 text-sm font-medium text-stone-800">
        {translate(locale, "auth.alias")}
        <input
          autoComplete="username"
          className="control w-full"
          disabled={pending}
          name="login"
          onChange={(event) => setValues((current) => ({ ...current, login: event.target.value }))}
          value={values.login}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium text-stone-800">
        {translate(locale, "auth.password")}
        <input
          autoComplete="current-password"
          className="control w-full"
          disabled={pending}
          name="password"
          onChange={(event) =>
            setValues((current) => ({ ...current, password: event.target.value }))
          }
          type="password"
          value={values.password}
        />
      </label>
      {validationError && (
        <p role="alert" className="text-sm text-red-800">
          {validationError}
        </p>
      )}
      {Boolean(submitError) && (
        <p role="alert" className="text-sm text-red-800">
          {translate(locale, "auth.invalidCredentials")}
        </p>
      )}
      <Button className="w-full" disabled={pending} type="submit" aria-busy={pending || undefined}>
        {pending ? (
          <ProgressState locale={locale} label={translate(locale, "auth.pending")} />
        ) : (
          translate(locale, "auth.submit")
        )}
      </Button>
    </form>
  );
}

export function LanguageForm({
  locale,
  onSubmit,
}: {
  locale: AppLocale;
  onSubmit: (language: "en" | "ru") => Promise<void>;
}) {
  const [language, setLanguage] = useState<"en" | "ru">("en");
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = languageSchema.safeParse(language);
    if (!parsed.success) return;
    setSubmitError(null);
    setPending(true);
    try {
      await onSubmit(parsed.data);
    } catch (error) {
      setSubmitError(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={pending} className="space-y-3">
        <legend className="sr-only">{translate(locale, "language.title")}</legend>
        {(["en", "ru"] as const).map((value) => (
          <label
            key={value}
            className="flex min-h-12 items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 text-sm font-medium text-stone-800"
          >
            <input
              checked={language === value}
              name="language"
              onChange={() => setLanguage(value)}
              type="radio"
              value={value}
            />
            {translate(locale, value === "en" ? "language.english" : "language.russian")}
          </label>
        ))}
      </fieldset>
      <FormError locale={locale} error={submitError} />
      <Button className="w-full" disabled={pending} type="submit" aria-busy={pending || undefined}>
        {pending ? (
          <ProgressState locale={locale} label={translate(locale, "language.pending")} />
        ) : (
          translate(locale, "language.submit")
        )}
      </Button>
    </form>
  );
}

const defaultTimeZone = (() => {
  const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return value && Intl.DateTimeFormat("en-US", { timeZone: value }) ? value : "";
})();

const defaultValues: OnboardingFormValues = {
  networkName: "",
  ownerName: "",
  locations: [{ name: "" }, { name: "" }, { name: "" }],
  country: "",
  currency: "",
  timeZone: defaultTimeZone,
};

export function OnboardingForm({
  locale,
  onSubmit,
}: {
  locale: AppLocale;
  onSubmit: (value: OnboardingFormValues) => Promise<void>;
}) {
  const [submitError, setSubmitError] = useState<unknown>(null);
  const form = useForm({
    defaultValues,
    validators: { onSubmit: validateOnboarding },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await onSubmit(value);
      } catch (error) {
        setSubmitError(error);
      }
    },
  });

  const setLocationCount = (count: number) => {
    const locations = form.state.values.locations;
    form.setFieldValue(
      "locations",
      Array.from({ length: count }, (_, index) => locations[index] ?? { name: "" }),
    );
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      noValidate
    >
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <fieldset disabled={pending} className="space-y-5">
            <form.Field name="networkName">
              {(field) => (
                <label className="grid gap-1 text-sm font-medium text-stone-800">
                  {translate(locale, "onboarding.networkName")}
                  <input
                    className="control w-full"
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                  <ValidationMessage errors={field.state.meta.errors} />
                </label>
              )}
            </form.Field>
            <form.Field name="ownerName">
              {(field) => (
                <label className="grid gap-1 text-sm font-medium text-stone-800">
                  {translate(locale, "onboarding.ownerName")}
                  <input
                    className="control w-full"
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                  <ValidationMessage errors={field.state.meta.errors} />
                </label>
              )}
            </form.Field>
            <label className="grid gap-1 text-sm font-medium text-stone-800">
              {translate(locale, "onboarding.locationCount")}
              <select
                className="control w-full"
                onChange={(event) => setLocationCount(Number(event.target.value))}
                value={form.state.values.locations.length}
              >
                {[1, 2, 3, 4, 5].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            {form.state.values.locations.slice(0, 5).map((_, index) => {
              const fieldName = locationFieldNames[index]!;
              return (
                <form.Field key={fieldName} name={fieldName}>
                  {(field) => (
                    <label className="grid gap-1 text-sm font-medium text-stone-800">
                      {translate(locale, "onboarding.locationName", { number: index + 1 })}
                      <input
                        className="control w-full"
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        value={field.state.value}
                      />
                      <ValidationMessage errors={field.state.meta.errors} />
                    </label>
                  )}
                </form.Field>
              );
            })}
            <div className="grid gap-5 sm:grid-cols-2">
              <form.Field name="country">
                {(field) => (
                  <label className="grid gap-1 text-sm font-medium text-stone-800">
                    {translate(locale, "onboarding.country")}
                    <input
                      className="control w-full uppercase"
                      maxLength={2}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                      value={field.state.value}
                    />
                    <span className="text-xs font-normal text-stone-600">
                      {translate(locale, "onboarding.countryHint")}
                    </span>
                    <ValidationMessage errors={field.state.meta.errors} />
                  </label>
                )}
              </form.Field>
              <form.Field name="currency">
                {(field) => (
                  <label className="grid gap-1 text-sm font-medium text-stone-800">
                    {translate(locale, "onboarding.currency")}
                    <input
                      className="control w-full uppercase"
                      maxLength={3}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                      value={field.state.value}
                    />
                    <ValidationMessage errors={field.state.meta.errors} />
                  </label>
                )}
              </form.Field>
            </div>
            <form.Field name="timeZone">
              {(field) => (
                <label className="grid gap-1 text-sm font-medium text-stone-800">
                  {translate(locale, "onboarding.timeZone")}
                  <input
                    className="control w-full"
                    list="time-zone-options"
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                  <datalist id="time-zone-options">
                    {Intl.supportedValuesOf("timeZone").map((timeZone) => (
                      <option key={timeZone} value={timeZone} />
                    ))}
                  </datalist>
                  <ValidationMessage errors={field.state.meta.errors} />
                </label>
              )}
            </form.Field>
            <FormError locale={locale} error={submitError} />
            <Button className="w-full" type="submit" aria-busy={pending || undefined}>
              {pending ? (
                <ProgressState locale={locale} label={translate(locale, "onboarding.pending")} />
              ) : (
                translate(locale, "onboarding.submit")
              )}
            </Button>
          </fieldset>
        )}
      </form.Subscribe>
    </form>
  );
}
