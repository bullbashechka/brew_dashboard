import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InventoryData, Profile } from "@brew-dashboard/contracts";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  createInventoryMovement,
  inventoryInfiniteQuery,
  type AnalyticsFilters,
  type InventoryFilters,
} from "@/api/analytics";
import { ApiClientError } from "@/api/client";
import { sessionQueryOptions } from "@/api/session";
import { InventoryMovementDialog } from "@/components/inventory-movement-dialog";
import { recordFeedbackMutation } from "@/lib/feedback-prompt";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { Badge } from "@/components/ui/badge";
import { CachedSnapshotWarning, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import {
  formatDate,
  formatNumber,
  localeFromProfile,
  translate,
  type TranslationKey,
} from "@/lib/i18n";

const statuses = ["in_stock", "low_stock", "out_of_stock"] as const;

type Balance = InventoryData["balances"][number];
type MovementTarget = {
  balance: Balance;
  type: "receipt" | "writeoff";
  demoDataRevision: number;
  conflictState: "ready" | "refresh_failed" | "unavailable";
};

export function InventoryPage({
  filters,
  status,
  onStatusChange,
}: {
  filters: AnalyticsFilters;
  status?: InventoryFilters["status"];
  onStatusChange: (status?: InventoryFilters["status"]) => void;
}) {
  const queryClient = useQueryClient();
  const { data: profile } = useQuery(sessionQueryOptions());
  const inventoryFilters: InventoryFilters = {
    ...filters,
    ...(status ? { status } : {}),
  };
  const analytics = useInfiniteQuery({
    ...inventoryInfiniteQuery(profile?.networkId ?? "pending", inventoryFilters),
    enabled: Boolean(profile),
  });
  const locale = localeFromProfile(profile);
  const [target, setTarget] = useState<MovementTarget | null>(null);
  const refreshConflictTarget = async () => {
    if (!profile || !target) return;
    const currentTarget = target;
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenant", profile.networkId, "inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["tenant", profile.networkId, "overview"] }),
      ]);
      const latest = await queryClient.fetchInfiniteQuery(
        inventoryInfiniteQuery(profile.networkId, filters),
      );
      const balance = latest.pages[0]?.data.balances.find(
        (candidate) =>
          candidate.inventoryItemId === currentTarget.balance.inventoryItemId &&
          candidate.locationId === currentTarget.balance.locationId,
      );
      const demoDataRevision = latest.pages[0]?.meta.demoDataRevision;
      setTarget((current) => {
        if (current !== currentTarget) return current;
        return {
          ...current,
          ...(balance ? { balance } : {}),
          ...(demoDataRevision ? { demoDataRevision } : {}),
          conflictState: balance ? "ready" : "unavailable",
        };
      });
    } catch {
      setTarget((current) =>
        current === currentTarget ? { ...current, conflictState: "refresh_failed" } : current,
      );
    }
  };
  const movement = useMutation({
    mutationFn: createInventoryMovement,
    onSuccess: async (response) => {
      if (profile) {
        recordFeedbackMutation(profile.networkId);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["tenant", profile.networkId, "inventory"] }),
          queryClient.invalidateQueries({ queryKey: ["tenant", profile.networkId, "overview"] }),
        ]);
      }
      setTarget(null);
      toast.success(
        translate(
          locale,
          response.data.movement.type === "receipt"
            ? "inventory.savedReceipt"
            : "inventory.savedWriteoff",
        ),
      );
    },
    onError: async (error) => {
      if (profile && error instanceof ApiClientError && error.code === "CONFLICT") {
        await refreshConflictTarget();
      }
    },
  });
  if (!profile || analytics.isPending) return <InventorySkeleton locale={locale} />;
  if (analytics.isLoadingError || !analytics.data)
    return (
      <InventoryFrame profile={profile}>
        <ErrorState
          locale={locale}
          error={analytics.error}
          onRetry={() => void analytics.refetch()}
        />
      </InventoryFrame>
    );

  const first = analytics.data.pages[0];
  if (!first)
    return (
      <InventoryFrame profile={profile}>
        <EmptyState locale={locale} />
      </InventoryFrame>
    );
  const balances = first.data.balances;
  const movements = analytics.data.pages.flatMap((page) => page.data.movements);
  const mutationDisabled = analytics.isRefetchError;
  const openMovement = (balance: Balance, type: MovementTarget["type"]) =>
    !mutationDisabled &&
    setTarget({
      balance,
      type,
      demoDataRevision: first.meta.demoDataRevision,
      conflictState: "ready",
    });

  return (
    <InventoryFrame profile={profile} updatedAt={first.meta.asOf}>
      <section
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-card)]"
        aria-label={translate(locale, "inventory.statusFilter")}
      >
        <label className="grid max-w-xs gap-1 text-sm font-medium text-[var(--color-text-secondary)]">
          {translate(locale, "inventory.statusFilter")}
          <select
            className="control"
            value={inventoryFilters.status ?? ""}
            onChange={(event) =>
              onStatusChange(
                statuses.includes(event.target.value as (typeof statuses)[number])
                  ? (event.target.value as InventoryFilters["status"])
                  : undefined,
              )
            }
          >
            <option value="">{translate(locale, "inventory.allStatuses")}</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {translate(locale, statusKey(status))}
              </option>
            ))}
          </select>
        </label>
      </section>
      {analytics.isRefetchError && (
        <CachedSnapshotWarning
          profile={profile}
          error={analytics.error}
          asOf={first.meta.asOf}
          onRetry={() => void analytics.refetch()}
        />
      )}
      {analytics.isFetching && (
        <p className="text-sm text-[var(--color-text-muted)]" role="status">
          {translate(locale, "states.loading")}
        </p>
      )}
      {!balances.length ? (
        <EmptyState locale={locale}>{translate(locale, "inventory.noBalances")}</EmptyState>
      ) : (
        <Balances
          balances={balances}
          profile={profile}
          onOpen={openMovement}
          disabled={mutationDisabled}
        />
      )}
      <RecentMovements
        movements={movements}
        profile={profile}
        hasNext={analytics.hasNextPage}
        pending={analytics.isFetchingNextPage}
        error={analytics.isFetchNextPageError ? analytics.error : null}
        onLoadMore={() => void analytics.fetchNextPage()}
      />
      <InventoryMovementDialog
        key={
          target
            ? `${target.balance.inventoryItemId}-${target.balance.locationId}-${target.type}`
            : "none"
        }
        balance={target?.balance ?? null}
        type={target?.type ?? null}
        profile={profile}
        demoDataRevision={target?.demoDataRevision ?? first.meta.demoDataRevision}
        open={target !== null}
        pending={movement.isPending}
        disabled={mutationDisabled}
        error={movement.error}
        conflictState={target?.conflictState}
        onOpenChange={(open) => {
          if (!open && !movement.isPending) {
            movement.reset();
            setTarget(null);
          }
        }}
        onSave={(request) => movement.mutate(request)}
        onClearError={() => movement.reset()}
        onRefreshConflict={() => !mutationDisabled && void refreshConflictTarget()}
      />
    </InventoryFrame>
  );
}

