import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductAnalytics, ProductsData, Profile } from "@brew-dashboard/contracts";
import { Pencil } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { productsQuery, updateProductPrice, type AnalyticsFilters } from "@/api/analytics";
import { ApiClientError } from "@/api/client";
import { sessionQueryOptions } from "@/api/session";
import { PriceDialog } from "@/components/product-price-dialog";
import { recordFeedbackMutation } from "@/lib/feedback-prompt";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { ChartAccessibility } from "@/components/ui/chart-accessibility";
import { CachedSnapshotWarning, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  localeFromProfile,
  translate,
} from "@/lib/i18n";

const menuGroups = ["stars", "workhorses", "puzzles", "dogs"] as const;
const groupColors = {
  stars: "var(--color-chart-1)",
  workhorses: "var(--color-chart-2)",
  puzzles: "var(--color-chart-3)",
  dogs: "var(--color-chart-4)",
} as const;

export function ProductsPage({ filters }: { filters: AnalyticsFilters }) {
  const queryClient = useQueryClient();
  const { data: profile } = useQuery(sessionQueryOptions());
  const analytics = useQuery({
    ...productsQuery(profile?.networkId ?? "pending", filters),
    enabled: Boolean(profile),
  });
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const locale = localeFromProfile(profile);
  const edit = useMutation({
    mutationFn: (input: Parameters<typeof updateProductPrice>) => updateProductPrice(...input),
    onSuccess: (response) => {
      toast.success(translate(locale, "products.saved"));
      setEditingProductId(null);
      if (profile) {
        recordFeedbackMutation(profile.networkId);
        void queryClient.invalidateQueries({
          queryKey: ["tenant", profile.networkId, "products"],
        });
      }
      return response;
    },
    onError: (error) => {
      if (profile && error instanceof ApiClientError && error.code === "CONFLICT") {
        void queryClient.invalidateQueries({
          queryKey: ["tenant", profile.networkId, "products"],
        });
      }
    },
  });
  const openProductEditor = (productId: string) => {
    edit.reset();
    setEditingProductId(productId);
  };
  const closeProductEditor = () => {
    if (edit.isPending) return;
    edit.reset();
    setEditingProductId(null);
  };

  if (!profile || analytics.isPending) return <ProductsSkeleton />;
  if (analytics.isLoadingError || !analytics.data)
    return (
      <ProductsFrame profile={profile}>
        <ErrorState
          locale={locale}
          error={analytics.error}
          onRetry={() => void analytics.refetch()}
        />
      </ProductsFrame>
    );
  const editingProduct =
    analytics.data.data.products.find((product) => product.productId === editingProductId) ?? null;
  const mutationDisabled = analytics.isRefetchError;
  return (
    <ProductsFrame profile={profile} updatedAt={analytics.data.meta.asOf}>
      {analytics.isRefetchError && (
        <CachedSnapshotWarning
          profile={profile}
          error={analytics.error}
          asOf={analytics.data.meta.asOf}
          onRetry={() => void analytics.refetch()}
        />
      )}
      {!analytics.data.data.products.length ? (
        <EmptyState locale={locale} />
      ) : (
        <>
          {analytics.isFetching && (
            <p className="text-sm text-[var(--color-text-muted)]" role="status">
              {translate(locale, "products.refreshing")}
            </p>
          )}
          <MenuMatrix data={analytics.data.data} profile={profile} />
          <ProductCategories
            data={analytics.data.data}
            profile={profile}
            onEdit={openProductEditor}
            disabled={mutationDisabled}
          />
        </>
      )}
      <PriceDialog
        key={editingProduct?.productId ?? "none"}
        product={editingProduct}
        profile={profile}
        demoDataRevision={analytics.data.meta.demoDataRevision}
        open={editingProductId !== null}
        pending={edit.isPending}
        disabled={mutationDisabled}
        error={edit.error}
        onOpenChange={(open) => {
          if (!open) closeProductEditor();
        }}
        onSave={(productId, request) => edit.mutate([productId, request])}
        onClearError={() => edit.reset()}
      />
    </ProductsFrame>
  );
}

