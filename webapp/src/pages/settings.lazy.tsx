/* eslint-disable react-refresh/only-export-components */
import { createLazyRoute, useNavigate } from "@tanstack/react-router";

import { SettingsPage } from "@/components/settings-page";

export const Route = createLazyRoute("/app/settings")({ component: SettingsRoute });

function SettingsRoute() {
  const navigate = useNavigate({ from: "/app/settings" });
  const search = Route.useSearch();
  const period =
    search.period === "7d" || search.period === "30d" || search.period === "6m"
      ? search.period
      : "today";

  return (
    <SettingsPage
      onTourStarted={() =>
        navigate({
          to: "/app/overview",
          search: { period, locationId: search.locationId },
        })
      }
      onLoggedOut={() => navigate({ to: "/login", search: { redirect: undefined }, replace: true })}
    />
  );
}
