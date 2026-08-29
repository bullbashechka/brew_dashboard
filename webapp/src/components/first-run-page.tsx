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
    <main className="mx-auto flex min-h-screen w-full max-w-[var(--container-form)] items-center px-0 py-0 sm:px-5 sm:py-10">
      <section className="w-full bg-[var(--color-surface)] p-5 sm:rounded-2xl sm:border sm:border-[var(--color-border)] sm:p-8 sm:shadow-[var(--shadow-card)]">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
          {translate(locale, "public.firstRun")}
        </p>
        <h1 className="mt-3 text-[1.625rem] leading-8 font-semibold tracking-tight text-[var(--color-text)] sm:text-3xl sm:leading-9">
          {title}
        </h1>
        <p className="mt-3 text-[var(--color-text-secondary)]">{description}</p>
        <div className="mt-7">{children}</div>
      </section>
    </main>
  );
}
