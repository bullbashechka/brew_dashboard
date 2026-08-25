import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/api/session";
import { EmptyState } from "@/components/ui/states";
import { localeFromProfile, translate } from "@/lib/i18n";

export type AppSection = "overview" | "locations" | "sales" | "products" | "inventory" | "settings";

export function AppPage({ section }: { section: AppSection }) {
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const panel = useRouterState({ select: (state) => state.location.search.panel });
  const feedback = section === "settings" && panel === "feedback";

  return (
    <section
      className="space-y-6"
      aria-labelledby={`${section}-title`}
      data-testid={`page-${section}`}
    >
      <div className="space-y-2">
        <h1
          id={`${section}-title`}
          className="text-3xl font-semibold tracking-tight text-stone-950"
        >
          {translate(locale, `navigation.${section}`)}
        </h1>
        <p className="text-stone-600">{translate(locale, "states.foundation")}</p>
      </div>
      {feedback ? (
        <EmptyState locale={locale}>{translate(locale, "states.feedbackLater")}</EmptyState>
      ) : (
        <EmptyState locale={locale}>{pathname}</EmptyState>
      )}
    </section>
  );
}
