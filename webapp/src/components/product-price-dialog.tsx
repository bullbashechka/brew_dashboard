/* eslint-disable react-refresh/only-export-components */
import * as Dialog from "@radix-ui/react-dialog";
import type { PriceMutation, ProductAnalytics, Profile } from "@brew-dashboard/contracts";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApiClientError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/states";
import { localeFromProfile, translate } from "@/lib/i18n";

export function normalizePrice(value: string) {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{0,2})?$/u.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

export function PriceDialog({
  product,
  profile,
  demoDataRevision,
  open,
  pending,
  error,
  onOpenChange,
  onSave,
  onClearError,
}: {
  product: ProductAnalytics | null;
  profile: Profile;
  demoDataRevision: number;
  open: boolean;
  pending: boolean;
  error: Error | null;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, request: PriceMutation) => void;
  onClearError: () => void;
}) {
  const locale = localeFromProfile(profile);
  const [price, setPrice] = useState(product?.currentPrice ?? "");
  const key = useRef<string | null>(null);
  const submitting = useRef(false);
  const normalized = normalizePrice(price);
  const invalid = normalized === null;
  const unchanged = Boolean(product && normalized === product.currentPrice);
  const conflict = error instanceof ApiClientError && error.code === "CONFLICT";

  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending]);

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && !pending) onClearError();
    onOpenChange(nextOpen);
  };

  const submit = (overwrite = false) => {
    if (!product || pending || submitting.current || invalid || unchanged) return;
    if (overwrite) key.current = null;
    key.current ??= crypto.randomUUID();
    submitting.current = true;
    onSave(product.productId, {
      price: normalized,
      expectedVersion: product.version,
      expectedDemoDataRevision: demoDataRevision,
      idempotencyKey: key.current,
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/35" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold text-stone-950">
                {translate(locale, "products.editPriceTitle")}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-stone-600">
                {translate(locale, "products.editPriceDescription")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="icon-button"
                disabled={pending}
                aria-label={translate(locale, "actions.close")}
              >
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </div>
          {product && (
            <div className="mt-5 space-y-4">
              <label className="grid gap-1 text-sm font-medium text-stone-700">
                {translate(locale, "products.priceLabel")}
                <input
                  className="control w-full"
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => {
                    key.current = null;
                    setPrice(event.target.value);
                  }}
                  aria-invalid={invalid || undefined}
                  disabled={pending}
                />
              </label>
              {invalid && (
                <p role="alert" className="text-sm text-red-800">
                  {translate(locale, "errors.validation")}
                </p>
              )}
              {normalizePrice(price) === "0.00" && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  {translate(locale, "products.zeroPriceWarning")}
                </p>
              )}
              {conflict && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  <p>{translate(locale, "products.conflict")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        setPrice(product.currentPrice);
                        key.current = null;
                        onClearError();
                      }}
                    >
                      {translate(locale, "actions.useLatest")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending || invalid || unchanged}
                      onClick={() => submit(true)}
                    >
                      {translate(locale, "actions.overwrite")}
                    </Button>
                  </div>
                </div>
              )}
              <FormError locale={locale} error={error} />
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => changeOpen(false)}
                >
                  {translate(locale, "actions.cancel")}
                </Button>
                <Button
                  type="button"
                  disabled={pending || invalid || unchanged || conflict}
                  onClick={() => submit()}
                >
                  {pending
                    ? translate(locale, "actions.saving")
                    : translate(locale, "actions.save")}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
