import { createLazyRoute } from "@tanstack/react-router";
import { AppPage } from "@/components/app-page";
export const Route = createLazyRoute("/app/sales")({
  component: () => <AppPage section="sales" />,
});
