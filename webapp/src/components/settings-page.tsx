import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Profile } from "@brew-dashboard/contracts";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { overviewQuery } from "@/api/analytics";
import { ApiClientError } from "@/api/client";
import { logout, sessionQueryKey, sessionQueryOptions } from "@/api/session";
import { saveRevenueGoal, saveSettingsLanguage } from "@/api/settings";
import { saveTourState } from "@/api/tour";
import { FeedbackForm } from "@/components/feedback";
import { ResetDemoDialog } from "@/components/reset-demo-dialog";
import { Button } from "@/components/ui/button";
import { PageHeader, Surface } from "@/components/ui/layout";
import {
  CachedSnapshotWarning,
  ConflictState,
  ErrorState,
  FormError,
  PendingButton,
  ProgressState,
} from "@/components/ui/states";
import { localeFromProfile, translate } from "@/lib/i18n";
import { recordFeedbackMutation } from "@/lib/feedback-prompt";
import { useResetDemoData } from "@/lib/reset-demo";

const normalizeGoal = (value: string) => {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{0,2})?$/u.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
};

type GoalSnapshot = {
  expectedVersion: number | null;
  expectedDemoDataRevision: number;
};

type GoalMutationInput = {
  monthlyGoal: string;
  snapshot: GoalSnapshot;
};

