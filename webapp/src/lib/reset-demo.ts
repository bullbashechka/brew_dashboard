import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Profile } from "@brew-dashboard/contracts";
import { useRef } from "react";
import { toast } from "sonner";

import { resetDemoData } from "@/api/demo";
import { sessionQueryKey } from "@/api/session";
import { translate, type AppLocale } from "@/lib/i18n";

export const useResetDemoData = (locale: AppLocale, onCompleted?: () => void) => {
  const queryClient = useQueryClient();
  const idempotencyKey = useRef<string | null>(null);

  return useMutation({
    mutationFn: () => {
      idempotencyKey.current ??= crypto.randomUUID();
      return resetDemoData(idempotencyKey.current);
    },
    onSuccess: async (response) => {
      queryClient.setQueryData<Profile | null>(sessionQueryKey, response.data.profile);
      await queryClient.invalidateQueries({
        queryKey: ["tenant", response.data.profile.networkId],
      });
      idempotencyKey.current = null;
      onCompleted?.();
      toast.success(translate(locale, "reset.complete"));
    },
  });
};
