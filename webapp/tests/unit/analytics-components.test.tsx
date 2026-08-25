import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { OverviewData, Profile } from "@brew-dashboard/contracts";

import { LocationsPerformanceBadge } from "../../src/pages/locations.lazy";
import { OverviewMetricCard } from "../../src/pages/overview.lazy";

const profile: Profile = {
  userId: "123e4567-e89b-12d3-a456-426614174000",
  login: "demo.owner",
  networkId: "123e4567-e89b-12d3-a456-426614174001",
  networkName: "Roast Lab",
  ownerName: "Alex",
  country: "KZ",
  currency: "KZT",
  timeZone: "Asia/Almaty",
  language: "en",
  effectiveLanguage: "en",
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  demoGeneratorVersion: "v1",
  demoGeneratedForDate: "2026-01-01",
  demoDataRevision: 1,
  demoDataStale: false,
  tourState: "completed",
  expiresAt: null,
};

afterEach(cleanup);

describe("analytics cards", () => {
  it("renders an explicit unavailable average check", () => {
    const metric: OverviewData["kpis"]["averageCheck"] = {
      value: null,
      previousValue: null,
      changePercent: null,
    };
    render(<OverviewMetricCard name="averageCheck" metric={metric} profile={profile} />);
    expect(screen.getByText("Average check")).toBeDefined();
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
  });

  it("communicates the best location with text, not color alone", () => {
    render(<LocationsPerformanceBadge performance="best" profile={profile} />);
    expect(screen.getByText("Best performing location")).toBeDefined();
  });
});
