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

const invisibleControlPattern =
  /[\p{Cc}\u061c\u200b\u200e\u200f\u2060\u202a-\u202e\u2066-\u2069\ufeff]/u;

export const normalizeDisplayName = (value: string): string =>
  value
    .normalize("NFC")
    .replace(/\p{White_Space}+/gu, " ")
    .trim();

export const normalizedNameKey = (value: string): string =>
  normalizeDisplayName(value).normalize("NFKC").toLowerCase();

const displayNameSchema = z
  .string()
  .refine((value) => !invisibleControlPattern.test(value), "Name contains an unsupported character")
  .refine((value) => normalizeDisplayName(value).length >= 2, "Name must be at least 2 characters")
  .refine((value) => normalizeDisplayName(value).length <= 80, "Name must be at most 80 characters")
  .refine(
    (value) => normalizedNameKey(value).length <= 80,
    "Normalized name must be at most 80 characters",
  );

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
export const versionSchema = z.number().int().positive();
export const idempotencyKeySchema = uuidSchema;
export const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

export const logoutRequestSchema = z.strictObject({});

export const languageRequestSchema = z.strictObject({
  language: languageSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const locationInputSchema = z.strictObject({
  name: displayNameSchema,
});
export const onboardingRequestSchema = z
  .strictObject({
    networkName: displayNameSchema,
    ownerName: displayNameSchema,
    locations: z.array(locationInputSchema).min(1).max(5),
    country: countryCodeSchema,
    currency: currencyCodeSchema,
    timeZone: timeZoneSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .superRefine(({ locations }, context) => {
    const names = new Set<string>();
    for (const [index, location] of locations.entries()) {
      const key = normalizedNameKey(location.name);
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

export const profileSchema = z
  .strictObject({
    userId: uuidSchema,
    login: loginSchema,
    networkId: uuidSchema,
    networkName: z.string().nullable(),
    ownerName: z.string().nullable(),
    country: countryCodeSchema.nullable(),
    currency: currencyCodeSchema.nullable(),
    timeZone: timeZoneSchema.nullable(),
    language: languageSchema.nullable(),
    effectiveLanguage: languageSchema,
    onboardingCompletedAt: utcTimestampSchema.nullable(),
    demoGeneratorVersion: z.string().min(1).max(32).nullable(),
    demoGeneratedForDate: dateKeySchema.nullable(),
    demoDataRevision: z.number().int().nonnegative(),
    demoDataStale: z.boolean(),
    tourState: tourStateSchema,
    expiresAt: utcTimestampSchema.nullable(),
  })
  .superRefine((profile, context) => {
    const expectedLanguage = profile.language ?? "en";
    if (profile.effectiveLanguage !== expectedLanguage) {
      context.addIssue({
        code: "custom",
        path: ["effectiveLanguage"],
        message: "Effective language must match language or the en fallback",
      });
    }

    const isComplete = profile.onboardingCompletedAt !== null;
    if (!isComplete) {
      if (
        profile.demoGeneratorVersion !== null ||
        profile.demoGeneratedForDate !== null ||
        profile.demoDataRevision !== 0 ||
        profile.demoDataStale
      ) {
        context.addIssue({
          code: "custom",
          path: ["demoDataRevision"],
          message: "Incomplete onboarding cannot expose generated demo data",
        });
      }
      return;
    }

    if (
      profile.demoGeneratorVersion === null ||
      profile.demoGeneratedForDate === null ||
      profile.demoDataRevision < 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["demoGeneratorVersion"],
        message: "Completed onboarding requires a pinned demo generation",
      });
    }
  });

export const sessionStateSchema = z.strictObject({
  authenticated: z.literal(true),
  profile: profileSchema,
});

export const sessionResponseSchema = createSuccessEnvelopeSchema(sessionStateSchema);

export const demoCountsSchema = z.strictObject({
  locations: z.number().int().nonnegative(),
  categories: z.number().int().nonnegative(),
  products: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
  orderItems: z.number().int().nonnegative(),
  inventoryItems: z.number().int().nonnegative(),
  inventoryBalances: z.number().int().nonnegative(),
  inventoryMovements: z.number().int().nonnegative(),
  revenueTargets: z.number().int().nonnegative(),
});

export const demoGenerationSchema = z.strictObject({
  version: z.string().min(1).max(32),
  generatedForDate: dateKeySchema,
  anchor: utcTimestampSchema,
  seed: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  stale: z.boolean(),
});

export const onboardingLanguageDataSchema = z.strictObject({
  language: languageSchema,
  effectiveLanguage: languageSchema,
});
export const onboardingLanguageResponseSchema = createSuccessEnvelopeSchema(
  onboardingLanguageDataSchema,
);

export const onboardingCompleteDataSchema = z
  .strictObject({
    profile: profileSchema,
    generation: demoGenerationSchema,
    counts: demoCountsSchema,
  })
  .superRefine(({ profile, generation }, context) => {
    if (
      profile.demoGeneratorVersion !== generation.version ||
      profile.demoGeneratedForDate !== generation.generatedForDate ||
      profile.demoDataRevision !== generation.revision ||
      profile.demoDataStale !== generation.stale
    ) {
      context.addIssue({
        code: "custom",
        path: ["generation"],
        message: "Profile and generation state must come from one observation",
      });
    }
  });
export const onboardingCompleteResponseSchema = createSuccessEnvelopeSchema(
  onboardingCompleteDataSchema,
);

export const resetResultDataSchema = onboardingCompleteDataSchema;
export const resetResultResponseSchema = createSuccessEnvelopeSchema(resetResultDataSchema);

export const logoutStateSchema = z.strictObject({
  authenticated: z.literal(false),
});

export const logoutResponseSchema = createSuccessEnvelopeSchema(logoutStateSchema);

const rawLocationIdSchema = z.string().trim().min(1).max(64);
export const locationSortBySchema = z.enum([
  "revenue",
  "grossProfit",
  "orders",
  "averageCheck",
  "grossMargin",
  "activeAlerts",
  "name",
]);
export const sortDirectionSchema = z.enum(["asc", "desc"]);
export const analyticsWarningSchema = z.strictObject({
  code: z.literal("INVALID_LOCATION_FALLBACK"),
  field: z.literal("locationId"),
});
export const analyticsAppliedFiltersSchema = z.strictObject({
  period: periodSchema,
  locationId: uuidSchema.nullable(),
  status: stockStatusSchema.nullable(),
  sortBy: locationSortBySchema.nullable(),
  sortDir: sortDirectionSchema.nullable(),
});
export const paginationModeSchema = z.enum(["none", "cursor", "page"]);
export const paginationMetaSchema = z.strictObject({
  mode: paginationModeSchema,
  page: z.number().int().min(1).nullable(),
  pageSize: z.number().int().min(1).max(100).nullable(),
  nextCursor: z.string().min(1).max(1024).nullable(),
  pageContext: z.string().min(1).max(2048).nullable(),
});
export const analyticsMetaSchema = z.strictObject({
  asOf: utcTimestampSchema,
  demoDataRevision: versionSchema,
  appliedFilters: analyticsAppliedFiltersSchema,
  warnings: z.array(analyticsWarningSchema),
  pagination: paginationMetaSchema,
});

export const analyticsFilterQuerySchema = z.strictObject({
  locationId: rawLocationIdSchema.optional(),
  period: periodSchema.default("today"),
});
export const analyticsQuerySchema = analyticsFilterQuerySchema.extend({
  cursor: z.string().min(1).max(1024).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export const locationsQuerySchema = analyticsFilterQuerySchema.extend({
  sortBy: locationSortBySchema.default("revenue"),
  sortDir: sortDirectionSchema.default("desc"),
});
export const salesQuerySchema = analyticsFilterQuerySchema.extend({
  cursor: z.string().min(1).max(1024).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  pageContext: z.string().min(1).max(2048).optional(),
});
export const inventoryQuerySchema = analyticsFilterQuerySchema.extend({
  status: stockStatusSchema.optional(),
  cursor: z.string().min(1).max(1024).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
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
export const overviewKpisSchema = z.strictObject({
  revenue: moneyMetricSchema,
  grossProfit: moneyMetricSchema,
  orders: countMetricSchema,
  averageCheck: nullableMoneyMetricSchema,
  grossMargin: percentageMetricSchema,
  activeAlerts: countMetricSchema,
});
export const salesKpisSchema = financialKpisSchema;

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
  version: versionSchema,
  completionPercent: percentageSchema.nullable(),
  scope: z.literal("network"),
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
  kpis: overviewKpisSchema,
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
});

export const locationAnalyticsSchema = z.strictObject({
  locationId: uuidSchema,
  name: z.string(),
  kpis: overviewKpisSchema,
  performance: z.enum(["best", "weak", "standard"]),
});
export const locationsDataSchema = z.strictObject({
  period: periodSchema,
  locationId: uuidSchema.nullable(),
  window: periodWindowSchema,
  sortBy: locationSortBySchema,
  sortDir: sortDirectionSchema,
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
  status: z.enum(["completed", "cancelled"]),
  total: moneySchema,
  items: z.array(recentOrderItemSchema),
});
export const salesDataSchema = z.strictObject({
  period: periodSchema,
  locationId: uuidSchema.nullable(),
  window: periodWindowSchema,
  kpis: salesKpisSchema,
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
  inventoryItemName: z.string(),
  productId: uuidSchema.nullable(),
  productName: z.string().nullable(),
  locationId: uuidSchema,
  locationName: z.string(),
  unit: z.enum(["pcs", "kg", "l"]),
  onHand: quantitySchema,
  minThreshold: quantitySchema,
  status: stockStatusSchema,
});
export const inventoryMovementSchema = z.strictObject({
  movementId: uuidSchema,
  inventoryItemId: uuidSchema,
  inventoryItemName: z.string(),
  locationId: uuidSchema,
  locationName: z.string(),
  type: movementTypeSchema,
  quantity: positiveQuantitySchema,
  occurredAt: utcTimestampSchema,
});
export const inventoryDataSchema = z.strictObject({
  period: periodSchema,
  locationId: uuidSchema.nullable(),
  window: periodWindowSchema,
  status: stockStatusSchema.nullable(),
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
  categoryId: uuidSchema,
  categoryName: z.string(),
  active: z.boolean(),
  currentPrice: nonNegativeMoneySchema,
  currentUnitCost: nonNegativeMoneySchema,
  unitContribution: moneySchema,
  currentUnitMargin: percentageSchema.nullable(),
  version: versionSchema,
  unitsSold: quantitySchema,
  revenue: moneySchema,
  grossProfit: moneySchema,
  grossMargin: percentageSchema.nullable(),
  revenueShare: percentageSchema.nullable(),
  balances: z.array(
    z.strictObject({
      locationId: uuidSchema,
      locationName: z.string(),
      onHand: quantitySchema,
      status: stockStatusSchema,
    }),
  ),
  menuGroup: menuGroupSchema.nullable(),
  recommendation: menuRecommendationSchema.nullable(),
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

export const overviewResponseSchema = createSuccessEnvelopeSchema(
  overviewDataSchema,
  analyticsMetaSchema,
);
export const locationsResponseSchema = createSuccessEnvelopeSchema(
  locationsDataSchema,
  analyticsMetaSchema,
);
export const salesResponseSchema = createSuccessEnvelopeSchema(
  salesDataSchema,
  analyticsMetaSchema,
);
export const productsResponseSchema = createSuccessEnvelopeSchema(
  productsDataSchema,
  analyticsMetaSchema,
);
export const inventoryResponseSchema = createSuccessEnvelopeSchema(
  inventoryDataSchema,
  analyticsMetaSchema,
);

export const priceMutationSchema = z.strictObject({
  price: nonNegativeMoneySchema,
  expectedVersion: versionSchema,
  expectedDemoDataRevision: versionSchema.default(1),
  idempotencyKey: idempotencyKeySchema,
});
export const priceMutationDataSchema = z.strictObject({
  productId: uuidSchema,
  currentPrice: nonNegativeMoneySchema,
  currentUnitCost: nonNegativeMoneySchema,
  unitContribution: moneySchema,
  currentUnitMargin: percentageSchema.nullable(),
  version: versionSchema,
  demoDataRevision: versionSchema,
});
export const priceMutationResponseSchema = createSuccessEnvelopeSchema(priceMutationDataSchema);
export const inventoryMovementMutationSchema = z.strictObject({
  inventoryItemId: uuidSchema,
  locationId: uuidSchema,
  type: movementTypeSchema,
  quantity: positiveQuantitySchema,
  expectedDemoDataRevision: versionSchema.default(1),
  idempotencyKey: idempotencyKeySchema,
});
export const inventoryMovementMutationDataSchema = z.strictObject({
  movement: inventoryMovementSchema,
  balance: inventoryBalanceSchema,
  demoDataRevision: versionSchema,
});
export const inventoryMovementMutationResponseSchema = createSuccessEnvelopeSchema(
  inventoryMovementMutationDataSchema,
);
export const revenueGoalMutationSchema = z.strictObject({
  monthlyGoal: nonNegativeMoneySchema,
  expectedVersion: versionSchema.nullable(),
  expectedDemoDataRevision: versionSchema.default(1),
  idempotencyKey: idempotencyKeySchema,
});
export const revenueGoalMutationDataSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  monthlyGoal: nonNegativeMoneySchema.nullable(),
  version: versionSchema.nullable(),
  demoDataRevision: versionSchema,
});
export const revenueGoalMutationResponseSchema = createSuccessEnvelopeSchema(
  revenueGoalMutationDataSchema,
);
export const tourMutationSchema = z.strictObject({
  state: tourStateSchema,
  idempotencyKey: idempotencyKeySchema,
});
export const tourStateDataSchema = z.strictObject({
  state: tourStateSchema,
});
export const tourStateResponseSchema = createSuccessEnvelopeSchema(tourStateDataSchema);
export const feedbackMutationSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional().default(""),
  desiredFeatures: z.string().min(1).max(2000),
  expectedVersion: versionSchema.nullable(),
  idempotencyKey: idempotencyKeySchema,
});
export const feedbackResponseDataSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000),
  desiredFeatures: z.string().min(1).max(2000),
  version: versionSchema,
  submittedAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
});
export const feedbackResponseSchema = createSuccessEnvelopeSchema(
  feedbackResponseDataSchema.nullable(),
);
export const resetMutationSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});

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