function InventoryFrame({
  profile,
  updatedAt,
  children,
}: {
  profile: Profile;
  updatedAt?: string;
  children: ReactNode;
}) {
  const locale = localeFromProfile(profile);
  return (
    <section className="space-y-6" aria-labelledby="inventory-title" data-testid="page-inventory">
      <PageHeader
        id="inventory-title"
        title={translate(locale, "inventory.title")}
        description={translate(locale, "inventory.description")}
        meta={
          updatedAt
            ? translate(locale, "inventory.updatedAt", {
                value: formatDate(updatedAt, profile),
              })
            : undefined
        }
      />
      {children}
    </section>
  );
}

function Balances({
  balances,
  profile,
  onOpen,
  disabled,
}: {
  balances: Balance[];
  profile: Profile;
  onOpen: (balance: Balance, type: MovementTarget["type"]) => void;
  disabled: boolean;
}) {
  const locale = localeFromProfile(profile);
  return (
    <section className="space-y-3" aria-labelledby="inventory-balances-title">
      <h2 id="inventory-balances-title" className="text-xl font-semibold text-[var(--color-text)]">
        {translate(locale, "products.balances")}
      </h2>
      <div className="grid gap-4 md:hidden">
        {balances.map((balance) => (
          <BalanceCard
            key={`${balance.locationId}-${balance.inventoryItemId}`}
            balance={balance}
            profile={profile}
            onOpen={onOpen}
            disabled={disabled}
          />
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-card)] md:block">
        <table className="w-full min-w-[50rem] border-collapse text-left text-sm">
          <thead className="bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]">
            <tr>
              {[
                "inventory.item",
                "inventory.location",
                "inventory.onHand",
                "inventory.threshold",
                "inventory.status",
                "inventory.actions",
              ].map((key) => (
                <th key={key} className="px-4 py-3 font-semibold">
                  {translate(locale, key as TranslationKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {balances.map((balance) => (
              <tr
                key={`${balance.locationId}-${balance.inventoryItemId}`}
                className="border-t border-[var(--color-border-subtle)]"
              >
                <td className="px-4 py-3 font-medium text-[var(--color-text)]">
                  {balance.inventoryItemName}
                  <span className="ml-2 text-[var(--color-text-muted)]">{balance.unit}</span>
                </td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                  {balance.locationName}
                </td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                  {formatNumber(balance.onHand, profile)}
                </td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                  {formatNumber(balance.minThreshold, profile)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={balance.status} profile={profile} />
                </td>
                <td className="px-4 py-3">
                  <BalanceActions
                    balance={balance}
                    profile={profile}
                    onOpen={onOpen}
                    disabled={disabled}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BalanceCard({
  balance,
  profile,
  onOpen,
  disabled,
}: {
  balance: Balance;
  profile: Profile;
  onOpen: (balance: Balance, type: MovementTarget["type"]) => void;
  disabled: boolean;
}) {
  const locale = localeFromProfile(profile);
  return (
    <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[var(--color-text)]">
            {balance.inventoryItemName}
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {balance.locationName} · {balance.unit}
          </p>
        </div>
        <StatusBadge status={balance.status} profile={profile} />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-[var(--color-text-muted)]">
            {translate(locale, "inventory.onHand")}
          </dt>
          <dd className="mt-1 font-semibold text-[var(--color-text)]">
            {formatNumber(balance.onHand, profile)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-muted)]">
            {translate(locale, "inventory.threshold")}
          </dt>
          <dd className="mt-1 font-semibold text-[var(--color-text)]">
            {formatNumber(balance.minThreshold, profile)}
          </dd>
        </div>
      </dl>
      <div className="mt-5">
        <BalanceActions balance={balance} profile={profile} onOpen={onOpen} disabled={disabled} />
      </div>
    </article>
  );
}

function BalanceActions({
  balance,
  profile,
  onOpen,
  disabled,
}: {
  balance: Balance;
  profile: Profile;
  onOpen: (balance: Balance, type: MovementTarget["type"]) => void;
  disabled: boolean;
}) {
  const locale = localeFromProfile(profile);
  const open = (type: MovementTarget["type"]) => onOpen(balance, type);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        icon={ArrowUp}
        disabled={disabled}
        onClick={() => open("receipt")}
      >
        {translate(locale, "inventory.receipt")}
      </Button>
      <Button
        type="button"
        size="sm"
        icon={ArrowDown}
        disabled={disabled || balance.status === "out_of_stock"}
        onClick={() => open("writeoff")}
      >
        {translate(locale, "inventory.writeoff")}
      </Button>
    </div>
  );
}

function RecentMovements({
  movements,
  profile,
  hasNext,
  pending,
  error,
  onLoadMore,
}: {
  movements: InventoryData["movements"];
  profile: Profile;
  hasNext: boolean;
  pending: boolean;
  error: unknown;
  onLoadMore: () => void;
}) {
  const locale = localeFromProfile(profile);
  return (
    <section className="space-y-3" aria-labelledby="recent-movements-title">
      <h2 id="recent-movements-title" className="text-xl font-semibold text-[var(--color-text)]">
        {translate(locale, "inventory.recentMovements")}
      </h2>
      {!movements.length ? (
        <EmptyState locale={locale}>{translate(locale, "inventory.noMovements")}</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-card)]">
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {movements.map((movement) => (
              <article
                key={movement.movementId}
                className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
              >
                <div>
                  <p className="font-medium text-[var(--color-text)]">
                    {movement.inventoryItemName}
                  </p>
                  <p className="mt-1 text-[var(--color-text-muted)]">
                    {movement.locationName} · {formatDate(movement.occurredAt, profile)}
                  </p>
                </div>
                <p
                  className={
                    movement.type === "receipt"
                      ? "font-semibold text-[var(--color-success)]"
                      : "font-semibold text-[var(--color-danger)]"
                  }
                >
                  {movement.type === "receipt" ? "+" : "−"}
                  {formatNumber(movement.quantity, profile)} ·{" "}
                  {translate(
                    locale,
                    movement.type === "receipt" ? "inventory.receipt" : "inventory.writeoff",
                  )}
                </p>
              </article>
            ))}
          </div>
          {hasNext && (
            <div className="border-t border-[var(--color-border-subtle)] p-3">
              <Button type="button" variant="outline" disabled={pending} onClick={onLoadMore}>
                {pending
                  ? translate(locale, "states.loading")
                  : translate(locale, "actions.loadMore")}
              </Button>
              {Boolean(error) && (
                <div className="mt-3">
                  <ErrorState locale={locale} error={error} onRetry={onLoadMore} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status, profile }: { status: Balance["status"]; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const tones = {
    in_stock: "success",
    low_stock: "warning",
    out_of_stock: "danger",
  } as const;
  return <Badge tone={tones[status]}>{translate(locale, statusKey(status))}</Badge>;
}

const statusKey = (status: Balance["status"]): TranslationKey =>
  `inventory.${status === "in_stock" ? "inStock" : status === "low_stock" ? "lowStock" : "outOfStock"}`;

function InventorySkeleton({ locale }: { locale: ReturnType<typeof localeFromProfile> }) {
  return (
    <section
      className="space-y-6"
      aria-label={`${translate(locale, "states.loading")} ${translate(locale, "navigation.inventory")}`}
    >
      <div className="space-y-3">
        <Skeleton variant="pageTitleCompact" />
        <Skeleton variant="pageDescription" />
      </div>
      <Skeleton variant="filterBar" />
      <Skeleton variant="chart" />
      <Skeleton variant="panel" />
    </section>
  );
}
