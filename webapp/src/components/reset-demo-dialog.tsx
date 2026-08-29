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
  disabled = false,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: AppLocale;
  pending: boolean;
  disabled?: boolean;
  error: Error | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--color-overlay)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(var(--dialog-md),calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-dialog)] focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold text-[var(--color-text)]">
                {translate(locale, "reset.title")}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-[var(--color-text-secondary)]">
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
          <ul className="mt-5 space-y-3 text-sm text-[var(--color-text-secondary)]">
            <li className="rounded-lg bg-[var(--color-warning-surface)] p-3 text-[var(--color-warning)]">
              {translate(locale, "reset.resetItems")}
            </li>
            <li className="rounded-lg bg-[var(--color-success-surface)] p-3 text-[var(--color-success)]">
              {translate(locale, "reset.keepItems")}
            </li>
          </ul>
          {Boolean(error) && (
            <div className="mt-4">
              <ErrorState locale={locale} error={error} />
            </div>
          )}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Dialog.Close asChild disabled={pending}>
              <Button type="button" variant="outline" fullWidth="mobile">
                {translate(locale, "actions.cancel")}
              </Button>
            </Dialog.Close>
            <PendingButton
              type="button"
              variant="destructive"
              fullWidth="mobile"
              pending={pending}
              pendingLabel={translate(locale, "reset.pending")}
              disabled={disabled}
              onClick={() => {
                if (!disabled) onConfirm();
              }}
            >
              {translate(locale, "reset.confirm")}
            </PendingButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
