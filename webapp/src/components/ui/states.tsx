import type { ReactNode } from "react";
import type { Profile } from "@brew-dashboard/contracts";
import { AlertCircle, Inbox, LoaderCircle } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import {
  errorTranslationKey,
  formatDate,
  localeFromProfile,
  translate,
  type AppLocale,
} from "@/lib/i18n";
import { ApiClientError } from "@/api/client";

export function LoadingState({ locale }: { locale: AppLocale }) {
  return (
    <div
      aria-live="polite"
      className="min-h-40 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6 text-[var(--color-text-secondary)] shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center gap-3">
        <LoaderCircle
          className="size-5 animate-spin text-[var(--color-accent)] motion-reduce:animate-none"
          aria-hidden="true"
        />
        {translate(locale, "states.loading")}
      </div>
      <div className="mt-5 grid gap-3" aria-hidden="true">
        <Skeleton variant="textLong" />
        <Skeleton variant="textShort" />
      </div>
    </div>
  );
}

const skeletonVariants = {
  textLong: "h-4 w-3/4",
  textShort: "h-4 w-1/2",
  pageTitle: "h-9 w-56 max-w-full",
  pageTitleCompact: "h-9 w-40 max-w-full",
  pageTitleNarrow: "h-9 w-36 max-w-full",
  pageDescription: "h-5 w-96 max-w-full",
  filterBar: "h-24 w-full",
  metricCard: "h-36 w-full",
  locationCard: "h-64 w-full",
  chart: "h-80 w-full",
  panel: "h-56 w-full",
  productMatrix: "h-96 w-full",
  productList: "h-72 w-full",
} as const;

export function Skeleton({ variant }: { variant: keyof typeof skeletonVariants }) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--color-surface-inset)] motion-reduce:animate-none ${skeletonVariants[variant]}`}
      aria-hidden="true"
    />
  );
}

export function ProgressState({ locale, label }: { locale: AppLocale; label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-current" role="status" aria-live="polite">
      <LoaderCircle
        className="size-4 animate-spin text-current motion-reduce:animate-none"
        aria-hidden="true"
      />
      {label ?? translate(locale, "states.loading")}
    </div>
  );
}

export function PendingButton({
  pending,
  pendingLabel,
  children,
  disabled,
  ...props
}: ButtonProps & { pending: boolean; pendingLabel: string }) {
  return (
    <Button disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending ? <ProgressState locale="en" label={pendingLabel} /> : children}
    </Button>
  );
}

export function FormError({ locale, error }: { locale: AppLocale; error?: unknown }) {
  if (!error) return null;
  const apiError = error instanceof ApiClientError ? error : undefined;
  return (
    <div role="alert" className="space-y-1 text-sm text-[var(--color-danger)]">
      <p>{translate(locale, errorTranslationKey(apiError?.code))}</p>
      {apiError?.requestId && (
        <p>{translate(locale, "errors.requestId", { requestId: apiError.requestId })}</p>
      )}
    </div>
  );
}

export function ConflictState({
  locale,
  message,
  error,
  children,
}: {
  locale: AppLocale;
  message: ReactNode;
  error?: unknown;
  children?: ReactNode;
}) {
  const apiError = error instanceof ApiClientError ? error : undefined;
  return (
    <div
      role="alert"
      className="rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-surface)] p-3 text-sm text-[var(--color-warning)]"
    >
      <p>{message}</p>
      {apiError?.requestId && (
        <p className="mt-1">
          {translate(locale, "errors.requestId", { requestId: apiError.requestId })}
        </p>
      )}
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function EmptyState({ locale, children }: { locale: AppLocale; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] p-8 text-center text-[var(--color-text-secondary)]">
      <Inbox className="mx-auto mb-3 size-6 text-[var(--color-text-muted)]" aria-hidden="true" />
      <p>{children ?? translate(locale, "states.empty")}</p>
    </div>
  );
}

export function ErrorState({
  locale,
  error,
  onRetry,
}: {
  locale: AppLocale;
  error: unknown;
  onRetry?: () => void;
}) {
  const apiError = error instanceof ApiClientError ? error : undefined;
  return (
    <div
      role="alert"
      className="rounded-xl border border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] p-5 text-[var(--color-danger)]"
    >
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="space-y-3">
          <p>{translate(locale, errorTranslationKey(apiError?.code))}</p>
          {apiError?.requestId && (
            <p className="text-sm text-[var(--color-danger)]">
              {translate(locale, "errors.requestId", { requestId: apiError.requestId })}
            </p>
          )}
          {onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {translate(locale, "actions.retry")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CachedSnapshotWarning({
  profile,
  error,
  asOf,
  onRetry,
}: {
  profile: Profile;
  error: unknown;
  asOf: string;
  onRetry: () => void;
}) {
  const locale = localeFromProfile(profile);
  const apiError = error instanceof ApiClientError ? error : undefined;
  return (
    <div
      role="alert"
      className="rounded-xl border border-[var(--color-warning-border)] bg-[var(--color-warning-surface)] p-4 text-[var(--color-warning)]"
    >
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="space-y-3">
          <p>{translate(locale, "states.cachedSnapshot", { value: formatDate(asOf, profile) })}</p>
          <p className="text-sm text-[var(--color-warning)]">
            {translate(locale, errorTranslationKey(apiError?.code))}
          </p>
          {apiError?.requestId && (
            <p className="text-sm text-[var(--color-warning)]">
              {translate(locale, "errors.requestId", { requestId: apiError.requestId })}
            </p>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {translate(locale, "actions.retry")}
          </Button>
        </div>
      </div>
    </div>
  );
}