/** Browser telemetry is intentionally limited to navigation and filter events. */
export const productEventRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    eventId: uuidSchema,
    type: z.literal("section_viewed"),
    route: sectionSchema.optional(),
    metadata: productEventMetadataSchemas.section_viewed,
  }),
  z.strictObject({
    eventId: uuidSchema,
    type: z.literal("filter_changed"),
    route: sectionSchema.optional(),
    metadata: productEventMetadataSchemas.filter_changed,
  }),
]);

/** Business events are emitted by trusted server paths, never accepted from the browser. */
export const serverProductEventRequestSchema = z.discriminatedUnion("type", [
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

export const productEventResponseSchema = createSuccessEnvelopeSchema(
  z.strictObject({ eventId: uuidSchema }),
);

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type DemoCounts = z.infer<typeof demoCountsSchema>;
export type DemoGeneration = z.infer<typeof demoGenerationSchema>;
export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>;
export type TourState = z.infer<typeof tourStateSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type OverviewData = z.infer<typeof overviewDataSchema>;
export type LocationsData = z.infer<typeof locationsDataSchema>;
export type SalesData = z.infer<typeof salesDataSchema>;
export type ProductsData = z.infer<typeof productsDataSchema>;
export type ProductAnalytics = z.infer<typeof productAnalyticsSchema>;
export type InventoryData = z.infer<typeof inventoryDataSchema>;
export type PriceMutation = z.infer<typeof priceMutationSchema>;
export type InventoryMovementMutation = z.infer<typeof inventoryMovementMutationSchema>;
export type RevenueGoalMutation = z.infer<typeof revenueGoalMutationSchema>;
export type FeedbackMutation = z.infer<typeof feedbackMutationSchema>;
export type FeedbackResponseData = z.infer<typeof feedbackResponseDataSchema>;
export type ProductEventType = z.infer<typeof productEventTypeSchema>;
export type ProductEventRequest = z.infer<typeof productEventRequestSchema>;
export type ServerProductEventRequest = z.infer<typeof serverProductEventRequestSchema>;
export type ProductEventResponse = z.infer<typeof productEventResponseSchema>;
