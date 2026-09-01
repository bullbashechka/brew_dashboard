-- Onboarding and demo reset replace inventory through narrowly scoped SECURITY DEFINER helpers.
GRANT EXECUTE ON FUNCTION app.replace_inventory_baseline(jsonb, timestamptz) TO brew_app_runtime;
GRANT EXECUTE ON FUNCTION app.clear_inventory_baseline() TO brew_app_runtime;
