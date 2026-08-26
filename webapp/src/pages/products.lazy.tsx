/* eslint-disable react-refresh/only-export-components */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLazyRoute, useRouterState } from "@tanstack/react-router";
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
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  localeFromProfile,
  translate,
} from "@/lib/i18n";

const periods = ["today", "7d", "30d", "6m"] as const;
const menuGroups = ["stars", "workhorses", "puzzles", "dogs"] as const;
const groupColors = {
  stars: "#166534",
  workhorses: "#a16207",
  puzzles: "#0f766e",
  dogs: "#9f1239",
} as const;

export const Route = createLazyRoute("/app/products")({ component: ProductsPage });

function ProductsPage() {
  const queryClient = useQueryClient();
  const search = useRouterState({
    select: (state) => state.location.search as { period?: string; locationId?: string },
  });
  const { data: profile } = useQuery(sessionQueryOptions());
  const filters: AnalyticsFilters = {
    period: periods.includes(search.period as (typeof periods)[number])
      ? (search.period as AnalyticsFilters["period"])
      : "today",
    ...(typeof search.locationId === "string" ? { locationId: search.locationId } : {}),
  };
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
  if (analytics.isError)
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
  return (
    <ProductsFrame profile={profile} updatedAt={analytics.data.meta.asOf}>
      {!analytics.data.data.products.length ? (
        <EmptyState locale={locale} />
      ) : (
        <>
          {analytics.isFetching && (
            <p className="text-sm text-stone-500" role="status">
              {translate(locale, "products.refreshing")}
            </p>
          )}
          <MenuMatrix data={analytics.data.data} profile={profile} />
          <ProductCategories
            data={analytics.data.data}
            profile={profile}
            onEdit={openProductEditor}
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
      <div className="space-y-2">
        <h1 id="products-title" className="text-3xl font-semibold tracking-tight text-stone-950">
          {translate(locale, "products.title")}
        </h1>
        <p className="text-stone-600">{translate(locale, "products.description")}</p>
        {updatedAt && <p className="text-sm text-stone-500">{formatDate(updatedAt, profile)}</p>}
      </div>
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
      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
      aria-labelledby="menu-matrix-title"
    >
      <div className="space-y-1">
        <h2 id="menu-matrix-title" className="text-xl font-semibold text-stone-950">
          {translate(locale, "products.matrix")}
        </h2>
        <p className="text-sm text-stone-600">{translate(locale, "products.matrixDescription")}</p>
      </div>
      <div className="mt-5 hidden h-96 min-w-0 md:block">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 10 }}>
            <CartesianGrid stroke="#e7e5e4" strokeDasharray="3 3" />
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
              formatter={(value, _name, item) => [
                formatCurrency(value as number, profile),
                item.payload?.name ?? "",
              ]}
            />
            <ReferenceLine
              x={Number(data.medians.unitsSold)}
              stroke="#57534e"
              strokeDasharray="5 5"
            />
            <ReferenceLine
              y={Number(data.medians.unitContribution)}
              stroke="#57534e"
              strokeDasharray="5 5"
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
      className="rounded-lg border border-stone-200 p-3"
      style={{ borderTopColor: groupColors[group], borderTopWidth: 3 }}
    >
      <h3 className="font-semibold text-stone-950">{translate(locale, `products.${group}`)}</h3>
      {firstRecommendation && (
        <p className="mt-1 text-sm text-stone-600">
          {translate(locale, `products.${firstRecommendation}`)}
        </p>
      )}
      <ul
        className={`mt-3 space-y-1 text-sm text-stone-700 ${compact ? "max-h-24 overflow-y-auto" : ""}`}
      >
        {products.length ? (
          products.map((product) => (
            <li key={product.productId} className="flex justify-between gap-2">
              <span className="truncate">{product.name}</span>
              <span>{formatNumber(product.unitsSold, profile)}</span>
            </li>
          ))
        ) : (
          <li className="text-stone-500">{translate(locale, "states.empty")}</li>
        )}
      </ul>
    </article>
  );
}

function ProductCategories({
  data,
  profile,
  onEdit,
}: {
  data: ProductsData;
  profile: Profile;
  onEdit: (id: string) => void;
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
            className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <h2 className="text-xl font-semibold text-stone-950">{category.name}</h2>
            <div className="mt-5 space-y-3 md:hidden">
              {products.map((product) => (
                <ProductCard
                  key={product.productId}
                  product={product}
                  profile={profile}
                  onEdit={onEdit}
                />
              ))}
            </div>
            <div className="mt-5 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[58rem] text-left text-sm">
                <thead className="border-b border-stone-200 text-stone-600">
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
                    <tr key={product.productId} className="border-b border-stone-100 align-top">
                      <td className="py-4 pr-3 font-medium">{product.name}</td>
                      <td className="py-4 pr-3">
                        <PriceDetails product={product} profile={profile} />
                      </td>
                      <td className="py-4 pr-3">{formatNumber(product.unitsSold, profile)}</td>
                      <td className="py-4 pr-3">
                        {formatCurrency(product.revenue, profile)}
                        <br />
                        <span className="text-xs text-stone-500">
                          {formatPercent(product.revenueShare, profile)}
                        </span>
                      </td>
                      <td className="py-4 pr-3">
                        {formatCurrency(product.grossProfit, profile)}
                        <br />
                        <span className="text-xs text-stone-500">
                          {formatPercent(product.grossMargin, profile)}
                        </span>
                      </td>
                      <td className="py-4 pr-3">
                        <Balances product={product} profile={profile} />
                      </td>
                      <td className="py-4 text-right">
                        <EditButton product={product} profile={profile} onEdit={onEdit} />
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
}: {
  product: ProductAnalytics;
  profile: Profile;
  onEdit: (id: string) => void;
}) {
  return (
    <article className="rounded-lg border border-stone-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-stone-950">{product.name}</h3>
        <EditButton product={product} profile={profile} onEdit={onEdit} />
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
    <div className="text-sm text-stone-700">
      <p>
        {translate(locale, "products.currentPrice")}:{" "}
        <span className="font-medium text-stone-950">
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
    <ul className="space-y-1 text-sm text-stone-700">
      {product.balances.map((balance) => (
        <li key={balance.locationId}>
          {balance.locationName}: {formatNumber(balance.onHand, profile)}
        </li>
      ))}
    </ul>
  ) : (
    <span className="text-sm text-stone-500">{translate(locale, "products.noBalances")}</span>
  );
}

function EditButton({
  product,
  profile,
  onEdit,
}: {
  product: ProductAnalytics;
  profile: Profile;
  onEdit: (id: string) => void;
}) {
  const locale = localeFromProfile(profile);
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => onEdit(product.productId)}>
      <Pencil className="mr-1 size-3.5" aria-hidden="true" />
      {translate(locale, "actions.editPrice")}
    </Button>
  );
}

function ProductsSkeleton() {
  return (
    <section className="space-y-6" data-testid="page-products">
      <div className="space-y-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <Skeleton className="h-96" />
      <Skeleton className="h-72" />
    </section>
  );
}
