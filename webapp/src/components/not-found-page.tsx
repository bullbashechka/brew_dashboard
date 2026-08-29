import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { sessionQueryOptions } from "@/api/session";
import { localeFromProfile, translate } from "@/lib/i18n";

export function NotFoundPage() {
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-10">
      <section className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-7 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
          404
        </p>
        <h1 className="text-3xl font-semibold text-[var(--color-text)]">
          {translate(locale, "routes.notFound")}
        </h1>
        <p className="text-[var(--color-text-muted)]">
          {translate(locale, "routes.notFoundDescription")}
        </p>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center text-[var(--color-accent)] underline underline-offset-4"
        >
          {translate(locale, "routes.returnHome")}
        </Link>
      </section>
    </main>
  );
}
