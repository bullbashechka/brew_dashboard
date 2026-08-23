-- Custom SQL migration file, put your code below! --
DO $$
BEGIN
  CREATE ROLE brew_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

ALTER ROLE brew_runtime
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS NOLOGIN;--> statement-breakpoint

REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA app, auth FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, auth FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA app, auth TO brew_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app, auth TO brew_runtime;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app, auth TO brew_runtime;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON app.inventory_balances, app.inventory_movements FROM brew_runtime;--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth REVOKE ALL ON TABLES FROM PUBLIC;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO brew_runtime;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth GRANT USAGE, SELECT ON SEQUENCES TO brew_runtime;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.apply_inventory_movement(
  p_location_id uuid,
  p_inventory_item_id uuid,
  p_type app.movement_type,
  p_quantity numeric,
  p_request_hash varchar(64),
  p_idempotency_key uuid,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS TABLE (movement_id uuid, on_hand numeric(14, 3))
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_network_id uuid;
  v_unit app.inventory_unit;
  v_balance app.inventory_balances%ROWTYPE;
  v_existing app.idempotency_keys%ROWTYPE;
  v_movement_id uuid;
BEGIN
  v_network_id := nullif(current_setting('app.network_id', true), '')::uuid;
  IF v_network_id IS NULL THEN
    RAISE EXCEPTION 'tenant context is required' USING ERRCODE = '42501';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_quantity <> round(p_quantity, 3) THEN
    RAISE EXCEPTION 'quantity has more than three decimal places' USING ERRCODE = '22023';
  END IF;
  IF p_request_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'request hash is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO app.idempotency_keys (network_id, key, operation, request_hash)
  VALUES (v_network_id, p_idempotency_key, 'inventory_movement', p_request_hash)
  ON CONFLICT (network_id, key) DO NOTHING;

  SELECT * INTO v_existing
  FROM app.idempotency_keys
  WHERE network_id = v_network_id AND key = p_idempotency_key
  FOR UPDATE;

  IF v_existing.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'idempotency key was reused for another request' USING ERRCODE = '23505';
  END IF;

  IF v_existing.resource_id IS NOT NULL THEN
    SELECT ib.on_hand INTO on_hand
    FROM app.inventory_balances AS ib
    WHERE ib.network_id = v_network_id
      AND ib.location_id = p_location_id
      AND ib.inventory_item_id = p_inventory_item_id;
    movement_id := v_existing.resource_id;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT ii.unit INTO v_unit
  FROM app.inventory_items AS ii
  WHERE ii.network_id = v_network_id AND ii.id = p_inventory_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory item is not available' USING ERRCODE = '23503';
  END IF;
  IF v_unit = 'pcs' AND p_quantity <> trunc(p_quantity) THEN
    RAISE EXCEPTION 'piece quantities must be whole numbers' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_balance
  FROM app.inventory_balances AS ib
  WHERE ib.network_id = v_network_id
    AND ib.location_id = p_location_id
    AND ib.inventory_item_id = p_inventory_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory balance is not available' USING ERRCODE = '23503';
  END IF;
  IF p_type = 'writeoff' AND v_balance.on_hand < p_quantity THEN
    RAISE EXCEPTION 'writeoff exceeds current balance' USING ERRCODE = '23514';
  END IF;

  UPDATE app.inventory_balances AS ib
  SET on_hand = CASE
        WHEN p_type = 'receipt' THEN ib.on_hand + p_quantity
        ELSE ib.on_hand - p_quantity
      END,
      updated_at = now()
  WHERE ib.id = v_balance.id;

  INSERT INTO app.inventory_movements (
    network_id, location_id, inventory_item_id, type, quantity, occurred_at
  )
  VALUES (v_network_id, p_location_id, p_inventory_item_id, p_type, p_quantity, p_occurred_at)
  RETURNING id INTO v_movement_id;

  UPDATE app.idempotency_keys
  SET resource_id = v_movement_id, completed_at = now(), updated_at = now()
  WHERE id = v_existing.id;

  SELECT ib.on_hand INTO on_hand
  FROM app.inventory_balances AS ib
  WHERE ib.id = v_balance.id;
  movement_id := v_movement_id;
  RETURN NEXT;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app.apply_inventory_movement(uuid, uuid, app.movement_type, numeric, varchar, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.apply_inventory_movement(uuid, uuid, app.movement_type, numeric, varchar, uuid, timestamptz) TO brew_runtime;
