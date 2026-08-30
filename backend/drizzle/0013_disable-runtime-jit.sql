-- Request-scoped analytics queries are short enough that PostgreSQL JIT compilation costs more
-- than execution and creates a compile storm under concurrent dashboard reads.
ALTER ROLE brew_runtime SET jit = off;
