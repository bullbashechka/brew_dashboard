import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { Profile } from "@brew-dashboard/contracts";

import { completeOnboarding, login, saveOnboardingLanguage } from "@/api/first-run";
import { sessionQueryKey } from "@/api/session";
import { LanguageForm, LoginForm, OnboardingForm } from "@/components/first-run-forms";
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
