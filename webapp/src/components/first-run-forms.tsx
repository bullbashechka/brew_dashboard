import { useRef, useState, type FormEvent } from "react";
import { useForm } from "@tanstack/react-form";
import {
  languageSchema,
  loginRequestSchema,
  onboardingRequestSchema,
  type OnboardingRequest,
} from "@brew-dashboard/contracts";
import type { z } from "zod";

import { ApiClientError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { FormError, ProgressState } from "@/components/ui/states";
import { type AppLocale, type TranslationKey, translate } from "@/lib/i18n";

type LoginValues = { login: string; password: string };
export type OnboardingFormValues = Omit<OnboardingRequest, "idempotencyKey">;

const locationFieldNames = [
  "locations[0].name",
  "locations[1].name",
  "locations[2].name",
  "locations[3].name",
  "locations[4].name",
] as const;

const localizedValidationMessage = (
  locale: AppLocale,
  issue: z.ZodIssue,
  value: OnboardingFormValues,
) => {
  const issueValue = issue.path.reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    const key = typeof segment === "number" ? segment : String(segment);
    return (current as Record<string | number, unknown>)[key];
  }, value);
  const firstPath = issue.path[0];
  let key: TranslationKey = "onboarding.validation.generic";

  if (issue.code === "custom" && issue.message === "Location names must be unique") {
    key = "onboarding.validation.duplicateLocation";
  } else if (issue.message.includes("unsupported character")) {
    key = "onboarding.validation.nameCharacters";
  } else if (firstPath === "country" && issue.message.includes("ISO 3166")) {
    key = "onboarding.validation.countryCode";
  } else if (firstPath === "currency" && issue.message.includes("ISO 4217")) {
    key = "onboarding.validation.currencyCode";
  } else if (firstPath === "timeZone" && issue.message.includes("IANA")) {
    key = "onboarding.validation.timeZone";
  } else if (
    issue.code === "invalid_type" ||
    (issue.code === "too_small" && typeof issueValue !== "string") ||
    (typeof issueValue === "string" && !issueValue.trim()) ||
    issue.message.toLowerCase().includes("required")
  ) {
    key = "onboarding.validation.required";
  } else if (issue.message.includes("at least")) {
    key = "onboarding.validation.nameMin";
  } else if (issue.message.includes("at most")) {
    key = "onboarding.validation.nameMax";
  }

  return translate(locale, key);
};

const validateOnboarding =
  (locale: AppLocale) =>
  ({ value }: { value: OnboardingFormValues }) => {
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
          localizedValidationMessage(locale, issue, value),
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
    <p role="alert" className="mt-1 text-sm text-[var(--color-danger)]">
      {messages.join(" ")}
    </p>
  );
}

function LoginSubmitError({ locale, error }: { locale: AppLocale; error: unknown }) {
  const apiError = error instanceof ApiClientError ? error : undefined;
  const messageKey: TranslationKey =
    apiError?.status === 401
      ? "auth.invalidCredentials"
      : apiError?.status === 429
        ? "errors.rateLimited"
        : "errors.generic";

  return (
    <div role="alert" className="space-y-1 text-sm text-[var(--color-danger)]">
      <p>{translate(locale, messageKey)}</p>
      {apiError?.requestId && (
        <p>{translate(locale, "errors.requestId", { requestId: apiError.requestId })}</p>
      )}
    </div>
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
      <label className="grid gap-1.5 text-sm font-medium text-[var(--color-text)]">
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
      <label className="grid gap-1.5 text-sm font-medium text-[var(--color-text)]">
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
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {validationError}
        </p>
      )}
      {Boolean(submitError) && <LoginSubmitError locale={locale} error={submitError} />}
      <Button fullWidth disabled={pending} type="submit" aria-busy={pending || undefined}>
        {pending ? (
          <ProgressState locale={locale} label={translate(locale, "auth.pending")} />
        ) : (
          translate(locale, "auth.submit")
        )}
      </Button>
    </form>
  );
}

