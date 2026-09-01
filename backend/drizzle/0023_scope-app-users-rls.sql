ALTER POLICY "app_users_auth_user_isolation" ON "app"."app_users" TO public USING ("auth_user_id" = nullif(current_setting('app.auth_user_id', true), '') and
   (nullif(current_setting('app.network_id', true), '') is null or
    "network_id" = nullif(current_setting('app.network_id', true), '')::uuid)) WITH CHECK ("auth_user_id" = nullif(current_setting('app.auth_user_id', true), '') and
   (nullif(current_setting('app.network_id', true), '') is null or
    "network_id" = nullif(current_setting('app.network_id', true), '')::uuid));