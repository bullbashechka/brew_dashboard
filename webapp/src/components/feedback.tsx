import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedbackResponseData, Profile } from "@brew-dashboard/contracts";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApiClientError } from "@/api/client";
import { feedbackQuery, feedbackQueryKey, saveFeedback } from "@/api/settings";
import { Button } from "@/components/ui/button";
import { ErrorState, FormError, PendingButton } from "@/components/ui/states";
import { localeFromProfile, translate } from "@/lib/i18n";

type FeedbackFormProps = {
  profile: Profile;
  onSubmitted?: () => void;
};

const initialValues = (feedback: FeedbackResponseData | null | undefined) => ({
  rating: String(feedback?.rating ?? 5),
  comment: feedback?.comment ?? "",
  desiredFeatures: feedback?.desiredFeatures ?? "",
});

export function FeedbackForm({ profile, onSubmitted }: FeedbackFormProps) {
  const locale = localeFromProfile(profile);
  const queryClient = useQueryClient();
  const feedback = useQuery(feedbackQuery(profile.networkId));
  const [values, setValues] = useState(() => initialValues(undefined));
  const key = useRef<string | null>(null);
  const version = useRef<number | null>(null);
  const submittedVersion = useRef<number | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      key.current ??= crypto.randomUUID();
      return saveFeedback({
        rating: Number(values.rating),
        comment: values.comment,
        desiredFeatures: values.desiredFeatures,
        expectedVersion: version.current,
        idempotencyKey: key.current,
      });
    },
    onSuccess: (response) => {
      if (!response.data) return;
      submittedVersion.current = response.data.version;
      version.current = response.data.version;
      key.current = null;
      queryClient.setQueryData(feedbackQueryKey(profile.networkId), response);
      onSubmitted?.();
    },
  });
  const saved = feedback.data?.data;
  useEffect(() => {
    if (feedback.isSuccess && saved?.version !== submittedVersion.current) {
      version.current = saved?.version ?? null;
      setValues(initialValues(saved));
    }
  }, [feedback.isSuccess, saved]);

  const invalid =
    !/^[1-5]$/u.test(values.rating) ||
    values.comment.length > 2000 ||
    values.desiredFeatures.length < 1 ||
    values.desiredFeatures.length > 2000;
  const conflict = mutation.error instanceof ApiClientError && mutation.error.code === "CONFLICT";

  const submit = (overwrite = false) => {
    if (mutation.isPending || invalid || (conflict && !overwrite)) return;
    if (overwrite) {
      key.current = null;
      mutation.reset();
    }
    mutation.mutate();
  };

  if (feedback.isPending) {
    return <p className="text-sm text-stone-600">{translate(locale, "states.loading")}</p>;
  }
  if (feedback.isError) {
    return (
      <ErrorState locale={locale} error={feedback.error} onRetry={() => void feedback.refetch()} />
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="grid gap-1 text-sm font-medium text-stone-700">
        {translate(locale, "feedback.rating")}
        <select
          className="control w-full"
          value={values.rating}
          disabled={mutation.isPending}
          onChange={(event) => {
            key.current = null;
            mutation.reset();
            setValues((current) => ({ ...current, rating: event.target.value }));
          }}
        >
          {[5, 4, 3, 2, 1].map((rating) => (
            <option key={rating} value={rating}>
              {rating}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium text-stone-700">
        {translate(locale, "feedback.desiredFeatures")}
        <textarea
          className="control min-h-28 w-full"
          aria-label={translate(locale, "feedback.desiredFeatures")}
          maxLength={2000}
          value={values.desiredFeatures}
          disabled={mutation.isPending}
          onChange={(event) => {
            key.current = null;
            mutation.reset();
            setValues((current) => ({ ...current, desiredFeatures: event.target.value }));
          }}
          aria-invalid={values.desiredFeatures.length < 1 || undefined}
        />
        <span className="text-xs font-normal text-stone-500">
          {translate(locale, "feedback.requiredHint")}
        </span>
      </label>
      <label className="grid gap-1 text-sm font-medium text-stone-700">
        {translate(locale, "feedback.comment")}
        <textarea
          className="control min-h-24 w-full"
          aria-label={translate(locale, "feedback.comment")}
          maxLength={2000}
          value={values.comment}
          disabled={mutation.isPending}
          onChange={(event) => {
            key.current = null;
            mutation.reset();
            setValues((current) => ({ ...current, comment: event.target.value }));
          }}
        />
        <span className="text-xs font-normal text-stone-500">
          {translate(locale, "feedback.optionalHint")}
        </span>
      </label>
      {invalid && (
        <p role="alert" className="text-sm text-red-800">
          {translate(locale, "errors.validation")}
        </p>
      )}
      {conflict && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>{translate(locale, "feedback.conflict")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                submittedVersion.current = null;
                mutation.reset();
                void feedback.refetch();
              }}
            >
              {translate(locale, "actions.useLatest")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={mutation.isPending || invalid}
              onClick={() => {
                void feedback.refetch().then((latest) => {
                  version.current = latest.data?.data?.version ?? null;
                  submit(true);
                });
              }}
            >
              {translate(locale, "actions.overwrite")}
            </Button>
          </div>
        </div>
      )}
      <FormError locale={locale} error={mutation.error} />
      <div className="flex justify-end">
        <PendingButton
          type="submit"
          pending={mutation.isPending}
          pendingLabel={translate(locale, "feedback.pending")}
          disabled={invalid || conflict}
        >
          {translate(locale, "feedback.submit")}
        </PendingButton>
      </div>
    </form>
  );
}

export function FeedbackDialog({
  profile,
  open,
  onOpenChange,
  onSubmitted,
}: FeedbackFormProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const locale = localeFromProfile(profile);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/35" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold text-stone-950">
                {translate(locale, "feedback.title")}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-stone-600">
                {translate(locale, "feedback.description")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="icon-button"
                aria-label={translate(locale, "actions.close")}
              >
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </div>
          <div className="mt-5">
            <FeedbackForm
              profile={profile}
              onSubmitted={() => {
                onSubmitted?.();
                onOpenChange(false);
              }}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
