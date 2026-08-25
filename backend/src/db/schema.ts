import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const auth = pgSchema("auth");
const app = pgSchema("app");

const timestampColumns = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
};

const tenantExpression = (column: string) =>
  sql.raw(`"${column}" = nullif(current_setting('app.network_id', true), '')::uuid`);

const tenantPolicy = (name: string, column = "network_id") =>
  pgPolicy(`${name}_tenant_isolation`, {
    as: "permissive",
    for: "all",
    to: "public",
    using: tenantExpression(column),
    withCheck: tenantExpression(column),
  });

export const authUsers = auth.table("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  username: text("username").unique(),
  displayUsername: text("display_username"),
  ...timestampColumns,
});

export const authSessions = auth.table(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    ...timestampColumns,
  },
  (table) => [index("auth_sessions_user_id_idx").on(table.userId)],
);

export const authAccounts = auth.table(
  "accounts",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("auth_accounts_issuer_account_id_uidx").on(table.issuer, table.accountId),
    index("auth_accounts_user_id_idx").on(table.userId),
  ],
);

export const authVerifications = auth.table(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    ...timestampColumns,
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);

export const authRateLimits = auth.table("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const accountStatus = app.enum("account_status", ["active", "disabled"]);
export const accountKind = app.enum("account_kind", ["demo", "e2e"]);
export const language = app.enum("language", ["en", "ru"]);
export const orderStatus = app.enum("order_status", ["completed", "cancelled"]);
export const movementType = app.enum("movement_type", ["receipt", "writeoff"]);
export const inventoryUnit = app.enum("inventory_unit", ["pcs", "kg", "l"]);
export const productEventType = app.enum("product_event_type", [
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

export const networks = app
  .table(
    "networks",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      name: varchar("name", { length: 80 }),
      ownerName: varchar("owner_name", { length: 80 }),
      countryCode: varchar("country_code", { length: 2 }),
      currencyCode: varchar("currency_code", { length: 3 }),
      timezone: text("timezone"),
      language: language("language"),
      onboardingCompletedAt: timestamp("onboarding_completed_at", {
        withTimezone: true,
        mode: "date",
      }),
      demoGeneratorVersion: varchar("demo_generator_version", { length: 32 }),
      demoGeneratedForDate: date("demo_generated_for_date"),
      demoDataRevision: integer("demo_data_revision").default(0).notNull(),
      ...timestampColumns,
    },
    (table) => [
      check(
        "networks_country_code_format_check",
        sql`${table.countryCode} is null or ${table.countryCode} ~ '^[A-Z]{2}$'`,
      ),
      check(
        "networks_currency_code_format_check",
        sql`${table.currencyCode} is null or ${table.currencyCode} ~ '^[A-Z]{3}$'`,
      ),
      check(
        "networks_name_length_check",
        sql`${table.name} is null or char_length(btrim(${table.name})) between 2 and 80`,
      ),
      check(
        "networks_owner_name_length_check",
        sql`${table.ownerName} is null or char_length(btrim(${table.ownerName})) between 2 and 80`,
      ),
      check("networks_demo_data_revision_check", sql`${table.demoDataRevision} >= 0`),
      tenantPolicy("networks", "id"),
    ],
  )
  .enableRLS();

export const appUsers = app.table(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authUserId: text("auth_user_id")
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    loginNormalized: varchar("login_normalized", { length: 64 }).notNull().unique(),
    networkId: uuid("network_id")
      .notNull()
      .unique()
      .references(() => networks.id, { onDelete: "cascade" }),
    status: accountStatus("status").default("active").notNull(),
    accountKind: accountKind("account_kind").default("demo").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }),
    tourCompletedAt: timestamp("tour_completed_at", { withTimezone: true, mode: "date" }),
    tourSkippedAt: timestamp("tour_skipped_at", { withTimezone: true, mode: "date" }),
    ...timestampColumns,
  },
  (table) => [
    check("app_users_login_format_check", sql`${table.loginNormalized} ~ '^[a-z0-9._-]{3,64}$'`),
    check(
      "app_users_tour_terminal_state_check",
      sql`not (${table.tourCompletedAt} is not null and ${table.tourSkippedAt} is not null)`,
    ),
    unique("app_users_network_id_id_unique").on(table.networkId, table.id),
    index("app_users_status_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const locations = app
  .table(
    "locations",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      name: varchar("name", { length: 80 }).notNull(),
      nameNormalized: varchar("name_normalized", { length: 80 }).notNull(),
      sortOrder: integer("sort_order").notNull(),
      ...timestampColumns,
    },
    (table) => [
      unique("locations_network_id_id_unique").on(table.networkId, table.id),
      unique("locations_network_name_normalized_unique").on(table.networkId, table.nameNormalized),
      index("locations_network_id_idx").on(table.networkId),
      tenantPolicy("locations"),
    ],
  )
  .enableRLS();

export const categories = app
  .table(
    "categories",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      name: varchar("name", { length: 80 }).notNull(),
      sortOrder: integer("sort_order").notNull(),
      ...timestampColumns,
    },
    (table) => [
      unique("categories_network_id_id_unique").on(table.networkId, table.id),
      index("categories_network_id_idx").on(table.networkId),
      tenantPolicy("categories"),
    ],
  )
  .enableRLS();

