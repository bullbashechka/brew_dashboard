import { createLazyRoute } from "@tanstack/react-router";
import { AppPage } from "@/components/app-page";
export const Route = createLazyRoute("/app/locations")({
  component: () => <AppPage section="locations" />,
});
