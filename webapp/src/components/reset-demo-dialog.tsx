import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState, PendingButton } from "@/components/ui/states";
import { translate, type AppLocale } from "@/lib/i18n";

export function ResetDemoDialog({
  open,
  onOpenChange,
  locale,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: AppLocale;
  pending: boolean;
  error: Error | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/35" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold text-stone-950">
                {translate(locale, "reset.title")}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-stone-600">
                {translate(locale, "reset.description")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild disabled={pending}>
              <button
                type="button"
                className="icon-button -mr-2 -mt-2"
                aria-label={translate(locale, "actions.close")}
              >
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </div>
          <ul className="mt-5 space-y-3 text-sm text-stone-700">
            <li className="rounded-lg bg-amber-50 p-3">{translate(locale, "reset.resetItems")}</li>
            <li className="rounded-lg bg-emerald-50 p-3">{translate(locale, "reset.keepItems")}</li>
          </ul>
          {Boolean(error) && (
            <div className="mt-4">
              <ErrorState locale={locale} error={error} />
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Dialog.Close asChild disabled={pending}>
              <Button type="button" variant="outline">
                {translate(locale, "actions.cancel")}
              </Button>
            </Dialog.Close>
            <PendingButton
              type="button"
              pending={pending}
              pendingLabel={translate(locale, "reset.pending")}
              onClick={onConfirm}
            >
              {translate(locale, "reset.confirm")}
            </PendingButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