export const products = app
  .table(
    "products",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      categoryId: uuid("category_id").notNull(),
      name: varchar("name", { length: 120 }).notNull(),
      currentPrice: numeric("current_price").notNull(),
      currentUnitCost: numeric("current_unit_cost").notNull(),
      active: boolean("active").default(true).notNull(),
      version: integer("version").default(1).notNull(),
      ...timestampColumns,
    },
    (table) => [
      unique("products_network_id_id_unique").on(table.networkId, table.id),
      foreignKey({
        columns: [table.networkId, table.categoryId],
        foreignColumns: [categories.networkId, categories.id],
        name: "products_network_category_fk",
      }).onDelete("cascade"),
      check(
        "products_current_price_format_check",
        sql`${table.currentPrice} >= 0 and ${table.currentPrice} < 1000000000000 and ${table.currentPrice} = trunc(${table.currentPrice}, 2)`,
      ),
      check(
        "products_current_unit_cost_format_check",
        sql`${table.currentUnitCost} >= 0 and ${table.currentUnitCost} < 1000000000000 and ${table.currentUnitCost} = trunc(${table.currentUnitCost}, 2)`,
      ),
      check("products_version_positive_check", sql`${table.version} > 0`),
      index("products_network_id_idx").on(table.networkId),
      tenantPolicy("products"),
    ],
  )
  .enableRLS();

export const orders = app
  .table(
    "orders",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      locationId: uuid("location_id").notNull(),
      orderedAt: timestamp("ordered_at", { withTimezone: true, mode: "date" }).notNull(),
      status: orderStatus("status").notNull(),
      ...timestampColumns,
    },
    (table) => [
      unique("orders_network_id_id_unique").on(table.networkId, table.id),
      foreignKey({
        columns: [table.networkId, table.locationId],
        foreignColumns: [locations.networkId, locations.id],
        name: "orders_network_location_fk",
      }).onDelete("cascade"),
      index("orders_network_occurred_idx").on(table.networkId, table.orderedAt),
      index("orders_network_location_occurred_idx").on(
        table.networkId,
        table.locationId,
        table.orderedAt,
      ),
      tenantPolicy("orders"),
    ],
  )
  .enableRLS();

export const orderItems = app
  .table(
    "order_items",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      orderId: uuid("order_id").notNull(),
      productId: uuid("product_id").notNull(),
      quantity: numeric("quantity").notNull(),
      unitPriceAtSale: numeric("unit_price_at_sale").notNull(),
      unitCostAtSale: numeric("unit_cost_at_sale").notNull(),
      ...timestampColumns,
    },
    (table) => [
      unique("order_items_network_id_id_unique").on(table.networkId, table.id),
      foreignKey({
        columns: [table.networkId, table.orderId],
        foreignColumns: [orders.networkId, orders.id],
        name: "order_items_network_order_fk",
      }).onDelete("cascade"),
      foreignKey({
        columns: [table.networkId, table.productId],
        foreignColumns: [products.networkId, products.id],
        name: "order_items_network_product_fk",
      }).onDelete("cascade"),
      check(
        "order_items_quantity_format_check",
        sql`${table.quantity} > 0 and ${table.quantity} < 100000000000 and ${table.quantity} = trunc(${table.quantity}, 3)`,
      ),
      check(
        "order_items_unit_price_format_check",
        sql`${table.unitPriceAtSale} >= 0 and ${table.unitPriceAtSale} < 1000000000000 and ${table.unitPriceAtSale} = trunc(${table.unitPriceAtSale}, 2)`,
      ),
      check(
        "order_items_unit_cost_format_check",
        sql`${table.unitCostAtSale} >= 0 and ${table.unitCostAtSale} < 1000000000000 and ${table.unitCostAtSale} = trunc(${table.unitCostAtSale}, 2)`,
      ),
      index("order_items_network_id_idx").on(table.networkId),
      tenantPolicy("order_items"),
    ],
  )
  .enableRLS();

