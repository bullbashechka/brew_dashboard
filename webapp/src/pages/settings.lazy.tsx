import { createLazyRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { Profile } from "@brew-dashboard/contracts";
import { useState } from "react";

import { saveTourState } from "@/api/tour";
import { sessionQueryKey, sessionQueryOptions } from "@/api/session";
import { EmptyState, ErrorState, PendingButton } from "@/components/ui/states";
import { localeFromProfile, translate } from "@/lib/i18n";

export const Route = createLazyRoute("/app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/app/settings" });
  const search = useRouterState({
    select: (state) =>
      state.location.search as { panel?: string; period?: string; locationId?: string },
  });
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const restartTour = async () => {
    setError(null);
    setPending(true);
    try {
      const response = await saveTourState("pending");
      queryClient.setQueryData<Profile | null>(sessionQueryKey, (current) =>
        current ? { ...current, tourState: response.data.state } : current,
      );
      await navigate({
        to: "/app/overview",
        search: {
          period:
            search.period === "7d" || search.period === "30d" || search.period === "6m"
              ? search.period
              : "today",
          locationId: search.locationId,
        },
      });
    } catch (nextError) {
      setError(nextError);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="settings-title" data-testid="page-settings">
      <div className="space-y-2">
        <h1 id="settings-title" className="text-3xl font-semibold tracking-tight text-stone-950">
          {translate(locale, "navigation.settings")}
        </h1>
        <p className="text-stone-600">{translate(locale, "states.foundation")}</p>
      </div>
      <section
        className="rounded-xl border border-stone-200 bg-white p-5"
        aria-labelledby="tour-settings-title"
      >
        <h2 id="tour-settings-title" className="text-lg font-semibold text-stone-950">
          {translate(locale, "tour.title")}
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          {translate(locale, "tour.restartDescription")}
        </p>
        <div className="mt-4">
          <PendingButton
            pending={pending}
            pendingLabel={translate(locale, "tour.restartPending")}
            onClick={() => void restartTour()}
          >
            {translate(locale, "tour.restart")}
          </PendingButton>
        </div>
        {Boolean(error) && (
          <div className="mt-4">
            <ErrorState locale={locale} error={error} />
          </div>
        )}
      </section>
      {search.panel === "feedback" && (
        <EmptyState locale={locale}>{translate(locale, "states.feedbackLater")}</EmptyState>
      )}
    </section>
  );
}
