/* eslint-disable react-refresh/only-export-components */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLazyRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import type { Profile } from "@brew-dashboard/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { overviewQuery } from "@/api/analytics";
import { resetDemoData } from "@/api/demo";
import { ApiClientError } from "@/api/client";
import { logout, sessionQueryKey, sessionQueryOptions } from "@/api/session";
import { saveRevenueGoal, saveSettingsLanguage } from "@/api/settings";
import { saveTourState } from "@/api/tour";
import { FeedbackForm } from "@/components/feedback";
import { ResetDemoDialog } from "@/components/reset-demo-dialog";
import { Button } from "@/components/ui/button";
import { FormError, PendingButton } from "@/components/ui/states";
import { localeFromProfile, translate } from "@/lib/i18n";
import { recordFeedbackMutation } from "@/lib/feedback-prompt";

export const Route = createLazyRoute("/app/settings")({ component: SettingsPage });

const normalizeGoal = (value: string) => {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{0,2})?$/u.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
};

function SettingsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/app/settings" });
  const search = useRouterState({
    select: (state) => state.location.search as { period?: string; locationId?: string },
  });
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  const overview = useQuery({
    ...overviewQuery(profile?.networkId ?? "pending", { period: "today" }),
    enabled: Boolean(profile),
  });
  const [goal, setGoal] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const goalKey = useRef<string | null>(null);
  const overwriteGoal = useRef(false);
  const goalVersion = useRef<number | null>(null);
  const resetKey = useRef<string | null>(null);
  const initializedGoalVersion = useRef<number | null | undefined>(undefined);
  const currentGoal = overview.data?.data.goal ?? null;

  useEffect(() => {
    if (overview.isSuccess && initializedGoalVersion.current !== (currentGoal?.version ?? null)) {
      initializedGoalVersion.current = currentGoal?.version ?? null;
      goalVersion.current = currentGoal?.version ?? null;
      setGoal(currentGoal?.target ?? "0.00");
    }
  }, [currentGoal, overview.isSuccess]);

  const language = useMutation({
    mutationFn: (nextLanguage: "en" | "ru") =>
      saveSettingsLanguage(nextLanguage, crypto.randomUUID()),
    onMutate: async (nextLanguage) => {
      const previous = queryClient.getQueryData<Profile | null>(sessionQueryKey);
      queryClient.setQueryData<Profile | null>(sessionQueryKey, (current) =>
        current ? { ...current, language: nextLanguage, effectiveLanguage: nextLanguage } : current,
      );
      return { previous };
    },
    onError: (_error, _nextLanguage, context) => {
      queryClient.setQueryData(sessionQueryKey, context?.previous ?? null);
    },
  });

  const tour = useMutation({
    mutationFn: () => saveTourState("pending"),
    onSuccess: async (response) => {
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
    },
  });

  const goalMutation = useMutation({
    mutationFn: () => {
      if (!profile) throw new Error("Profile is unavailable");
      const monthlyGoal = normalizeGoal(goal);
      if (!monthlyGoal) throw new Error("Revenue goal is invalid");
      if (overwriteGoal.current) {
        goalKey.current = null;
        overwriteGoal.current = false;
      }
      goalKey.current ??= crypto.randomUUID();
      return saveRevenueGoal({
        monthlyGoal,
        expectedVersion: goalVersion.current,
        expectedDemoDataRevision: profile.demoDataRevision,
        idempotencyKey: goalKey.current,
      });
    },
    onSuccess: async () => {
      goalKey.current = null;
      if (profile) recordFeedbackMutation(profile.networkId);
      await queryClient.invalidateQueries({ queryKey: ["tenant", profile?.networkId, "overview"] });
      toast.success(translate(locale, "settings.goalSaved"));
    },
  });

  const reset = useMutation({
    mutationFn: () => {
      resetKey.current ??= crypto.randomUUID();
      return resetDemoData(resetKey.current);
    },
    onSuccess: async (response) => {
      queryClient.setQueryData<Profile | null>(sessionQueryKey, response.data.profile);
      await queryClient.invalidateQueries({
        queryKey: ["tenant", response.data.profile.networkId],
      });
      resetKey.current = null;
      setResetOpen(false);
      toast.success(translate(locale, "reset.complete"));
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      await navigate({ to: "/login", search: { redirect: undefined }, replace: true });
    },
  });

  if (!profile) return null;
  const normalizedGoal = normalizeGoal(goal);
  const goalConflict =
    goalMutation.error instanceof ApiClientError && goalMutation.error.code === "CONFLICT";

  return (
    <section className="space-y-6" aria-labelledby="settings-title" data-testid="page-settings">
      <div className="space-y-2">
        <h1 id="settings-title" className="text-3xl font-semibold tracking-tight text-stone-950">
          {translate(locale, "navigation.settings")}
        </h1>
        <p className="text-stone-600">{translate(locale, "settings.description")}</p>
      </div>

      <SettingsCard title={translate(locale, "settings.networkTitle")}>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <ReadOnlyValue
            label={translate(locale, "settings.networkName")}
            value={profile.networkName}
          />
          <ReadOnlyValue
            label={translate(locale, "settings.ownerName")}
            value={profile.ownerName}
          />
          <ReadOnlyValue label={translate(locale, "settings.currency")} value={profile.currency} />
          <ReadOnlyValue label={translate(locale, "settings.timeZone")} value={profile.timeZone} />
        </dl>
      </SettingsCard>

      <SettingsCard title={translate(locale, "settings.preferencesTitle")}>
        <div className="space-y-6">
          <label className="grid max-w-sm gap-1 text-sm font-medium text-stone-700">
            {translate(locale, "settings.language")}
            <select
              className="control"
              value={profile.language ?? "en"}
              disabled={language.isPending}
              onChange={(event) => language.mutate(event.target.value as "en" | "ru")}
            >
              <option value="en">{translate(locale, "language.english")}</option>
              <option value="ru">{translate(locale, "language.russian")}</option>
            </select>
          </label>
          <FormError locale={locale} error={language.error} />

          <form
            className="max-w-sm space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (normalizedGoal && !goalConflict) goalMutation.mutate();
            }}
          >
            <label className="grid gap-1 text-sm font-medium text-stone-700">
              {translate(locale, "settings.monthlyGoal")}
              <input
                className="control"
                inputMode="decimal"
                value={goal}
                disabled={goalMutation.isPending || overview.isPending}
                onChange={(event) => {
                  goalKey.current = null;
                  goalMutation.reset();
                  setGoal(event.target.value);
                }}
                aria-invalid={!normalizedGoal || undefined}
              />
            </label>
            <p className="text-xs text-stone-500">{translate(locale, "settings.goalHint")}</p>
            {!normalizedGoal && (
              <p role="alert" className="text-sm text-red-800">
                {translate(locale, "errors.validation")}
              </p>
            )}
            <FormError locale={locale} error={goalMutation.error} />
            {goalConflict && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <p>{translate(locale, "settings.goalConflict")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      goalMutation.reset();
                      void overview.refetch();
                    }}
                  >
                    {translate(locale, "actions.useLatest")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!normalizedGoal}
                    onClick={() => {
                      void overview.refetch().then((latest) => {
                        goalVersion.current = latest.data?.data.goal?.version ?? null;
                        overwriteGoal.current = true;
                        goalMutation.mutate();
                      });
                    }}
                  >
                    {translate(locale, "actions.overwrite")}
                  </Button>
                </div>
              </div>
            )}
            <PendingButton
              type="submit"
              pending={goalMutation.isPending}
              pendingLabel={translate(locale, "settings.goalPending")}
              disabled={!normalizedGoal || goalConflict}
            >
              {translate(locale, "settings.saveGoal")}
            </PendingButton>
          </form>

          <div>
            <h3 className="text-sm font-semibold text-stone-950">
              {translate(locale, "tour.title")}
            </h3>
            <p className="mt-1 text-sm text-stone-600">
              {translate(locale, "tour.restartDescription")}
            </p>
            <div className="mt-3">
              <PendingButton
                pending={tour.isPending}
                pendingLabel={translate(locale, "tour.restartPending")}
                onClick={() => tour.mutate()}
              >
                {translate(locale, "tour.restart")}
              </PendingButton>
            </div>
            <div className="mt-3">
              <FormError locale={locale} error={tour.error} />
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title={translate(locale, "feedback.title")}
        description={translate(locale, "feedback.description")}
      >
        <FeedbackForm profile={profile} />
      </SettingsCard>

      <SettingsCard title={translate(locale, "settings.demoTitle")}>
        <p className="text-sm text-stone-600">{translate(locale, "settings.demoDescription")}</p>
        <div className="mt-4">
          <Button type="button" onClick={() => setResetOpen(true)}>
            {translate(locale, "reset.open")}
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard title={translate(locale, "settings.accountTitle")}>
        <PendingButton
          type="button"
          variant="outline"
          pending={logoutMutation.isPending}
          pendingLabel={translate(locale, "states.loading")}
          onClick={() => logoutMutation.mutate()}
        >
          {translate(locale, "actions.logout")}
        </PendingButton>
        <div className="mt-3">
          <FormError locale={locale} error={logoutMutation.error} />
        </div>
      </SettingsCard>

      <ResetDemoDialog
        open={resetOpen}
        onOpenChange={(open) => {
          if (!reset.isPending) setResetOpen(open);
        }}
        locale={locale}
        pending={reset.isPending}
        error={reset.error}
        onConfirm={() => reset.mutate()}
      />
    </section>
  );
}

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5" aria-label={title}>
      <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
      {description && <p className="mt-1 text-sm text-stone-600">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-stone-500">{label}</dt>
      <dd className="mt-1 font-medium text-stone-950">{value ?? "—"}</dd>
    </div>
  );
}