export function MfaChallengeForm({
  locale,
  methods,
  onSubmit,
}: {
  locale: AppLocale;
  methods: ("totp" | "backup")[];
  onSubmit: (method: "totp" | "backup", code: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<"totp" | "backup">(methods[0] ?? "totp");
  const [code, setCode] = useState("");
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.trim().length < 6) return;
    setSubmitError(null);
    setPending(true);
    try {
      await onSubmit(method, code.trim());
    } catch (error) {
      setSubmitError(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <form className="space-y-5" onSubmit={(event) => void submit(event)} noValidate>
      <p className="text-sm text-[var(--color-text-muted)]">{translate(locale, "mfa.challenge")}</p>
      {methods.length > 1 && (
        <fieldset disabled={pending} className="space-y-2">
          <legend className="text-sm font-medium text-[var(--color-text)]">
            {translate(locale, "mfa.method")}
          </legend>
          {methods.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mfa-method"
                value={value}
                checked={method === value}
                onChange={() => setMethod(value)}
              />
              {translate(locale, value === "totp" ? "mfa.totp" : "mfa.backup")}
            </label>
          ))}
        </fieldset>
      )}
      <label className="grid gap-1.5 text-sm font-medium text-[var(--color-text)]">
        {translate(locale, method === "totp" ? "mfa.code" : "mfa.backupCode")}
        <input
          className="control w-full"
          autoComplete="one-time-code"
          autoCapitalize="none"
          inputMode={method === "totp" ? "numeric" : "text"}
          spellCheck={false}
          disabled={pending}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <FormError locale={locale} error={submitError} />
      <Button fullWidth disabled={pending || code.trim().length < 6} type="submit">
        {pending ? (
          <ProgressState locale={locale} label={translate(locale, "mfa.pending")} />
        ) : (
          translate(locale, "mfa.verify")
        )}
      </Button>
    </form>
  );
}