export const inventoryItems = app
  .table(
    "inventory_items",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      name: varchar("name", { length: 120 }).notNull(),
      unit: inventoryUnit("unit").notNull(),
      productId: uuid("product_id"),
      ...timestampColumns,
    },
    (table) => [
      unique("inventory_items_network_id_id_unique").on(table.networkId, table.id),
      foreignKey({
        columns: [table.networkId, table.productId],
        foreignColumns: [products.networkId, products.id],
        name: "inventory_items_network_product_fk",
      }).onDelete("cascade"),
      index("inventory_items_network_id_idx").on(table.networkId),
      tenantPolicy("inventory_items"),
    ],
  )
  .enableRLS();

export const inventoryBalances = app
  .table(
    "inventory_balances",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      locationId: uuid("location_id").notNull(),
      inventoryItemId: uuid("inventory_item_id").notNull(),
      onHand: numeric("on_hand").notNull(),
      minThreshold: numeric("min_threshold").notNull(),
      ...timestampColumns,
    },
    (table) => [
      unique("inventory_balances_network_id_id_unique").on(table.networkId, table.id),
      unique("inventory_balances_location_item_unique").on(
        table.networkId,
        table.locationId,
        table.inventoryItemId,
      ),
      foreignKey({
        columns: [table.networkId, table.locationId],
        foreignColumns: [locations.networkId, locations.id],
        name: "inventory_balances_network_location_fk",
      }).onDelete("cascade"),
      foreignKey({
        columns: [table.networkId, table.inventoryItemId],
        foreignColumns: [inventoryItems.networkId, inventoryItems.id],
        name: "inventory_balances_network_item_fk",
      }).onDelete("cascade"),
      check(
        "inventory_balances_on_hand_format_check",
        sql`${table.onHand} >= 0 and ${table.onHand} < 100000000000 and ${table.onHand} = trunc(${table.onHand}, 3)`,
      ),
      check(
        "inventory_balances_min_threshold_format_check",
        sql`${table.minThreshold} >= 0 and ${table.minThreshold} < 100000000000 and ${table.minThreshold} = trunc(${table.minThreshold}, 3)`,
      ),
      index("inventory_balances_network_id_idx").on(table.networkId),
      tenantPolicy("inventory_balances"),
    ],
  )
  .enableRLS();

export const inventoryMovements = app
  .table(
    "inventory_movements",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      locationId: uuid("location_id").notNull(),
      inventoryItemId: uuid("inventory_item_id").notNull(),
      type: movementType("type").notNull(),
      quantity: numeric("quantity").notNull(),
      occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
      ...timestampColumns,
    },
    (table) => [
      unique("inventory_movements_network_id_id_unique").on(table.networkId, table.id),
      foreignKey({
        columns: [table.networkId, table.locationId],
        foreignColumns: [locations.networkId, locations.id],
        name: "inventory_movements_network_location_fk",
      }).onDelete("cascade"),
      foreignKey({
        columns: [table.networkId, table.inventoryItemId],
        foreignColumns: [inventoryItems.networkId, inventoryItems.id],
        name: "inventory_movements_network_item_fk",
      }).onDelete("cascade"),
      check(
        "inventory_movements_quantity_format_check",
        sql`${table.quantity} > 0 and ${table.quantity} < 100000000000 and ${table.quantity} = trunc(${table.quantity}, 3)`,
      ),
      index("inventory_movements_network_occurred_idx").on(table.networkId, table.occurredAt),
      index("inventory_movements_network_location_occurred_idx").on(
        table.networkId,
        table.locationId,
        table.occurredAt,
      ),
      tenantPolicy("inventory_movements"),
    ],
  )
  .enableRLS();

