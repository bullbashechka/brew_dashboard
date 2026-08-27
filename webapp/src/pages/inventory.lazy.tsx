/* eslint-disable react-refresh/only-export-components */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLazyRoute, useNavigate } from "@tanstack/react-router";
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
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
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

export const Route = createLazyRoute("/app/inventory")({ component: InventoryPage });

function InventoryPage() {
  const navigate = useNavigate({ from: "/app/inventory" });
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const { data: profile } = useQuery(sessionQueryOptions());
  const filters: AnalyticsFilters = {
    period: search.period,
    ...(typeof search.locationId === "string" ? { locationId: search.locationId } : {}),
  };
  const inventoryFilters: InventoryFilters = {
    ...filters,
    ...(search.status ? { status: search.status } : {}),
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
    setTarget((current) =>
      current === currentTarget ? { ...current, conflictState: "refresh_failed" } : current,
    );
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
  const updateStatus = (status: InventoryFilters["status"]) => {
    void navigate({
      to: "/app/inventory",
      search: { period: filters.period, locationId: filters.locationId, status },
      replace: true,
    });
  };

  if (!profile || analytics.isPending) return <InventorySkeleton />;
  if (analytics.isError || !analytics.data)
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
  const openMovement = (balance: Balance, type: MovementTarget["type"]) =>
    setTarget({
      balance,
      type,
      demoDataRevision: first.meta.demoDataRevision,
      conflictState: "ready",
    });

  return (
    <InventoryFrame profile={profile} updatedAt={first.meta.asOf}>
      <section
        className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
        aria-label={translate(locale, "inventory.statusFilter")}
      >
        <label className="grid max-w-xs gap-1 text-sm font-medium text-stone-700">
          {translate(locale, "inventory.statusFilter")}
          <select
            className="control"
            value={inventoryFilters.status ?? ""}
            onChange={(event) =>
              updateStatus(
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
      {analytics.isFetching && (
        <p className="text-sm text-stone-600" role="status">
          {translate(locale, "states.loading")}
        </p>
      )}
      {!balances.length ? (
        <EmptyState locale={locale}>{translate(locale, "inventory.noBalances")}</EmptyState>
      ) : (
        <Balances balances={balances} profile={profile} onOpen={openMovement} />
      )}
      <RecentMovements
        movements={movements}
        profile={profile}
        hasNext={analytics.hasNextPage}
        pending={analytics.isFetchingNextPage}
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
        onRefreshConflict={() => void refreshConflictTarget()}
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
      <div className="space-y-2">
        <h1 id="inventory-title" className="text-3xl font-semibold tracking-tight text-stone-950">
          {translate(locale, "inventory.title")}
        </h1>
        <p className="text-stone-600">{translate(locale, "inventory.description")}</p>
        {updatedAt && (
          <p className="text-sm text-stone-600">
            {translate(locale, "inventory.updatedAt", { value: formatDate(updatedAt, profile) })}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Balances({
  balances,
  profile,
  onOpen,
}: {
  balances: Balance[];
  profile: Profile;
  onOpen: (balance: Balance, type: MovementTarget["type"]) => void;
}) {
  const locale = localeFromProfile(profile);
  return (
    <section className="space-y-3" aria-labelledby="inventory-balances-title">
      <h2 id="inventory-balances-title" className="text-xl font-semibold text-stone-950">
        {translate(locale, "products.balances")}
      </h2>
      <div className="grid gap-4 xl:hidden">
        {balances.map((balance) => (
          <BalanceCard
            key={`${balance.locationId}-${balance.inventoryItemId}`}
            balance={balance}
            profile={profile}
            onOpen={onOpen}
          />
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-stone-50 text-stone-600">
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
                className="border-t border-stone-100"
              >
                <td className="px-4 py-3 font-medium text-stone-950">
                  {balance.inventoryItemName}
                  <span className="ml-2 text-stone-600">{balance.unit}</span>
                </td>
                <td className="px-4 py-3 text-stone-700">{balance.locationName}</td>
                <td className="px-4 py-3 text-stone-700">
                  {formatNumber(balance.onHand, profile)}
                </td>
                <td className="px-4 py-3 text-stone-700">
                  {formatNumber(balance.minThreshold, profile)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={balance.status} profile={profile} />
                </td>
                <td className="px-4 py-3">
                  <BalanceActions balance={balance} profile={profile} onOpen={onOpen} />
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
}: {
  balance: Balance;
  profile: Profile;
  onOpen: (balance: Balance, type: MovementTarget["type"]) => void;
}) {
  const locale = localeFromProfile(profile);
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-stone-950">{balance.inventoryItemName}</h3>
          <p className="mt-1 text-sm text-stone-600">
            {balance.locationName} · {balance.unit}
          </p>
        </div>
        <StatusBadge status={balance.status} profile={profile} />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-stone-600">{translate(locale, "inventory.onHand")}</dt>
          <dd className="mt-1 font-semibold text-stone-950">
            {formatNumber(balance.onHand, profile)}
          </dd>
        </div>
        <div>
          <dt className="text-stone-600">{translate(locale, "inventory.threshold")}</dt>
          <dd className="mt-1 font-semibold text-stone-950">
            {formatNumber(balance.minThreshold, profile)}
          </dd>
        </div>
      </dl>
      <div className="mt-5">
        <BalanceActions balance={balance} profile={profile} onOpen={onOpen} />
      </div>
    </article>
  );
}

function BalanceActions({
  balance,
  profile,
  onOpen,
}: {
  balance: Balance;
  profile: Profile;
  onOpen: (balance: Balance, type: MovementTarget["type"]) => void;
}) {
  const locale = localeFromProfile(profile);
  const open = (type: MovementTarget["type"]) => onOpen(balance, type);
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => open("receipt")}>
        <ArrowUp className="mr-1.5 size-4" aria-hidden="true" />
        {translate(locale, "inventory.receipt")}
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={balance.status === "out_of_stock"}
        onClick={() => open("writeoff")}
      >
        <ArrowDown className="mr-1.5 size-4" aria-hidden="true" />
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
  onLoadMore,
}: {
  movements: InventoryData["movements"];
  profile: Profile;
  hasNext: boolean;
  pending: boolean;
  onLoadMore: () => void;
}) {
  const locale = localeFromProfile(profile);
  return (
    <section className="space-y-3" aria-labelledby="recent-movements-title">
      <h2 id="recent-movements-title" className="text-xl font-semibold text-stone-950">
        {translate(locale, "inventory.recentMovements")}
      </h2>
      {!movements.length ? (
        <EmptyState locale={locale}>{translate(locale, "inventory.noMovements")}</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="divide-y divide-stone-100">
            {movements.map((movement) => (
              <article
                key={movement.movementId}
                className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
              >
                <div>
                  <p className="font-medium text-stone-950">{movement.inventoryItemName}</p>
                  <p className="mt-1 text-stone-600">
                    {movement.locationName} · {formatDate(movement.occurredAt, profile)}
                  </p>
                </div>
                <p
                  className={
                    movement.type === "receipt"
                      ? "font-semibold text-emerald-800"
                      : "font-semibold text-red-800"
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
            <div className="border-t border-stone-100 p-3">
              <Button type="button" variant="outline" disabled={pending} onClick={onLoadMore}>
                {pending
                  ? translate(locale, "states.loading")
                  : translate(locale, "actions.loadMore")}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status, profile }: { status: Balance["status"]; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const styles = {
    in_stock: "bg-emerald-50 text-emerald-800",
    low_stock: "bg-amber-50 text-amber-900",
    out_of_stock: "bg-red-50 text-red-800",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}
    >
      {translate(locale, statusKey(status))}
    </span>
  );
}

const statusKey = (status: Balance["status"]): TranslationKey =>
  `inventory.${status === "in_stock" ? "inStock" : status === "low_stock" ? "lowStock" : "outOfStock"}`;

function InventorySkeleton() {
  return (
    <section className="space-y-6" aria-label="Inventory loading">
      <div className="space-y-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-80 w-full" />
      <Skeleton className="h-56 w-full" />
    </section>
  );
}
