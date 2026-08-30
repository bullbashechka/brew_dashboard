import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";

const chartViewportSizes = {
  trend: {
    className: "h-[264px] min-w-0 md:h-80",
    initialDimension: { width: 320, height: 264 },
  },
  matrix: {
    className: "h-96 min-w-0",
    initialDimension: { width: 768, height: 384 },
  },
} as const;

export function ChartViewport({
  size,
  label,
  children,
}: {
  size: keyof typeof chartViewportSizes;
  label?: string;
  children: ReactElement;
}) {
  const viewport = chartViewportSizes[size];
  return (
    <div className={viewport.className} aria-label={label}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={1}
        minHeight={1}
        initialDimension={viewport.initialDimension}
      >
        {children}
      </ResponsiveContainer>
    </div>
  );
}