export function SettingsPage({
  onTourStarted,
  onLoggedOut,
}: {
  onTourStarted: () => Promise<void>;
  onLoggedOut: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  const overview = useQuery({
    ...overviewQuery(profile?.networkId ?? "pending", { period: "today" }),
    enabled: Boolean(profile),
  });
  const [goal, setGoal] = useState("");
  const [goalDirty, setGoalDirty] = useState(false);
  const [goalSnapshot, setGoalSnapshot] = useState<GoalSnapshot | null>(null);
  const [goalRefreshError, setGoalRefreshError] = useState<unknown>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const goalKey = useRef<string | null>(null);
  const currentGoal = overview.data?.data.goal ?? null;

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
      await onTourStarted();
    },
  });

  const goalMutation = useMutation({
    mutationFn: ({ monthlyGoal, snapshot }: GoalMutationInput) => {
      if (!profile) throw new Error("Profile is unavailable");
      goalKey.current ??= crypto.randomUUID();
      return saveRevenueGoal({
        monthlyGoal,
        expectedVersion: snapshot.expectedVersion,
        expectedDemoDataRevision: snapshot.expectedDemoDataRevision,
        idempotencyKey: goalKey.current,
      });
    },
    onSuccess: async (response) => {
      goalKey.current = null;
      setGoal(response.data.monthlyGoal ?? "0.00");
      setGoalSnapshot({
        expectedVersion: response.data.version,
        expectedDemoDataRevision: response.data.demoDataRevision,
      });
      if (profile) recordFeedbackMutation(profile.networkId);
      await queryClient.invalidateQueries({ queryKey: ["tenant", profile?.networkId, "overview"] });
      setGoalDirty(false);
      toast.success(translate(locale, "settings.goalSaved"));
    },
  });

  const reset = useResetDemoData(locale, () => {
    goalKey.current = null;
    goalMutation.reset();
    setGoalDirty(false);
    setGoalSnapshot(null);
    setGoalRefreshError(null);
    setResetOpen(false);
  });

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      await onLoggedOut();
    },
  });

  const serverGoal = currentGoal?.target ?? "0.00";
  const displayedGoal = goalDirty ? goal : serverGoal;
  const normalizedGoal = normalizeGoal(displayedGoal);
  const goalChanged = goalDirty && normalizedGoal !== serverGoal;
  const goalConflict =
    goalMutation.error instanceof ApiClientError && goalMutation.error.code === "CONFLICT";
  const goalRevision = overview.data?.meta.demoDataRevision;
  const serverSnapshot: GoalSnapshot | null =
    overview.data && goalRevision !== undefined
      ? {
          expectedVersion: currentGoal?.version ?? null,
          expectedDemoDataRevision: goalRevision,
        }
      : null;
  const mutationDisabled = overview.isLoadingError || overview.isRefetchError;
  const goalUnavailable = !serverSnapshot || mutationDisabled;
  const goalError = goalRefreshError ?? (overview.isLoadingError ? overview.error : null);

  if (!profile) return null;

  const refreshGoal = async (mode: "latest" | "overwrite") => {
    setGoalRefreshError(null);
    const latest = await overview.refetch();
    if (!latest.isSuccess || !latest.data || latest.data.meta.demoDataRevision === undefined) {
      setGoalRefreshError(latest.error ?? new Error("Unable to refresh revenue goal"));
      return;
    }
    const latestGoal = latest.data.data.goal;
    const snapshot: GoalSnapshot = {
      expectedVersion: latestGoal?.version ?? null,
      expectedDemoDataRevision: latest.data.meta.demoDataRevision,
    };
    setGoalSnapshot(snapshot);
    goalKey.current = null;
    goalMutation.reset();
    if (mode === "latest") {
      setGoal(latestGoal?.target ?? "0.00");
      setGoalDirty(false);
      return;
    }
    if (!normalizedGoal) return;
    goalMutation.mutate({ monthlyGoal: normalizedGoal, snapshot });
  };

  return (
    <section
      className="max-w-[var(--container-reading)] space-y-6"
      aria-labelledby="settings-title"
      data-testid="page-settings"
    >
      <PageHeader
        id="settings-title"
        title={translate(locale, "navigation.settings")}
        description={translate(locale, "settings.description")}
      />

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
          <label className="grid max-w-sm gap-1 text-sm font-medium text-[var(--color-text-secondary)]">
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

          {overview.isPending && <ProgressState locale={locale} />}
          {overview.isRefetchError && overview.data && (
            <CachedSnapshotWarning
              profile={profile}
              error={overview.error}
              asOf={overview.data.meta.asOf}
              onRetry={() => void overview.refetch()}
            />
          )}
          {goalError && (
            <ErrorState
              locale={locale}
              error={goalError}
              onRetry={() => void refreshGoal("latest")}
            />
          )}

          <form
            className="max-w-sm space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const snapshot = goalSnapshot ?? serverSnapshot;
              if (normalizedGoal && snapshot && !goalConflict && goalChanged)
                goalMutation.mutate({ monthlyGoal: normalizedGoal, snapshot });
            }}
          >
            <label className="grid gap-1 text-sm font-medium text-[var(--color-text-secondary)]">
              {translate(locale, "settings.monthlyGoal")}
              <input
                className="control"
                inputMode="decimal"
                value={displayedGoal}
                disabled={goalMutation.isPending || goalUnavailable}
                onChange={(event) => {
                  goalKey.current = null;
                  goalMutation.reset();
                  setGoalRefreshError(null);
                  setGoalSnapshot(serverSnapshot);
                  setGoalDirty(true);
                  setGoal(event.target.value);
                }}
                aria-invalid={!normalizedGoal || undefined}
              />
            </label>
            <p className="text-xs text-[var(--color-text-muted)]">
              {translate(locale, "settings.goalHint")}
            </p>
            {!normalizedGoal && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {translate(locale, "errors.validation")}
              </p>
            )}
            {!goalConflict && <FormError locale={locale} error={goalMutation.error} />}
            {goalConflict && (
              <ConflictState
                locale={locale}
                error={goalMutation.error}
                message={translate(locale, "settings.goalConflict")}
              >
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={mutationDisabled}
                  onClick={() => void refreshGoal("latest")}
                >
                  {translate(locale, "actions.useLatest")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={mutationDisabled || !normalizedGoal || goalMutation.isPending}
                  onClick={() => void refreshGoal("overwrite")}
                >
                  {translate(locale, "actions.overwrite")}
                </Button>
              </ConflictState>
            )}
            <PendingButton
              type="submit"
              pending={goalMutation.isPending}
              pendingLabel={translate(locale, "settings.goalPending")}
              disabled={!normalizedGoal || !goalChanged || goalConflict || goalUnavailable}
            >
              {translate(locale, "settings.saveGoal")}
            </PendingButton>
          </form>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {translate(locale, "tour.title")}
            </h3>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
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
        <p className="text-sm text-[var(--color-text-muted)]">
          {translate(locale, "settings.demoDescription")}
        </p>
        <div className="mt-4">
          <Button type="button" disabled={mutationDisabled} onClick={() => setResetOpen(true)}>
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
        disabled={mutationDisabled}
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
    <Surface label={title}>
      <h2 className="text-lg font-semibold text-[var(--color-text)]">{title}</h2>
      {description && (
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </Surface>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 font-medium text-[var(--color-text)]">{value ?? "—"}</dd>
    </div>
  );
}
