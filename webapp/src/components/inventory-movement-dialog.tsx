/* eslint-disable react-refresh/only-export-components */
import * as Dialog from "@radix-ui/react-dialog";
import type { InventoryData, InventoryMovementMutation, Profile } from "@brew-dashboard/contracts";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApiClientError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/states";
import { formatNumber, localeFromProfile, translate } from "@/lib/i18n";

type Balance = InventoryData["balances"][number];
type MovementType = InventoryMovementMutation["type"];

const quantityPattern = /^(?:0|[1-9]\d{0,10})(?:\.\d{0,3})?$/u;

export function normalizeQuantity(value: string) {
  if (!quantityPattern.test(value) || /^0(?:\.0{0,3})?$/u.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(3, "0")}`;
}

const toThousandths = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole ?? "0") * 1000n + BigInt(fraction.padEnd(3, "0") || "0");
};

export const remainingQuantity = (onHand: string, quantity: string) => {
  const value = toThousandths(onHand) - toThousandths(quantity);
  const whole = value / 1000n;
  const fraction = (value % 1000n).toString().padStart(3, "0");
  return `${whole}.${fraction}`;
};

export function InventoryMovementDialog({
  balance,
  type,
  profile,
  demoDataRevision,
  open,
  pending,
  error,
  conflictState = "ready",
  onOpenChange,
  onSave,
  onClearError,
  onRefreshConflict,
}: {
  balance: Balance | null;
  type: MovementType | null;
  profile: Profile;
  demoDataRevision: number;
  open: boolean;
  pending: boolean;
  error: Error | null;
  conflictState?: "ready" | "refresh_failed" | "unavailable" | undefined;
  onOpenChange: (open: boolean) => void;
  onSave: (request: InventoryMovementMutation) => void;
  onClearError: () => void;
  onRefreshConflict?: () => void;
}) {
  const locale = localeFromProfile(profile);
  const [quantity, setQuantity] = useState("");
  const key = useRef<string | null>(null);
  const submitting = useRef(false);
  const normalized = normalizeQuantity(quantity);
  const wholePieces = !balance || balance.unit !== "pcs" || Boolean(normalized?.endsWith(".000"));
  const exceedsBalance = Boolean(
    balance &&
    type === "writeoff" &&
    normalized &&
    toThousandths(normalized) > toThousandths(balance.onHand),
  );
  const invalid = normalized === null || !wholePieces || exceedsBalance;
  const conflict = error instanceof ApiClientError && error.code === "CONFLICT";

  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending]);

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && !pending) {
      onClearError();
      setQuantity("");
      key.current = null;
    }
    onOpenChange(nextOpen);
  };

  const submit = (retry = false) => {
    if (
      !balance ||
      !type ||
      pending ||
      submitting.current ||
      invalid ||
      !normalized ||
      (conflict && !retry)
    )
      return;
    if (retry) {
      key.current = null;
      onClearError();
    }
    key.current ??= crypto.randomUUID();
    submitting.current = true;
    onSave({
      inventoryItemId: balance.inventoryItemId,
      locationId: balance.locationId,
      type,
      quantity: normalized,
      expectedDemoDataRevision: demoDataRevision,
      idempotencyKey: key.current,
    });
  };

  const afterWriteoff =
    balance && type === "writeoff" && normalized && !exceedsBalance
      ? remainingQuantity(balance.onHand, normalized)
      : null;
  const title = type === "receipt" ? "inventory.receiptTitle" : "inventory.writeoffTitle";
  const description =
    type === "receipt" ? "inventory.receiptDescription" : "inventory.writeoffDescription";

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/35" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold text-stone-950">
                {translate(locale, title)}
              </Dialog.Title>
              {balance && type && (
                <Dialog.Description className="mt-2 text-sm text-stone-600">
                  {translate(locale, description, {
                    item: balance.inventoryItemName,
                    location: balance.locationName,
                  })}
                </Dialog.Description>
              )}
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
          {balance && type && (
            <div className="mt-5 space-y-4">
              <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
                <p className="font-medium text-stone-950">{balance.inventoryItemName}</p>
                <p className="mt-1">
                  {translate(locale, "inventory.currentBalance", {
                    value: formatNumber(balance.onHand, profile),
                    unit: balance.unit,
                  })}
                </p>
                <p className="mt-1">
                  {translate(locale, "inventory.threshold")}:{" "}
                  {formatNumber(balance.minThreshold, profile)} {balance.unit}
                </p>
              </div>
              <label className="grid gap-1 text-sm font-medium text-stone-700">
                {translate(locale, "inventory.quantity")}
                <input
                  className="control w-full"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => {
                    key.current = null;
                    setQuantity(event.target.value);
                    if (!conflict || conflictState === "ready") onClearError();
                  }}
                  aria-invalid={invalid || undefined}
                  disabled={pending}
                />
              </label>
              <p className="text-sm text-stone-600">
                {translate(locale, "inventory.quantityHint", { unit: balance.unit })}
              </p>
              {balance.unit === "pcs" && (
                <p className="text-sm text-stone-600">
                  {translate(locale, "inventory.quantityWholeHint")}
                </p>
              )}
              {afterWriteoff && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  {translate(locale, "inventory.afterWriteoff", {
                    value: formatNumber(afterWriteoff, profile),
                    unit: balance.unit,
                  })}
                </p>
              )}
              {exceedsBalance && (
                <p role="alert" className="text-sm text-red-800">
                  {translate(locale, "inventory.exceedsBalance")}
                </p>
              )}
              {normalized === null && quantity && (
                <p role="alert" className="text-sm text-red-800">
                  {translate(locale, "errors.validation")}
                </p>
              )}
              {balance.unit === "pcs" && normalized && !wholePieces && (
                <p role="alert" className="text-sm text-red-800">
                  {translate(locale, "inventory.quantityWholeHint")}
                </p>
              )}
              {conflict && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  <p>
                    {translate(
                      locale,
                      conflictState === "unavailable"
                        ? "inventory.conflictUnavailable"
                        : conflictState === "refresh_failed"
                          ? "inventory.conflictRefreshFailed"
                          : "inventory.conflict",
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {conflictState === "ready" && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={pending || invalid}
                        onClick={() => submit(true)}
                      >
                        {translate(locale, "inventory.retryLatest")}
                      </Button>
                    )}
                    {conflictState === "refresh_failed" && onRefreshConflict && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={onRefreshConflict}
                      >
                        {translate(locale, "actions.retry")}
                      </Button>
                    )}
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
                  disabled={pending || invalid || conflict}
                  onClick={() => submit()}
                >
                  {pending
                    ? translate(
                        locale,
                        type === "receipt"
                          ? "inventory.pendingReceipt"
                          : "inventory.pendingWriteoff",
                      )
                    : type === "receipt"
                      ? translate(locale, "inventory.submitReceipt")
                      : translate(locale, "inventory.submitWriteoff", {
                          value: normalized ? formatNumber(normalized, profile) : "",
                          unit: balance.unit,
                        })}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