function ProductsFrame({
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
    <section className="space-y-6" aria-labelledby="products-title" data-testid="page-products">
      <PageHeader
        id="products-title"
        title={translate(locale, "products.title")}
        description={translate(locale, "products.description")}
        meta={updatedAt ? formatDate(updatedAt, profile) : undefined}
      />
      {children}
    </section>
  );
}

function MenuMatrix({ data, profile }: { data: ProductsData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const grouped = useMemo(
    () =>
      Object.fromEntries(
        menuGroups.map((group) => [
          group,
          data.products.filter((product) => product.menuGroup === group),
        ]),
      ) as Record<(typeof menuGroups)[number], ProductAnalytics[]>,
    [data.products],
  );
  const points = (group: (typeof menuGroups)[number]) =>
    grouped[group].map((product) => ({
      ...product,
      units: Number(product.unitsSold),
      contribution: Number(product.unitContribution),
    }));
  return (
    <section
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-card)] sm:p-5"
      aria-labelledby="menu-matrix-title"
    >
      <div className="space-y-1">
        <h2 id="menu-matrix-title" className="text-xl font-semibold text-[var(--color-text)]">
          {translate(locale, "products.matrix")}
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          {translate(locale, "products.matrixDescription")}
        </p>
      </div>
      <div className="mt-5 hidden h-96 min-w-0 md:block">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 10 }}>
            <CartesianGrid stroke="var(--color-chart-grid)" vertical={false} />
            <XAxis
              type="number"
              dataKey="units"
              name={translate(locale, "sales.unitsSold")}
              tickFormatter={(value) => formatNumber(value, profile)}
              label={{
                value: translate(locale, "sales.unitsSold"),
                position: "insideBottom",
                offset: -10,
              }}
            />
            <YAxis
              type="number"
              dataKey="contribution"
              name={translate(locale, "products.unitContribution")}
              tickFormatter={(value) => formatCurrency(value, profile)}
              width={72}
              label={{
                value: translate(locale, "products.unitContribution"),
                angle: -90,
                position: "insideLeft",
              }}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{
                background: "var(--color-surface-raised)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-popover)",
              }}
              labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
              itemStyle={{ color: "var(--color-text-secondary)" }}
              formatter={(value, name, item) => [
                name === translate(locale, "sales.unitsSold")
                  ? formatNumber(value as number, profile)
                  : formatCurrency(value as number, profile),
                `${item.payload?.name ?? ""} · ${String(name)}`,
              ]}
            />
            <ReferenceLine
              x={Number(data.medians.unitsSold)}
              stroke="var(--color-chart-neutral)"
              strokeDasharray="6 4"
            />
            <ReferenceLine
              y={Number(data.medians.unitContribution)}
              stroke="var(--color-chart-neutral)"
              strokeDasharray="6 4"
            />
            {menuGroups.map((group) => (
              <Scatter
                key={group}
                name={translate(locale, `products.${group}`)}
                data={points(group)}
                fill={groupColors[group]}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 md:hidden">
        {menuGroups.map((group) => (
          <MenuGroupCard key={group} group={group} products={grouped[group]} profile={profile} />
        ))}
      </div>
      <div className="mt-5 hidden grid-cols-2 gap-3 md:grid xl:grid-cols-4">
        {menuGroups.map((group) => (
          <MenuGroupCard
            key={group}
            group={group}
            products={grouped[group]}
            profile={profile}
            compact
          />
        ))}
      </div>
      <ChartAccessibility
        summary={translate(locale, "products.matrixDescription")}
        caption={translate(locale, "products.matrix")}
        rows={data.products}
        rowKey={(product) => product.productId}
        columns={[
          {
            key: "product",
            header: translate(locale, "products.title"),
            render: (product) => product.name,
          },
          {
            key: "group",
            header: translate(locale, "products.matrix"),
            render: (product) =>
              product.menuGroup
                ? translate(locale, `products.${product.menuGroup}`)
                : translate(locale, "comparison.notAvailable"),
          },
          {
            key: "units",
            header: translate(locale, "sales.unitsSold"),
            render: (product) => formatNumber(product.unitsSold, profile),
          },
          {
            key: "contribution",
            header: translate(locale, "products.unitContribution"),
            render: (product) => formatCurrency(product.unitContribution, profile),
          },
        ]}
      />
    </section>
  );
}

function MenuGroupCard({
  group,
  products,
  profile,
  compact = false,
}: {
  group: (typeof menuGroups)[number];
  products: ProductAnalytics[];
  profile: Profile;
  compact?: boolean;
}) {
  const locale = localeFromProfile(profile);
  const firstRecommendation = products[0]?.recommendation;
  return (
    <article
      className="rounded-lg border border-[var(--color-border)] p-3"
      style={{ borderTopColor: groupColors[group], borderTopWidth: 3 }}
    >
      <h3 className="font-semibold text-[var(--color-text)]">
        {translate(locale, `products.${group}`)}
      </h3>
      {firstRecommendation && (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {translate(locale, `products.${firstRecommendation}`)}
        </p>
      )}
      <ul
        className={`mt-3 space-y-1 text-sm text-[var(--color-text-secondary)] ${compact ? "max-h-24 overflow-y-auto" : ""}`}
      >
        {products.length ? (
          products.map((product) => (
            <li key={product.productId} className="flex justify-between gap-2">
              <span className="truncate">{product.name}</span>
              <span>{formatNumber(product.unitsSold, profile)}</span>
            </li>
          ))
        ) : (
          <li className="text-[var(--color-text-muted)]">{translate(locale, "states.empty")}</li>
        )}
      </ul>
    </article>
  );
}

function ProductCategories({
  data,
  profile,
  onEdit,
  disabled,
}: {
  data: ProductsData;
  profile: Profile;
  onEdit: (id: string) => void;
  disabled: boolean;
}) {
  const locale = localeFromProfile(profile);
  return (
    <section className="space-y-6" aria-label={translate(locale, "products.title")}>
      {data.categories.map((category) => {
        const products = data.products.filter(
          (product) => product.categoryId === category.categoryId,
        );
        if (!products.length) return null;
        return (
          <article
            key={category.categoryId}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-card)] sm:p-5"
          >
            <h2 className="text-xl font-semibold text-[var(--color-text)]">{category.name}</h2>
            <div className="mt-5 space-y-3 md:hidden">
              {products.map((product) => (
                <ProductCard
                  key={product.productId}
                  product={product}
                  profile={profile}
                  onEdit={onEdit}
                  disabled={disabled}
                />
              ))}
            </div>
            <div className="mt-5 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[58rem] text-left text-sm">
                <caption className="sr-only">{category.name}</caption>
                <thead className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                  <tr>
                    <th className="pb-3 pr-3">{translate(locale, "products.title")}</th>
                    <th className="pb-3 pr-3">{translate(locale, "products.currentPrice")}</th>
                    <th className="pb-3 pr-3">{translate(locale, "sales.unitsSold")}</th>
                    <th className="pb-3 pr-3">{translate(locale, "metrics.revenue")}</th>
                    <th className="pb-3 pr-3">{translate(locale, "metrics.grossProfit")}</th>
                    <th className="pb-3 pr-3">{translate(locale, "products.balances")}</th>
                    <th className="pb-3" />
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr
                      key={product.productId}
                      className="border-b border-[var(--color-border-subtle)] align-top"
                    >
                      <td className="py-4 pr-3 font-medium">{product.name}</td>
                      <td className="py-4 pr-3">
                        <PriceDetails product={product} profile={profile} />
                      </td>
                      <td className="py-4 pr-3">{formatNumber(product.unitsSold, profile)}</td>
                      <td className="py-4 pr-3">
                        {formatCurrency(product.revenue, profile)}
                        <br />
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {formatPercent(product.revenueShare, profile)}
                        </span>
                      </td>
                      <td className="py-4 pr-3">
                        {formatCurrency(product.grossProfit, profile)}
                        <br />
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {formatPercent(product.grossMargin, profile)}
                        </span>
                      </td>
                      <td className="py-4 pr-3">
                        <Balances product={product} profile={profile} />
                      </td>
                      <td className="py-4 text-right">
                        <EditButton
                          product={product}
                          profile={profile}
                          onEdit={onEdit}
                          disabled={disabled}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function ProductCard({
  product,
  profile,
  onEdit,
  disabled,
}: {
  product: ProductAnalytics;
  profile: Profile;
  onEdit: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <article className="rounded-lg border border-[var(--color-border)] p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-[var(--color-text)]">{product.name}</h3>
        <EditButton product={product} profile={profile} onEdit={onEdit} disabled={disabled} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <PriceDetails product={product} profile={profile} />
        <div className="text-sm">
          <p>
            {formatNumber(product.unitsSold, profile)} ·{" "}
            {translate(localeFromProfile(profile), "sales.unitsSold")}
          </p>
          <p className="mt-1">
            {formatCurrency(product.revenue, profile)} ·{" "}
            {formatPercent(product.revenueShare, profile)}
          </p>
          <p className="mt-1">
            {formatCurrency(product.grossProfit, profile)} ·{" "}
            {formatPercent(product.grossMargin, profile)}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <Balances product={product} profile={profile} />
      </div>
    </article>
  );
}

function PriceDetails({ product, profile }: { product: ProductAnalytics; profile: Profile }) {
  const locale = localeFromProfile(profile);
  return (
    <div className="text-sm text-[var(--color-text-secondary)]">
      <p>
        {translate(locale, "products.currentPrice")}:{" "}
        <span className="font-medium text-[var(--color-text)]">
          {formatCurrency(product.currentPrice, profile)}
        </span>
      </p>
      <p className="mt-1">
        {translate(locale, "products.currentUnitCost")}:{" "}
        {formatCurrency(product.currentUnitCost, profile)}
      </p>
      <p className="mt-1">
        {translate(locale, "products.currentUnitMargin")}:{" "}
        {formatPercent(product.currentUnitMargin, profile)}
      </p>
    </div>
  );
}

function Balances({ product, profile }: { product: ProductAnalytics; profile: Profile }) {
  const locale = localeFromProfile(profile);
  return product.balances.length ? (
    <ul className="space-y-1 text-sm text-[var(--color-text-secondary)]">
      {product.balances.map((balance) => (
        <li key={balance.locationId}>
          {balance.locationName}: {formatNumber(balance.onHand, profile)}
        </li>
      ))}
    </ul>
  ) : (
    <span className="text-sm text-[var(--color-text-muted)]">
      {translate(locale, "products.noBalances")}
    </span>
  );
}

function EditButton({
  product,
  profile,
  onEdit,
  disabled,
}: {
  product: ProductAnalytics;
  profile: Profile;
  onEdit: (id: string) => void;
  disabled: boolean;
}) {
  const locale = localeFromProfile(profile);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      icon={Pencil}
      disabled={disabled}
      onClick={() => onEdit(product.productId)}
    >
      {translate(locale, "actions.editPrice")}
    </Button>
  );
}

function ProductsSkeleton() {
  return (
    <section className="space-y-6" data-testid="page-products">
      <div className="space-y-2">
        <Skeleton variant="pageTitleCompact" />
        <Skeleton variant="pageDescription" />
      </div>
      <Skeleton variant="productMatrix" />
      <Skeleton variant="productList" />
    </section>
  );
}
