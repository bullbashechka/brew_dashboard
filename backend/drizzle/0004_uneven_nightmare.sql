ALTER TABLE "app"."inventory_balances" DROP CONSTRAINT "inventory_balances_on_hand_nonnegative_check";--> statement-breakpoint
ALTER TABLE "app"."inventory_balances" DROP CONSTRAINT "inventory_balances_min_threshold_nonnegative_check";--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" DROP CONSTRAINT "inventory_movements_quantity_positive_check";--> statement-breakpoint
ALTER TABLE "app"."order_items" DROP CONSTRAINT "order_items_quantity_positive_check";--> statement-breakpoint
ALTER TABLE "app"."order_items" DROP CONSTRAINT "order_items_unit_price_nonnegative_check";--> statement-breakpoint
ALTER TABLE "app"."order_items" DROP CONSTRAINT "order_items_unit_cost_nonnegative_check";--> statement-breakpoint
ALTER TABLE "app"."products" DROP CONSTRAINT "products_current_price_nonnegative_check";--> statement-breakpoint
ALTER TABLE "app"."products" DROP CONSTRAINT "products_current_unit_cost_nonnegative_check";--> statement-breakpoint
ALTER TABLE "app"."revenue_targets" DROP CONSTRAINT "revenue_targets_amount_positive_check";--> statement-breakpoint
ALTER TABLE "app"."inventory_balances" ALTER COLUMN "on_hand" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "app"."inventory_balances" ALTER COLUMN "min_threshold" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ALTER COLUMN "quantity" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "app"."order_items" ALTER COLUMN "quantity" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "app"."order_items" ALTER COLUMN "unit_price_at_sale" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "app"."order_items" ALTER COLUMN "unit_cost_at_sale" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "app"."products" ALTER COLUMN "current_price" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "app"."products" ALTER COLUMN "current_unit_cost" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "app"."revenue_targets" ALTER COLUMN "amount" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "app"."inventory_balances" ADD CONSTRAINT "inventory_balances_on_hand_format_check" CHECK ("app"."inventory_balances"."on_hand" >= 0 and "app"."inventory_balances"."on_hand" < 100000000000 and "app"."inventory_balances"."on_hand" = trunc("app"."inventory_balances"."on_hand", 3));--> statement-breakpoint
ALTER TABLE "app"."inventory_balances" ADD CONSTRAINT "inventory_balances_min_threshold_format_check" CHECK ("app"."inventory_balances"."min_threshold" >= 0 and "app"."inventory_balances"."min_threshold" < 100000000000 and "app"."inventory_balances"."min_threshold" = trunc("app"."inventory_balances"."min_threshold", 3));--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD CONSTRAINT "inventory_movements_quantity_format_check" CHECK ("app"."inventory_movements"."quantity" > 0 and "app"."inventory_movements"."quantity" < 100000000000 and "app"."inventory_movements"."quantity" = trunc("app"."inventory_movements"."quantity", 3));--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_quantity_format_check" CHECK ("app"."order_items"."quantity" > 0 and "app"."order_items"."quantity" < 100000000000 and "app"."order_items"."quantity" = trunc("app"."order_items"."quantity", 3));--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_unit_price_format_check" CHECK ("app"."order_items"."unit_price_at_sale" >= 0 and "app"."order_items"."unit_price_at_sale" < 1000000000000 and "app"."order_items"."unit_price_at_sale" = trunc("app"."order_items"."unit_price_at_sale", 2));--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_unit_cost_format_check" CHECK ("app"."order_items"."unit_cost_at_sale" >= 0 and "app"."order_items"."unit_cost_at_sale" < 1000000000000 and "app"."order_items"."unit_cost_at_sale" = trunc("app"."order_items"."unit_cost_at_sale", 2));--> statement-breakpoint
ALTER TABLE "app"."products" ADD CONSTRAINT "products_current_price_format_check" CHECK ("app"."products"."current_price" >= 0 and "app"."products"."current_price" < 1000000000000 and "app"."products"."current_price" = trunc("app"."products"."current_price", 2));--> statement-breakpoint
ALTER TABLE "app"."products" ADD CONSTRAINT "products_current_unit_cost_format_check" CHECK ("app"."products"."current_unit_cost" >= 0 and "app"."products"."current_unit_cost" < 1000000000000 and "app"."products"."current_unit_cost" = trunc("app"."products"."current_unit_cost", 2));--> statement-breakpoint
ALTER TABLE "app"."revenue_targets" ADD CONSTRAINT "revenue_targets_amount_format_check" CHECK ("app"."revenue_targets"."amount" > 0 and "app"."revenue_targets"."amount" < 1000000000000 and "app"."revenue_targets"."amount" = trunc("app"."revenue_targets"."amount", 2));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.enforce_inventory_balance_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_unit app.inventory_unit;
BEGIN
  SELECT unit INTO v_unit
  FROM app.inventory_items
  WHERE network_id = NEW.network_id AND id = NEW.inventory_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory item is not available' USING ERRCODE = '23503';
  END IF;

  IF v_unit = 'pcs'
    AND (NEW.on_hand <> trunc(NEW.on_hand) OR NEW.min_threshold <> trunc(NEW.min_threshold)) THEN
    RAISE EXCEPTION 'piece quantities must be whole numbers' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_balances_enforce_unit
BEFORE INSERT OR UPDATE OF network_id, inventory_item_id, on_hand, min_threshold
ON app.inventory_balances
FOR EACH ROW EXECUTE FUNCTION app.enforce_inventory_balance_unit();
