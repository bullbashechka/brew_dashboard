import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { Profile } from "@brew-dashboard/contracts";

import { completeOnboarding, login, saveOnboardingLanguage } from "@/api/first-run";
import { startMfaSetup, verifyMfa } from "@/api/mfa";
import { profileFromAuthState, sessionQueryKey, type AuthState } from "@/api/session";
import {
  LanguageForm,
  LoginForm,
  MfaChallengeForm,
  MfaSetupForm,
  OnboardingForm,
} from "@/components/first-run-forms";
import { FirstRunPage } from "@/components/first-run-page";
import { localeFromProfile, translate } from "@/lib/i18n";

const nextDestination = (profile: Profile) => {
  if (!profile.language) return { to: "/first-run/language" as const };
  if (!profile.onboardingCompletedAt) return { to: "/first-run/onboarding" as const };
  return { to: "/app/overview" as const, search: { period: "today" as const } };
};

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = useRouterState({
    select: (state) => state.location.search as { redirect?: unknown },
  });
  const locale = "en" as const;
  const [mfaMethods, setMfaMethods] = useState<("totp" | "backup")[] | null>(null);
  if (mfaMethods) {
    return (
      <FirstRunPage
        locale={locale}
        title={translate(locale, "mfa.title")}
        description={translate(locale, "mfa.challenge")}
      >
        <MfaChallengeForm
          locale={locale}
          methods={mfaMethods}
          onSubmit={async (method, code) => {
            const response = await verifyMfa(method, code);
            const profile = response.data.profile;
            queryClient.setQueryData(sessionQueryKey, profile);
            setMfaMethods(null);
            await navigate(nextDestination(profile));
          }}
        />
      </FirstRunPage>
    );
  }
  return (
    <FirstRunPage
      locale={locale}
      title={translate(locale, "public.signIn")}
      description={translate(locale, "states.signIn")}
    >
      <LoginForm
        locale={locale}
        onSubmit={async (values) => {
          const response = await login(values);
          if ("mfaRequired" in response.data) {
            setMfaMethods(response.data.methods);
            return;
          }
          if ("mfaSetupRequired" in response.data) {
            queryClient.setQueryData(sessionQueryKey, response.data);
            await navigate({ to: "/mfa/setup", replace: true });
            return;
          }
          const profile = response.data.profile;
          queryClient.setQueryData(sessionQueryKey, profile);
          const destination = nextDestination(profile);
          if (
            destination.to === "/app/overview" &&
            typeof search.redirect === "string" &&
            search.redirect.startsWith("/app/")
          ) {
            window.location.assign(search.redirect);
            return;
          }
          await navigate(destination);
        }}
      />
    </FirstRunPage>
  );
}

export function MfaSetupPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const profile = profileFromAuthState(
    queryClient.getQueryData<AuthState>(sessionQueryKey) ?? null,
  );
  const locale = localeFromProfile(profile);
  return (
    <FirstRunPage
      locale={locale}
      title={translate(locale, "mfa.title")}
      description={translate(locale, "mfa.setupInstructions")}
    >
      <MfaSetupForm
        locale={locale}
        onSetup={async (password) => {
          const response = await startMfaSetup(password);
          return response.data;
        }}
        onVerify={async (code) => {
          const response = await verifyMfa("totp", code);
          queryClient.setQueryData(sessionQueryKey, response.data.profile);
          await navigate({ ...nextDestination(response.data.profile), replace: true });
        }}
      />
    </FirstRunPage>
  );
}

export function LanguagePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const locale = localeFromProfile(queryClient.getQueryData<Profile | null>(sessionQueryKey));
  return (
    <FirstRunPage
      locale={locale}
      title={translate(locale, "language.title")}
      description={translate(locale, "language.description")}
    >
      <LanguageForm
        locale={locale}
        onSubmit={async (language) => {
          const response = await saveOnboardingLanguage(language);
          const currentProfile = queryClient.getQueryData<Profile | null>(sessionQueryKey);
          if (!currentProfile) throw new Error("Session profile is unavailable");
          queryClient.setQueryData(sessionQueryKey, {
            ...currentProfile,
            language: response.data.language,
            effectiveLanguage: response.data.effectiveLanguage,
          });
          await navigate({ to: "/first-run/onboarding", replace: true });
        }}
      />
    </FirstRunPage>
  );
}

export function OnboardingPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const profile = queryClient.getQueryData<Profile | null>(sessionQueryKey);
  const locale = localeFromProfile(profile);
  return (
    <FirstRunPage
      locale={locale}
      title={translate(locale, "onboarding.title")}
      description={translate(locale, "onboarding.description")}
    >
      <OnboardingForm
        locale={locale}
        onSubmit={async (values) => {
          const response = await completeOnboarding(values);
          queryClient.setQueryData(sessionQueryKey, response.data.profile);
          await navigate({
            to: "/app/overview",
            search: { period: "today", locationId: undefined },
            replace: true,
          });
        }}
      />
    </FirstRunPage>
  );
}
