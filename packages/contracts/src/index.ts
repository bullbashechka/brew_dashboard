import { z } from "zod";

const isValidTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

const isIsoRegion = (value: string): boolean => {
  if (!/^[A-Z]{2}$/.test(value)) {
    return false;
  }
  const displayName = new Intl.DisplayNames(["en"], { type: "region" }).of(value);
  return Boolean(displayName && displayName !== value && displayName !== "Unknown Region");
};

const isIsoCurrency = (value: string): boolean =>
  /^[A-Z]{3}$/.test(value) && Intl.supportedValuesOf("currency").includes(value);

const moneyPattern = /^-?(?:0|[1-9]\d{0,11})\.\d{2}$/;
const nonNegativeMoneyPattern = /^(?:0|[1-9]\d{0,11})\.\d{2}$/;
const percentagePattern = /^-?(?:0|[1-9]\d{0,6})\.\d{2}$/;
const quantityPattern = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/;

export const uuidSchema = z.uuid();
export const moneySchema = z
  .string()
  .regex(moneyPattern, "Expected a decimal money value with two places");
export const nonNegativeMoneySchema = z
  .string()
  .regex(nonNegativeMoneyPattern, "Expected a non-negative decimal money value with two places");
export const percentageSchema = z
  .string()
  .regex(percentagePattern, "Expected a percentage with two places");
export const quantitySchema = z
  .string()
  .regex(quantityPattern, "Expected a non-negative quantity with up to three places");
export const positiveQuantitySchema = quantitySchema.refine(
  (value) => !/^0(?:\.0{1,3})?$/.test(value),
  {
    message: "Quantity must be greater than zero",
  },
);
export const utcTimestampSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), "Expected a UTC timestamp");
export const languageSchema = z.enum(["en", "ru"]);
export const periodSchema = z.enum(["today", "7d", "30d", "6m"]);
export const stockStatusSchema = z.enum(["in_stock", "low_stock", "out_of_stock"]);
export const alertTypeSchema = z.enum(["LOW_STOCK", "OUT_OF_STOCK", "SALES_DROP"]);
export const menuGroupSchema = z.enum(["stars", "workhorses", "puzzles", "dogs"]);
export const tourStateSchema = z.enum(["pending", "completed", "skipped"]);
export const movementTypeSchema = z.enum(["receipt", "writeoff"]);
export const sectionSchema = z.enum([
  "overview",
  "locations",
  "sales",
  "products",
  "inventory",
  "settings",
]);

export const countryCodeSchema = z
  .string()
  .refine(isIsoRegion, "Expected an ISO 3166-1 alpha-2 country code");
export const currencyCodeSchema = z
  .string()
  .refine(isIsoCurrency, "Expected an ISO 4217 currency code");
export const timeZoneSchema = z.string().refine(isValidTimeZone, "Expected an IANA timezone");

export const apiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const fieldErrorsSchema = z.record(z.string(), z.array(z.string()));
export const apiMetaSchema = z.record(z.string(), z.unknown());

export type ApiSuccess<TData, TMeta = Record<string, unknown>> = {
  data: TData;
  meta: TMeta;
  requestId: string;
};

export function createSuccessEnvelopeSchema<
  TData extends z.ZodType,
  TMeta extends z.ZodType = typeof apiMetaSchema,
>(data: TData, meta?: TMeta) {
  return z.strictObject({
    data,
    meta: (meta ?? apiMetaSchema) as TMeta,
    requestId: uuidSchema,
  });
}

export const healthDataSchema = z.strictObject({
  status: z.literal("ok"),
});

export const healthResponseSchema = createSuccessEnvelopeSchema(healthDataSchema);

export const apiErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  fields: fieldErrorsSchema,
  message: z.string().min(1),
});

export const apiErrorResponseSchema = z.strictObject({
  error: apiErrorSchema,
  requestId: uuidSchema,
});

export const loginSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9._-]{3,64}$/,
    "Login must be 3–64 Latin letters, numbers, dots, underscores or hyphens",
  );
export const passwordSchema = z.string().min(12).max(128);
export const loginRequestSchema = z.strictObject({
  login: loginSchema,
  password: passwordSchema,
});

export const languageRequestSchema = z.strictObject({
  language: languageSchema,
});

