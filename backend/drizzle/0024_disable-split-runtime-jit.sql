-- Keep the request-scoped Worker workload from paying per-connection JIT compilation costs.
ALTER ROLE brew_auth_runtime SET jit = off;--> statement-breakpoint
ALTER ROLE brew_app_runtime SET jit = off;