export function MfaSetupForm({
  locale,
  onSetup,
  onVerify,
}: {
  locale: AppLocale;
  onSetup: (password: string) => Promise<{
    totpURI: string;
    secret: string;
    backupCodes: string[];
  }>;
  onVerify: (code: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof onSetup>> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (!setup) setSetup(await onSetup(password));
      else await onVerify(code.trim());
    } catch (submitError) {
      setError(submitError);
    } finally {
      setPending(false);
    }
  };
  return (
    <form className="space-y-5" onSubmit={(event) => void submit(event)} noValidate>
      {!setup ? (
        <label className="grid gap-1.5 text-sm font-medium text-[var(--color-text)]">
          {translate(locale, "auth.password")}
          <input
            className="control w-full"
            type="password"
            autoComplete="current-password"
            disabled={pending}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      ) : (
        <>
          <p className="text-sm text-[var(--color-text-muted)]">
            {translate(locale, "mfa.setupInstructions")}
          </p>
          <label className="grid gap-1.5 text-sm font-medium text-[var(--color-text)]">
            {translate(locale, "mfa.secret")}
            <input className="control w-full font-mono" readOnly value={setup.secret} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-[var(--color-text)]">
            {translate(locale, "mfa.uri")}
            <textarea
              className="control min-h-24 w-full font-mono text-xs"
              readOnly
              value={setup.totpURI}
            />
          </label>
          <div className="rounded-lg border border-[var(--color-border)] p-3">
            <p className="text-sm font-medium">{translate(locale, "mfa.backupCodes")}</p>
            <p className="mt-2 break-words font-mono text-xs">{setup.backupCodes.join(" · ")}</p>
          </div>
          <label className="grid gap-1.5 text-sm font-medium text-[var(--color-text)]">
            {translate(locale, "mfa.code")}
            <input
              className="control w-full"
              autoComplete="one-time-code"
              inputMode="numeric"
              disabled={pending}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
        </>
      )}
      <FormError locale={locale} error={error} />
      <Button
        fullWidth
        disabled={pending || (!setup ? password.length < 12 : code.trim().length < 6)}
        type="submit"
      >
        {pending ? (
          <ProgressState locale={locale} label={translate(locale, "mfa.pending")} />
        ) : (
          translate(locale, setup ? "mfa.verify" : "mfa.startSetup")
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
            className="flex min-h-12 items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 text-sm font-medium text-[var(--color-text)] has-[:checked]:border-[var(--color-accent-border)] has-[:checked]:bg-[var(--color-accent-subtle)] has-[:checked]:text-[var(--color-accent-active)]"
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
      <Button fullWidth disabled={pending} type="submit" aria-busy={pending || undefined}>
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

type SuggestedField = "currency" | "timeZone";

const customCountryValue = "custom";

const countryOptions = [
  {
    code: "KZ",
    currency: "KZT",
    timeZone: "Asia/Almaty",
    name: { en: "Kazakhstan", ru: "Казахстан" },
  },
  {
    code: "RU",
    currency: "RUB",
    timeZone: "Europe/Moscow",
    name: { en: "Russia", ru: "Россия" },
  },
  {
    code: "US",
    currency: "USD",
    timeZone: "America/New_York",
    name: { en: "United States", ru: "США" },
  },
  {
    code: "GB",
    currency: "GBP",
    timeZone: "Europe/London",
    name: { en: "United Kingdom", ru: "Великобритания" },
  },
  {
    code: "BE",
    currency: "EUR",
    timeZone: "Europe/Brussels",
    name: { en: "Belgium", ru: "Бельгия" },
  },
  {
    code: "DE",
    currency: "EUR",
    timeZone: "Europe/Berlin",
    name: { en: "Germany", ru: "Германия" },
  },
  {
    code: "NL",
    currency: "EUR",
    timeZone: "Europe/Amsterdam",
    name: { en: "Netherlands", ru: "Нидерланды" },
  },
  {
    code: "DK",
    currency: "DKK",
    timeZone: "Europe/Copenhagen",
    name: { en: "Denmark", ru: "Дания" },
  },
  {
    code: "ES",
    currency: "EUR",
    timeZone: "Europe/Madrid",
    name: { en: "Spain", ru: "Испания" },
  },
] as const;

const countrySuggestions: Record<string, Record<SuggestedField, string>> = Object.fromEntries(
  countryOptions.map(({ code, currency, timeZone }) => [code, { currency, timeZone }]),
);

export function OnboardingForm({
  locale,
  onSubmit,
}: {
  locale: AppLocale;
  onSubmit: (value: OnboardingFormValues) => Promise<void>;
}) {
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [isCustomCountry, setIsCustomCountry] = useState(false);
  const autoSuggestedFields = useRef<Set<SuggestedField>>(
    new Set(defaultValues.timeZone ? ["timeZone"] : []),
  );
  const manualFields = useRef<Set<SuggestedField>>(new Set());
  const form = useForm({
    defaultValues,
    validators: { onSubmit: validateOnboarding(locale) },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await onSubmit(value);
      } catch (error) {
        setSubmitError(error);
      }
    },
  });

  const applyCountrySuggestion = (country: string) => {
    const suggestion = countrySuggestions[country];
    const nextAutoSuggestedFields = new Set(autoSuggestedFields.current);
    for (const fieldName of ["currency", "timeZone"] as const) {
      const currentValue = form.state.values[fieldName];
      if (!suggestion) {
        if (!manualFields.current.has(fieldName) && nextAutoSuggestedFields.has(fieldName)) {
          form.setFieldValue(fieldName, "");
        }
        nextAutoSuggestedFields.delete(fieldName);
        continue;
      }
      if (manualFields.current.has(fieldName)) {
        nextAutoSuggestedFields.delete(fieldName);
      } else if (!currentValue.trim() || nextAutoSuggestedFields.has(fieldName)) {
        form.setFieldValue(fieldName, suggestion[fieldName]);
        nextAutoSuggestedFields.add(fieldName);
      } else {
        nextAutoSuggestedFields.delete(fieldName);
      }
    }
    autoSuggestedFields.current = nextAutoSuggestedFields;
  };

  const updateSuggestedField = (fieldName: SuggestedField, value: string) => {
    // This handler is only used by real user input; programmatic suggestions call
    // `setFieldValue` directly. Even entering the same text as a suggestion is
    // therefore a manual override and must be preserved on the next country change.
    autoSuggestedFields.current.delete(fieldName);
    manualFields.current.add(fieldName);
    form.setFieldValue(fieldName, value);
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
                <label className="grid gap-1 text-sm font-medium text-[var(--color-text)]">
                  {translate(locale, "onboarding.networkName")}
                  <input
                    className="control w-full"
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value ?? ""}
                  />
                  <ValidationMessage errors={field.state.meta.errors} />
                </label>
              )}
            </form.Field>
            <form.Field name="ownerName">
              {(field) => (
                <label className="grid gap-1 text-sm font-medium text-[var(--color-text)]">
                  {translate(locale, "onboarding.ownerName")}
                  <input
                    className="control w-full"
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value ?? ""}
                  />
                  <ValidationMessage errors={field.state.meta.errors} />
                </label>
              )}
            </form.Field>
            <form.Field name="locations" mode="array">
              {(locationsField) => (
                <>
                  <label className="grid gap-1 text-sm font-medium text-[var(--color-text)]">
                    {translate(locale, "onboarding.locationCount")}
                    <select
                      className="control w-full"
                      onChange={(event) => {
                        const count = Number(event.target.value);
                        const currentCount = locationsField.state.value.length;

                        if (count > currentCount) {
                          for (let index = currentCount; index < count; index += 1) {
                            locationsField.pushValue({ name: "" });
                          }
                        } else {
                          for (let index = currentCount; index > count; index -= 1) {
                            locationsField.removeValue(index - 1);
                          }
                        }
                      }}
                      value={locationsField.state.value.length}
                    >
                      {[1, 2, 3, 4, 5].map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>
                  </label>
                  {locationsField.state.value.slice(0, 5).map((_, index) => {
                    const fieldName = locationFieldNames[index]!;
                    return (
                      <form.Field key={fieldName} name={fieldName}>
                        {(field) => (
                          <label className="grid gap-1 text-sm font-medium text-[var(--color-text)]">
                            {translate(locale, "onboarding.locationName", { number: index + 1 })}
                            <input
                              className="control w-full"
                              name={field.name}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value)}
                              value={field.state.value ?? ""}
                            />
                            <ValidationMessage errors={field.state.meta.errors} />
                          </label>
                        )}
                      </form.Field>
                    );
                  })}
                </>
              )}
            </form.Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <form.Field name="country">
                {(field) => {
                  const updateCountry = (country: string) => {
                    field.handleChange(country);
                    applyCountrySuggestion(country);
                  };

                  return (
                    <div className="grid gap-1 text-sm font-medium text-[var(--color-text)]">
                      <label className="grid gap-1">
                        {translate(locale, "onboarding.country")}
                        <select
                          className="control w-full"
                          name={`${field.name}-selection`}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            const value = event.target.value;
                            const custom = value === customCountryValue;
                            setIsCustomCountry(custom);
                            updateCountry(custom ? "" : value);
                          }}
                          value={isCustomCountry ? customCountryValue : (field.state.value ?? "")}
                        >
                          <option disabled value="">
                            {translate(locale, "onboarding.countryPlaceholder")}
                          </option>
                          {countryOptions.map((country) => (
                            <option key={country.code} value={country.code}>
                              {country.name[locale]}
                            </option>
                          ))}
                          <option value={customCountryValue}>
                            {translate(locale, "onboarding.otherCountry")}
                          </option>
                        </select>
                      </label>
                      {isCustomCountry && (
                        <>
                          <label className="grid gap-1">
                            {translate(locale, "onboarding.countryCode")}
                            <input
                              aria-describedby={`${field.name}-hint`}
                              className="control w-full uppercase"
                              maxLength={2}
                              name={field.name}
                              onBlur={field.handleBlur}
                              onChange={(event) => updateCountry(event.target.value.toUpperCase())}
                              value={field.state.value ?? ""}
                            />
                          </label>
                          <span
                            id={`${field.name}-hint`}
                            className="text-xs font-normal text-[var(--color-text-muted)]"
                          >
                            {translate(locale, "onboarding.countryHint")}
                          </span>
                        </>
                      )}
                      <ValidationMessage errors={field.state.meta.errors} />
                    </div>
                  );
                }}
              </form.Field>
              <form.Field name="currency">
                {(field) => (
                  <label className="grid gap-1 text-sm font-medium text-[var(--color-text)]">
                    {translate(locale, "onboarding.currency")}
                    <input
                      className="control w-full uppercase"
                      maxLength={3}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        updateSuggestedField("currency", event.target.value.toUpperCase())
                      }
                      value={field.state.value ?? ""}
                    />
                    <ValidationMessage errors={field.state.meta.errors} />
                  </label>
                )}
              </form.Field>
            </div>
            <form.Field name="timeZone">
              {(field) => (
                <label className="grid gap-1 text-sm font-medium text-[var(--color-text)]">
                  {translate(locale, "onboarding.timeZone")}
                  <input
                    className="control w-full"
                    list="time-zone-options"
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => updateSuggestedField("timeZone", event.target.value)}
                    value={field.state.value ?? ""}
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
            <Button fullWidth type="submit" aria-busy={pending || undefined}>
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
