import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { TourState } from "@brew-dashboard/contracts";

import { Button } from "@/components/ui/button";
import { FormError, ProgressState } from "@/components/ui/states";
import { type AppLocale, translate } from "@/lib/i18n";

type TourRoute = "/app/overview" | "/app/locations" | "/app/inventory";

const steps: Array<{
  route: TourRoute;
  target: string;
  title: "tour.overviewTitle" | "tour.locationsTitle" | "tour.inventoryTitle";
  description:
    "tour.overviewDescription" | "tour.locationsDescription" | "tour.inventoryDescription";
}> = [
  {
    route: "/app/overview",
    target: '[data-tour="overview-filters"]',
    title: "tour.overviewTitle",
    description: "tour.overviewDescription",
  },
  {
    route: "/app/locations",
    target: '[data-tour="navigation-locations"]',
    title: "tour.locationsTitle",
    description: "tour.locationsDescription",
  },
  {
    route: "/app/inventory",
    target: '[data-tour="feedback"]',
    title: "tour.inventoryTitle",
    description: "tour.inventoryDescription",
  },
];

export function GuidedTour({
  locale,
  open,
  onNavigate,
  onPersist,
}: {
  locale: AppLocale;
  open: boolean;
  onNavigate: (route: TourRoute) => Promise<void>;
  onPersist: (state: TourState) => Promise<void>;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const step = steps[stepIndex]!;
  const lastStep = stepIndex === steps.length - 1;

  useEffect(() => {
    if (!open) return;
    const target = document.querySelector(step.target);
    target?.classList.add("tour-target-active");
    return () => target?.classList.remove("tour-target-active");
  }, [open, step.target]);

  const persist = async (state: TourState) => {
    setError(null);
    setPending(true);
    try {
      await onPersist(state);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setPending(false);
    }
  };

  const move = async (nextIndex: number) => {
    setError(null);
    setPending(true);
    try {
      await onNavigate(steps[nextIndex]!.route);
      setStepIndex(nextIndex);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setPending(false);
    }
  };

  const next = async () => {
    if (lastStep) return persist("completed");
    return move(stepIndex + 1);
  };

  return (
    <Dialog.Root open={open} onOpenChange={() => undefined}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/25" />
        <Dialog.Content className="fixed inset-x-4 bottom-4 z-[60] mx-auto w-auto max-w-md rounded-2xl border border-stone-200 bg-[#fffaf2] p-5 shadow-xl focus:outline-none sm:bottom-8">
          <Dialog.Title className="text-lg font-semibold text-stone-950">
            {translate(locale, "tour.title")}
          </Dialog.Title>
          <p className="mt-1 text-sm text-stone-600">
            {translate(locale, "tour.progress", { current: stepIndex + 1, total: steps.length })}
          </p>
          <h2 className="mt-5 text-xl font-semibold text-stone-950">
            {translate(locale, step.title)}
          </h2>
          <Dialog.Description className="mt-2 text-sm leading-6 text-stone-700">
            {translate(locale, step.description)}
          </Dialog.Description>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void persist("skipped")}
              disabled={pending}
            >
              {translate(locale, "tour.skip")}
            </Button>
            <div className="flex gap-2">
              {stepIndex > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void move(stepIndex - 1)}
                  disabled={pending}
                >
                  {translate(locale, "tour.back")}
                </Button>
              )}
              <Button
                type="button"
                onClick={() => void next()}
                disabled={pending}
                aria-busy={pending || undefined}
              >
                {pending ? (
                  <ProgressState locale={locale} />
                ) : (
                  translate(locale, lastStep ? "tour.finish" : "tour.next")
                )}
              </Button>
            </div>
          </div>
          <div className="mt-3">
            <FormError locale={locale} error={error} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