export const locationInputSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
});
export const onboardingRequestSchema = z
  .strictObject({
    networkName: z.string().trim().min(2).max(80),
    ownerName: z.string().trim().min(2).max(80),
    locations: z.array(locationInputSchema).min(1).max(5),
    country: countryCodeSchema,
    currency: currencyCodeSchema,
    timeZone: timeZoneSchema,
  })
  .superRefine(({ locations }, context) => {
    const names = new Set<string>();
    for (const [index, location] of locations.entries()) {
      const key = location.name.toLowerCase();
      if (names.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["locations", index, "name"],
          message: "Location names must be unique",
        });
      }
      names.add(key);
    }
  });

export const profileSchema = z.strictObject({
  userId: uuidSchema,
  login: loginSchema,
  networkId: uuidSchema,
  networkName: z.string(),
  ownerName: z.string(),
  country: countryCodeSchema,
  currency: currencyCodeSchema,
  timeZone: timeZoneSchema,
  language: languageSchema,
  onboardingCompletedAt: utcTimestampSchema.nullable(),
  tourState: tourStateSchema,
  expiresAt: utcTimestampSchema.nullable(),
});

export const sessionStateSchema = z.strictObject({
  authenticated: z.literal(true),
  profile: profileSchema,
});

export const analyticsQuerySchema = z.strictObject({
  locationId: uuidSchema.optional(),
  period: periodSchema.default("today"),
  cursor: z.string().min(1).max(512).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const paginationMetaSchema = z.strictObject({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  nextCursor: z.string().min(1).max(512).nullable().optional(),
});

export const periodWindowSchema = z.strictObject({
  start: utcTimestampSchema,
  end: utcTimestampSchema,
  comparisonStart: utcTimestampSchema,
  comparisonEnd: utcTimestampSchema,
});

export const moneyMetricSchema = z.strictObject({
  value: moneySchema,
  previousValue: moneySchema,
  changePercent: percentageSchema.nullable(),
});
export const nullableMoneyMetricSchema = z.strictObject({
  value: moneySchema.nullable(),
  previousValue: moneySchema.nullable(),
  changePercent: percentageSchema.nullable(),
});
export const countMetricSchema = z.strictObject({
  value: z.number().int().nonnegative(),
  previousValue: z.number().int().nonnegative(),
  changePercent: percentageSchema.nullable(),
});
export const percentageMetricSchema = z.strictObject({
  value: percentageSchema.nullable(),
  previousValue: percentageSchema.nullable(),
  changePercent: percentageSchema.nullable(),
});
export const financialKpisSchema = z.strictObject({
  revenue: moneyMetricSchema,
  cogs: moneyMetricSchema,
  grossProfit: moneyMetricSchema,
  grossMargin: percentageMetricSchema,
  orders: countMetricSchema,
  averageCheck: nullableMoneyMetricSchema,
});

export const alertSchema = z.strictObject({
  id: uuidSchema,
  type: alertTypeSchema,
  locationId: uuidSchema,
  locationName: z.string(),
  entityId: uuidSchema.nullable(),
  entityName: z.string().nullable(),
  currentValue: z.string().nullable(),
  previousValue: z.string().nullable(),
  threshold: z.string().nullable(),
});

export const stockSummarySchema = z.strictObject({
  inStock: z.number().int().nonnegative(),
  lowStock: z.number().int().nonnegative(),
  outOfStock: z.number().int().nonnegative(),
});

export const trendPointSchema = z.strictObject({
  bucket: z.string().min(1),
  revenue: moneySchema,
  grossProfit: moneySchema,
  comparisonRevenue: moneySchema.nullable(),
  comparisonGrossProfit: moneySchema.nullable(),
});

export const goalSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  revenue: moneySchema,
  target: nonNegativeMoneySchema,
  completionPercent: percentageSchema.nullable(),
});

export const productSummarySchema = z.strictObject({
  productId: uuidSchema,
  name: z.string(),
  categoryName: z.string(),
  unitsSold: quantitySchema,
  revenue: moneySchema,
  grossProfit: moneySchema,
  grossMargin: percentageSchema.nullable(),
  revenueShare: percentageSchema.nullable(),
});

export const overviewDataSchema = z.strictObject({
  period: periodSchema,
  locationId: uuidSchema.nullable(),
  window: periodWindowSchema,
  kpis: financialKpisSchema,
  trend: z.array(trendPointSchema),
  goal: goalSchema.nullable(),
  locations: z.array(
    z.strictObject({
      locationId: uuidSchema,
      name: z.string(),
      revenue: moneySchema,
      grossProfit: moneySchema,
      orders: z.number().int().nonnegative(),
      activeAlerts: z.number().int().nonnegative(),
    }),
  ),
  topProducts: z.array(productSummarySchema),
  bottomProducts: z.array(productSummarySchema),
  stockSummary: stockSummarySchema,
  alerts: z.array(alertSchema),
  activeAlerts: z.number().int().nonnegative(),
});

