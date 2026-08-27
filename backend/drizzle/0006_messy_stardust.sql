ALTER TABLE "app"."networks" ADD COLUMN "demo_generated_for_date" date;--> statement-breakpoint
ALTER TABLE "app"."networks" ADD COLUMN "demo_data_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."networks" ADD CONSTRAINT "networks_demo_data_revision_check" CHECK ("app"."networks"."demo_data_revision" >= 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.replace_inventory_baseline(
  p_rows jsonb,
  p_anchor timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_network_id uuid;
  v_row record;
  v_unit app.inventory_unit;
BEGIN
  v_network_id := nullif(current_setting('app.network_id', true), '')::uuid;
  IF v_network_id IS NULL THEN
    RAISE EXCEPTION 'tenant context is required' USING ERRCODE = '42501';
  END IF;
  IF p_anchor IS NULL THEN
    RAISE EXCEPTION 'baseline anchor is required' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
    OR jsonb_array_length(p_rows) = 0 OR jsonb_array_length(p_rows) > 100 THEN
    RAISE EXCEPTION 'baseline batch must be a non-empty array of at most 100 rows' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) AS json_rows(value)
    CROSS JOIN LATERAL jsonb_object_keys(json_rows.value) AS json_keys(object_key)
    WHERE json_keys.object_key NOT IN (
      'balance_id', 'movement_id', 'location_id', 'inventory_item_id', 'baseline_quantity', 'consumed_quantity',
      'on_hand', 'min_threshold', 'occurred_at'
    )
  ) THEN
    RAISE EXCEPTION 'baseline row contains an unsupported field' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS row_value(
      balance_id uuid,
      movement_id uuid,
      location_id uuid,
      inventory_item_id uuid,
      baseline_quantity numeric,
      consumed_quantity numeric,
      on_hand numeric,
      min_threshold numeric,
      occurred_at timestamptz
    )
    GROUP BY location_id, inventory_item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'baseline rows contain duplicate location and item pairs' USING ERRCODE = '23505';
  END IF;
  IF jsonb_array_length(p_rows) <> (
    SELECT count(*) FROM app.locations WHERE network_id = v_network_id
  ) * (
    SELECT count(*) FROM app.inventory_items WHERE network_id = v_network_id
  ) THEN
    RAISE EXCEPTION 'baseline must cover every tenant location and inventory item' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM app.locations AS location
    CROSS JOIN app.inventory_items AS item
    WHERE location.network_id = v_network_id
      AND item.network_id = v_network_id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_rows) AS row_value(
          location_id uuid,
          inventory_item_id uuid
        )
        WHERE row_value.location_id = location.id
          AND row_value.inventory_item_id = item.id
      )
  ) THEN
    RAISE EXCEPTION 'baseline is missing a tenant location and inventory item pair' USING ERRCODE = '22023';
  END IF;

  DELETE FROM app.inventory_movements WHERE network_id = v_network_id;
  DELETE FROM app.inventory_balances WHERE network_id = v_network_id;

  FOR v_row IN
    SELECT *
    FROM jsonb_to_recordset(p_rows) AS row_value(
      balance_id uuid,
      movement_id uuid,
      location_id uuid,
      inventory_item_id uuid,
      baseline_quantity numeric,
      consumed_quantity numeric,
      on_hand numeric,
      min_threshold numeric,
      occurred_at timestamptz
    )
  LOOP
    IF v_row.balance_id IS NULL OR v_row.movement_id IS NULL THEN
      RAISE EXCEPTION 'baseline row ids are required' USING ERRCODE = '22023';
    END IF;
    IF v_row.location_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM app.locations
      WHERE network_id = v_network_id AND id = v_row.location_id
    ) THEN
      RAISE EXCEPTION 'baseline location is not owned by the tenant' USING ERRCODE = '23503';
    END IF;
    SELECT unit INTO v_unit
    FROM app.inventory_items
    WHERE network_id = v_network_id AND id = v_row.inventory_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'baseline inventory item is not owned by the tenant' USING ERRCODE = '23503';
    END IF;
    IF v_row.baseline_quantity IS NULL OR v_row.baseline_quantity <= 0
      OR v_row.baseline_quantity >= 100000000000
      OR v_row.baseline_quantity <> trunc(v_row.baseline_quantity, 3)
      OR v_row.consumed_quantity IS NULL OR v_row.consumed_quantity < 0
      OR v_row.consumed_quantity <> trunc(v_row.consumed_quantity, 3)
      OR v_row.on_hand IS NULL OR v_row.on_hand < 0
      OR v_row.on_hand >= 100000000000
      OR v_row.on_hand <> trunc(v_row.on_hand, 3)
      OR v_row.min_threshold IS NULL OR v_row.min_threshold < 0
      OR v_row.min_threshold >= 100000000000
      OR v_row.min_threshold <> trunc(v_row.min_threshold, 3)
      OR v_row.on_hand <> v_row.baseline_quantity - v_row.consumed_quantity
    THEN
      RAISE EXCEPTION 'baseline quantities are invalid or do not reconcile' USING ERRCODE = '22023';
    END IF;
    IF v_unit = 'pcs' AND (
      v_row.baseline_quantity <> trunc(v_row.baseline_quantity)
      OR v_row.consumed_quantity <> trunc(v_row.consumed_quantity)
      OR v_row.on_hand <> trunc(v_row.on_hand)
      OR v_row.min_threshold <> trunc(v_row.min_threshold)
    ) THEN
      RAISE EXCEPTION 'piece baseline quantities must be whole numbers' USING ERRCODE = '22023';
    END IF;
    IF v_row.occurred_at IS NULL OR v_row.occurred_at > p_anchor THEN
      RAISE EXCEPTION 'baseline timestamp is later than the anchor' USING ERRCODE = '22023';
    END IF;

    INSERT INTO app.inventory_balances (
      id, network_id, location_id, inventory_item_id, on_hand, min_threshold, created_at, updated_at
    )
    VALUES (
      v_row.balance_id, v_network_id, v_row.location_id, v_row.inventory_item_id,
      v_row.on_hand, v_row.min_threshold, p_anchor, p_anchor
    );
    INSERT INTO app.inventory_movements (
      id, network_id, location_id, inventory_item_id, type, quantity, occurred_at, created_at, updated_at
    )
    VALUES (
      v_row.movement_id, v_network_id, v_row.location_id, v_row.inventory_item_id,
      'receipt', v_row.baseline_quantity, v_row.occurred_at, p_anchor, p_anchor
    );
  END LOOP;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app.replace_inventory_baseline(jsonb, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.replace_inventory_baseline(jsonb, timestamptz) TO brew_runtime;

CREATE OR REPLACE FUNCTION app.clear_inventory_baseline()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_network_id uuid;
BEGIN
  v_network_id := nullif(current_setting('app.network_id', true), '')::uuid;
  IF v_network_id IS NULL THEN
    RAISE EXCEPTION 'tenant context is required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM app.inventory_movements WHERE network_id = v_network_id;
  DELETE FROM app.inventory_balances WHERE network_id = v_network_id;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app.clear_inventory_baseline() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.clear_inventory_baseline() TO brew_runtime;--> statement-breakpoint

REVOKE UPDATE, DELETE ON app.demo_generations FROM brew_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON app.demo_generations TO brew_runtime;
