REVOKE ALL ON ALL TABLES IN SCHEMA app, auth FROM brew_runtime;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, auth FROM brew_runtime;--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth REVOKE ALL ON TABLES FROM brew_runtime;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth REVOKE ALL ON SEQUENCES FROM brew_runtime;--> statement-breakpoint

GRANT SELECT ON TABLE auth.users, auth.accounts TO brew_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth.sessions, auth.rate_limits TO brew_runtime;--> statement-breakpoint

GRANT SELECT, UPDATE ON TABLE app.app_users, app.networks TO brew_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE app.locations, app.demo_generations, app.product_events TO brew_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE app.categories, app.orders, app.order_items, app.inventory_items TO brew_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app.products, app.revenue_targets, app.idempotency_keys TO brew_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE app.feedback_responses TO brew_runtime;--> statement-breakpoint
GRANT SELECT ON TABLE app.inventory_balances, app.inventory_movements TO brew_runtime;
