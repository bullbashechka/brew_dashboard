import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { sessionQueryOptions } from "@/api/session";
import { localeFromProfile, translate } from "@/lib/i18n";

export function NotFoundPage() {
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-10">
      <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-800">404</p>
        <h1 className="text-3xl font-semibold text-stone-950">
          {translate(locale, "routes.notFound")}
        </h1>
        <p className="text-stone-600">{translate(locale, "routes.notFoundDescription")}</p>
        <Link to="/" className="inline-flex text-amber-900 underline underline-offset-4">
          {translate(locale, "routes.returnHome")}
        </Link>
      </section>
    </main>
  );
}