export const revenueTargets = app
  .table(
    "revenue_targets",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      month: date("month").notNull(),
      amount: numeric("amount").notNull(),
      version: integer("version").default(1).notNull(),
      ...timestampColumns,
    },
    (table) => [
      unique("revenue_targets_network_id_id_unique").on(table.networkId, table.id),
      unique("revenue_targets_network_month_unique").on(table.networkId, table.month),
      check(
        "revenue_targets_month_start_check",
        sql`${table.month} = date_trunc('month', ${table.month})::date`,
      ),
      check(
        "revenue_targets_amount_format_check",
        sql`${table.amount} > 0 and ${table.amount} < 1000000000000 and ${table.amount} = trunc(${table.amount}, 2)`,
      ),
      check("revenue_targets_version_positive_check", sql`${table.version} > 0`),
      tenantPolicy("revenue_targets"),
    ],
  )
  .enableRLS();

export const feedbackResponses = app
  .table(
    "feedback_responses",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .unique()
        .references(() => networks.id, { onDelete: "cascade" }),
      rating: integer("rating").notNull(),
      comment: varchar("comment", { length: 2000 }).notNull().default(""),
      desiredFeatures: varchar("desired_features", { length: 2000 }).notNull(),
      version: integer("version").default(1).notNull(),
      submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" })
        .defaultNow()
        .notNull(),
      ...timestampColumns,
    },
    (table) => [
      unique("feedback_responses_network_id_id_unique").on(table.networkId, table.id),
      check("feedback_responses_rating_check", sql`${table.rating} between 1 and 5`),
      check(
        "feedback_responses_desired_features_check",
        sql`char_length(${table.desiredFeatures}) between 1 and 2000`,
      ),
      check("feedback_responses_version_positive_check", sql`${table.version} > 0`),
      tenantPolicy("feedback_responses"),
    ],
  )
  .enableRLS();

export const productEvents = app
  .table(
    "product_events",
    {
      id: uuid("id").primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      userId: uuid("user_id").notNull(),
      type: productEventType("type").notNull(),
      route: varchar("route", { length: 32 }),
      metadata: jsonb("metadata").notNull().default({}),
      occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
      ...timestampColumns,
    },
    (table) => [
      unique("product_events_network_id_id_unique").on(table.networkId, table.id),
      foreignKey({
        columns: [table.networkId, table.userId],
        foreignColumns: [appUsers.networkId, appUsers.id],
        name: "product_events_network_user_fk",
      }).onDelete("cascade"),
      index("product_events_network_occurred_idx").on(table.networkId, table.occurredAt),
      tenantPolicy("product_events"),
    ],
  )
  .enableRLS();

export const demoGenerations = app
  .table(
    "demo_generations",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      generatedForDate: date("generated_for_date").notNull(),
      seed: bigint("seed", { mode: "number" }).notNull(),
      version: varchar("version", { length: 32 }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      unique("demo_generations_network_id_id_unique").on(table.networkId, table.id),
      unique("demo_generations_network_date_unique").on(table.networkId, table.generatedForDate),
      index("demo_generations_network_date_idx").on(table.networkId, table.generatedForDate),
      tenantPolicy("demo_generations"),
    ],
  )
  .enableRLS();

export const idempotencyKeys = app
  .table(
    "idempotency_keys",
    {
      id: uuid("id").defaultRandom().primaryKey(),
      networkId: uuid("network_id")
        .notNull()
        .references(() => networks.id, { onDelete: "cascade" }),
      key: uuid("key").notNull(),
      operation: varchar("operation", { length: 64 }).notNull(),
      requestHash: varchar("request_hash", { length: 64 }).notNull(),
      resourceId: uuid("resource_id"),
      completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
      ...timestampColumns,
    },
    (table) => [
      unique("idempotency_keys_network_key_unique").on(table.networkId, table.key),
      check("idempotency_keys_hash_format_check", sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
      tenantPolicy("idempotency_keys"),
    ],
  )
  .enableRLS();

export const appTables = {
  networks,
  appUsers,
  locations,
  categories,
  products,
  orders,
  orderItems,
  inventoryItems,
  inventoryBalances,
  inventoryMovements,
  revenueTargets,
  feedbackResponses,
  productEvents,
  demoGenerations,
  idempotencyKeys,
};

export const authTables = {
  authUsers,
  authSessions,
  authAccounts,
  authVerifications,
  authRateLimits,
};

export const schema = { ...authTables, ...appTables };
