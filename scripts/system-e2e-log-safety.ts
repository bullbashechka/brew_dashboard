import type { BunFile } from "bun";

const unsafeLogKeys =
  /(?:^|[,{\s"'])(?:authorization|cookie|set-cookie|password|feedback|desiredfeatures|comment)\s*[:=]/iu;

export type SystemE2eLogCanaryCategory =
  "auth secret" | "database credential" | "fixture credential" | "fixture identity" | "form canary";

export type SystemE2eLogCanary = {
  category: SystemE2eLogCanaryCategory;
  value: string;
};

/** Fail the system gate if Worker output contains a request secret or form text. */
export const assertSystemE2eLogSafety = (
  output: string,
  canaries: readonly SystemE2eLogCanary[],
) => {
  const findings = new Map<string, number>();
  for (const { category, value } of canaries) {
    if (!value || !output.includes(value)) continue;
    findings.set(category, (findings.get(category) ?? 0) + 1);
  }
  if (unsafeLogKeys.test(output)) findings.set("unsafe log key", 1);
  if (findings.size) {
    const summary = [...findings.entries()]
      .map(([category, count]) => `${category} (${count})`)
      .join(", ");
    throw new Error(`Unsafe system E2E Worker log output: ${summary}`);
  }
};

/** Inspect captured Worker output and delete raw files on every exit path. */
export const assertSystemE2eLogFilesSafe = async (
  files: readonly BunFile[],
  canaries: readonly SystemE2eLogCanary[],
) => {
  try {
    const output = (await Promise.all(files.map((file) => file.text()))).join("\n");
    assertSystemE2eLogSafety(output, canaries);
  } finally {
    await Promise.all(files.map((file) => file.delete()));
  }
};
