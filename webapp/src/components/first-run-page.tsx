import type { ReactNode } from "react";

import { localeFromProfile, translate } from "@/lib/i18n";

export function FirstRunPage({
  locale,
  title,
  description,
  children,
}: {
  locale: ReturnType<typeof localeFromProfile>;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-5 py-10">
      <section className="w-full rounded-2xl border border-stone-200 bg-[#fffaf2] p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-800">
          {translate(locale, "public.firstRun")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">{title}</h1>
        <p className="mt-3 text-stone-600">{description}</p>
        <div className="mt-7">{children}</div>
      </section>
    </main>
  );
}
