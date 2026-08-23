ALTER TABLE "app"."inventory_items" DROP CONSTRAINT "inventory_items_network_product_fk";
--> statement-breakpoint
ALTER TABLE "app"."inventory_items" ADD CONSTRAINT "inventory_items_network_product_fk" FOREIGN KEY ("network_id","product_id") REFERENCES "app"."products"("network_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
