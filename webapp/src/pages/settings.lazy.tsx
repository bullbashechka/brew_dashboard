import { createLazyRoute } from "@tanstack/react-router";
import { AppPage } from "@/components/app-page";
export const Route = createLazyRoute("/app/settings")({
  component: () => <AppPage section="settings" />,
});