export const locationAnalyticsSchema = z.strictObject({
  locationId: uuidSchema,
  name: z.string(),
  kpis: financialKpisSchema,
  activeAlerts: z.number().int().nonnegative(),
  performance: z.enum(["best", "weak", "standard"]),
});
export const locationsDataSchema = z.strictObject({
  period: periodSchema,
  window: periodWindowSchema,
  locations: z.array(locationAnalyticsSchema),
});

export const salesBreakdownSchema = z.strictObject({
  id: uuidSchema,
  name: z.string(),
  revenue: moneySchema,
  grossProfit: moneySchema,
  orders: z.number().int().nonnegative(),
  unitsSold: quantitySchema,
});
export const heatmapCellSchema = z.strictObject({
  weekday: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  revenue: moneySchema,
  orders: z.number().int().nonnegative(),
});
export const recentOrderItemSchema = z.strictObject({
  productId: uuidSchema,
  productName: z.string(),
  quantity: quantitySchema,
  unitPriceAtSale: moneySchema,
  lineRevenue: moneySchema,
});
export const recentOrderSchema = z.strictObject({
  orderId: uuidSchema,
  locationId: uuidSchema,
  locationName: z.string(),
  occurredAt: utcTimestampSchema,
  total: moneySchema,
  items: z.array(recentOrderItemSchema).min(1),
});
export const salesDataSchema = z.strictObject({
  period: periodSchema,
  locationId: uuidSchema.nullable(),
  window: periodWindowSchema,
  kpis: financialKpisSchema,
  dailySeries: z.array(trendPointSchema),
  heatmap: z.array(heatmapCellSchema),
  peakHours: z.array(
    z.strictObject({
      weekday: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      orders: z.number().int().nonnegative(),
    }),
  ),
  locations: z.array(salesBreakdownSchema),
  categories: z.array(salesBreakdownSchema),
  products: z.array(salesBreakdownSchema),
  recentOrders: z.array(recentOrderSchema),
});

export const inventoryBalanceSchema = z.strictObject({
  inventoryItemId: uuidSchema,
  productName: z.string(),
  locationId: uuidSchema,
  locationName: z.string(),
  unit: z.string(),
  onHand: quantitySchema,
  minThreshold: quantitySchema,
  status: stockStatusSchema,
});
export const inventoryMovementSchema = z.strictObject({
  movementId: uuidSchema,
  inventoryItemId: uuidSchema,
  locationId: uuidSchema,
  type: movementTypeSchema,
  quantity: positiveQuantitySchema,
  occurredAt: utcTimestampSchema,
});
export const inventoryDataSchema = z.strictObject({
  period: periodSchema,
  locationId: uuidSchema.nullable(),
  balances: z.array(inventoryBalanceSchema),
  movements: z.array(inventoryMovementSchema),
  alerts: z.array(alertSchema),
});

export const menuRecommendationSchema = z.enum([
  "protect_and_promote",
  "improve_margin",
  "promote_and_test",
  "review_or_remove",
]);
export const productAnalyticsSchema = z.strictObject({
  productId: uuidSchema,
  name: z.string(),
  categoryName: z.string(),
  currentPrice: nonNegativeMoneySchema,
  currentUnitCost: nonNegativeMoneySchema,
  unitsSold: quantitySchema,
  revenue: moneySchema,
  grossProfit: moneySchema,
  grossMargin: percentageSchema.nullable(),
  revenueShare: percentageSchema.nullable(),
  balances: z.array(
    z.strictObject({
      locationId: uuidSchema,
      onHand: quantitySchema,
      status: stockStatusSchema,
    }),
  ),
  menuGroup: menuGroupSchema,
  recommendation: menuRecommendationSchema,
});
export const productsDataSchema = z.strictObject({
  period: periodSchema,
  locationId: uuidSchema.nullable(),
  window: periodWindowSchema,
  medians: z.strictObject({
    unitsSold: quantitySchema,
    unitContribution: moneySchema,
  }),
  categories: z.array(z.strictObject({ categoryId: uuidSchema, name: z.string() })),
  products: z.array(productAnalyticsSchema),
});

