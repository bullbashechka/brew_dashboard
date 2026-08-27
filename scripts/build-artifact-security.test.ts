import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { checkBuildArtifact, sanitizeBuildArtifact } from "./build-artifact-security.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

const createArtifact = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "brew-dashboard-artifact-"));
  temporaryDirectories.push(directory);
  await mkdir(path.join(directory, "worker"), { recursive: true });
  await mkdir(path.join(directory, "client"), { recursive: true });
  return directory;
};

describe("build artifact security", () => {
  it("removes preview-only local vars before checking the artifact", async () => {
    const directory = await createArtifact();
    const localVars = path.join(directory, "worker", ".dev.vars");
    await writeFile(localVars, "BETTER_AUTH_SECRET='sentinel'\n");
    await writeFile(path.join(directory, "worker", "index.js"), "export default {};\n");

    const removed = await sanitizeBuildArtifact(directory);
    expect(removed).toHaveLength(1);
    await expect(readFile(localVars)).rejects.toThrow();
    expect((await checkBuildArtifact(directory)).leaks).toEqual([]);
  });

  it("rejects forbidden markers in the client bundle", async () => {
    const directory = await createArtifact();
    await writeFile(
      path.join(directory, "client", "index.js"),
      "const marker = 'BETTER_AUTH_SECRET';\n",
    );

    const result = await checkBuildArtifact(directory);
    expect(result.leaks).toHaveLength(1);
    expect(result.leaks[0]).toContain("client/index.js contains BETTER_AUTH_SECRET");
  });

  it("rejects configured secret values in the Worker bundle", async () => {
    const directory = await createArtifact();
    const previous = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = "test-artifact-secret-value";
    try {
      await writeFile(
        path.join(directory, "worker", "index.js"),
        "const key = 'BETTER_AUTH_SECRET'; const value = 'test-artifact-secret-value';\n",
      );

      const result = await checkBuildArtifact(directory);
      expect(result.leaks).toHaveLength(1);
      expect(result.leaks[0]).toContain("worker/index.js contains BETTER_AUTH_SECRET");
    } finally {
      if (previous === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = previous;
    }
  });
});
