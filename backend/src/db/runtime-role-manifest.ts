export const AUTH_RUNTIME_ROLE = "brew_auth_runtime";
export const APP_RUNTIME_ROLE = "brew_app_runtime";
export const LEGACY_RUNTIME_ROLE = "brew_runtime";

export const AUTH_RUNTIME_TABLE_GRANTS = [
  ["auth.users", "SELECT, UPDATE"],
  ["auth.accounts", "SELECT"],
  ["auth.sessions", "SELECT, INSERT, UPDATE, DELETE"],
  ["auth.verifications", "SELECT, INSERT, UPDATE, DELETE"],
  ["auth.rate_limits", "SELECT, INSERT, UPDATE, DELETE"],
  ["auth.two_factor", "SELECT, INSERT, UPDATE, DELETE"],
] as const;

export const APP_RUNTIME_TABLE_GRANTS = [
  ["app.app_users", "SELECT"],
  ["app.networks", "SELECT"],
  ["app.locations", "SELECT, INSERT"],
  ["app.categories", "SELECT, INSERT, DELETE"],
  ["app.orders", "SELECT, INSERT, DELETE"],
  ["app.order_items", "SELECT, INSERT, DELETE"],
  ["app.inventory_items", "SELECT, INSERT, DELETE"],
  ["app.products", "SELECT, INSERT, UPDATE, DELETE"],
  ["app.revenue_targets", "SELECT, INSERT, UPDATE, DELETE"],
  ["app.idempotency_keys", "SELECT, INSERT, UPDATE, DELETE"],
  ["app.feedback_responses", "SELECT, INSERT, UPDATE"],
  ["app.demo_generations", "SELECT, INSERT"],
  ["app.product_events", "SELECT, INSERT"],
  ["app.inventory_balances", "SELECT"],
  ["app.inventory_movements", "SELECT"],
] as const;

/**
 * UPDATE is intentionally column-scoped for identity and tenant rows.  Keeping this next to
 * the table manifest prevents provisioning, catalog validation and smoke checks from silently
 * widening it to table-level UPDATE.
 */
export const APP_RUNTIME_COLUMN_GRANTS = [
  ["app.app_users", ["last_login_at", "tour_completed_at", "tour_skipped_at", "updated_at"]],
  [
    "app.networks",
    [
      "name",
      "owner_name",
      "country_code",
      "currency_code",
      "timezone",
      "language",
      "onboarding_completed_at",
      "demo_generator_version",
      "demo_generated_for_date",
      "demo_data_revision",
      "updated_at",
    ],
  ],
] as const;

export const APP_RUNTIME_FUNCTIONS = [
  "app.apply_inventory_movement(uuid, uuid, app.movement_type, numeric, varchar, uuid, timestamptz)",
  "app.replace_inventory_baseline(jsonb, timestamptz)",
  "app.clear_inventory_baseline()",
  "app.security_migration_head_applied()",
] as const;

export const TENANT_TABLES = [
  "categories",
  "demo_generations",
  "feedback_responses",
  "idempotency_keys",
  "inventory_balances",
  "inventory_items",
  "inventory_movements",
  "locations",
  "networks",
  "order_items",
  "orders",
  "product_events",
  "products",
  "revenue_targets",
] as const;
