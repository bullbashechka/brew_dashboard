import { createLazyRoute } from "@tanstack/react-router";
import { AppPage } from "@/components/app-page";
export const Route = createLazyRoute("/app/products")({
  component: () => <AppPage section="products" />,
});
