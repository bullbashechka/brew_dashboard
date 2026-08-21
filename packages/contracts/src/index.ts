import { z } from "zod";

export const healthDataSchema = z.object({
  status: z.literal("ok"),
});

export const healthResponseSchema = z.object({
  data: healthDataSchema,
  meta: z.record(z.string(), z.unknown()),
  requestId: z.uuid(),
});

export type HealthData = z.infer<typeof healthDataSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