export const overviewResponseSchema = createSuccessEnvelopeSchema(overviewDataSchema);
export const locationsResponseSchema = createSuccessEnvelopeSchema(locationsDataSchema);
export const salesResponseSchema = createSuccessEnvelopeSchema(
  salesDataSchema,
  paginationMetaSchema,
);
export const productsResponseSchema = createSuccessEnvelopeSchema(productsDataSchema);
export const inventoryResponseSchema = createSuccessEnvelopeSchema(
  inventoryDataSchema,
  paginationMetaSchema,
);

export const priceMutationSchema = z.strictObject({
  price: nonNegativeMoneySchema,
});
export const inventoryMovementMutationSchema = z.strictObject({
  inventoryItemId: uuidSchema,
  locationId: uuidSchema,
  type: movementTypeSchema,
  quantity: positiveQuantitySchema,
});
export const revenueGoalMutationSchema = z.strictObject({
  monthlyGoal: nonNegativeMoneySchema,
});
export const tourMutationSchema = z.strictObject({
  state: tourStateSchema,
});
export const feedbackMutationSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional().default(""),
  desiredFeatures: z.string().min(1).max(2000),
});
export const resetMutationSchema = z.strictObject({});

export const productEventMetadataSchemas = {
  login_succeeded: z.strictObject({}),
  onboarding_completed: z.strictObject({ locationCount: z.number().int().min(1).max(5) }),
  section_viewed: z.strictObject({ section: sectionSchema }),
  filter_changed: z.strictObject({
    filter: z.enum(["location", "period"]),
    period: periodSchema,
    locationId: uuidSchema.nullable(),
  }),
  product_price_changed: z.strictObject({ productId: uuidSchema }),
  inventory_movement_created: z.strictObject({
    inventoryItemId: uuidSchema,
    locationId: uuidSchema,
    type: movementTypeSchema,
  }),
  revenue_goal_changed: z.strictObject({}),
  demo_reset: z.strictObject({ generatorVersion: z.string().min(1).max(32) }),
  feedback_submitted: z.strictObject({ rating: z.number().int().min(1).max(5) }),
} as const;

export const productEventTypeSchema = z.enum([
  "login_succeeded",
  "onboarding_completed",
  "section_viewed",
  "filter_changed",
  "product_price_changed",
  "inventory_movement_created",
  "revenue_goal_changed",
  "demo_reset",
  "feedback_submitted",
]);

export const productEventRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("login_succeeded"),
    route: sectionSchema.optional(),
    metadata: productEventMetadataSchemas.login_succeeded,
  }),
  z.strictObject({
    type: z.literal("onboarding_completed"),
    route: sectionSchema.optional(),
    metadata: productEventMetadataSchemas.onboarding_completed,
  }),
  z.strictObject({
    type: z.literal("section_viewed"),
    route: sectionSchema.optional(),
    metadata: productEventMetadataSchemas.section_viewed,
  }),
  z.strictObject({
    type: z.literal("filter_changed"),
    route: sectionSchema.optional(),
    metadata: productEventMetadataSchemas.filter_changed,
  }),
  z.strictObject({
    type: z.literal("product_price_changed"),
    route: sectionSchema.optional(),
    metadata: productEventMetadataSchemas.product_price_changed,
  }),
  z.strictObject({
    type: z.literal("inventory_movement_created"),
    route: sectionSchema.optional(),
    metadata: productEventMetadataSchemas.inventory_movement_created,
  }),
  z.strictObject({
    type: z.literal("revenue_goal_changed"),
    route: sectionSchema.optional(),
    metadata: productEventMetadataSchemas.revenue_goal_changed,
  }),
  z.strictObject({
    type: z.literal("demo_reset"),
    route: sectionSchema.optional(),
    metadata: productEventMetadataSchemas.demo_reset,
  }),
  z.strictObject({
    type: z.literal("feedback_submitted"),
    route: sectionSchema.optional(),
    metadata: productEventMetadataSchemas.feedback_submitted,
  }),
]);

export const storedProductEventSchema = z.strictObject({
  eventId: uuidSchema,
  userId: uuidSchema,
  networkId: uuidSchema,
  type: productEventTypeSchema,
  route: sectionSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
  occurredAt: utcTimestampSchema,
});

export type HealthData = z.infer<typeof healthDataSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type FinancialKpis = z.infer<typeof financialKpisSchema>;
export type OverviewData = z.infer<typeof overviewDataSchema>;
export type LocationsData = z.infer<typeof locationsDataSchema>;
export type SalesData = z.infer<typeof salesDataSchema>;
export type ProductsData = z.infer<typeof productsDataSchema>;
export type InventoryData = z.infer<typeof inventoryDataSchema>;
export type ProductEventRequest = z.infer<typeof productEventRequestSchema>;
