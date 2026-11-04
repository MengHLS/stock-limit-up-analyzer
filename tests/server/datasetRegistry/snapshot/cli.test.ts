import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const scriptPath = path.join(repoRoot, "scripts", "datasetSnapshot.ts");

function runCli(args: readonly string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe("pnpm dataset:snapshot CLI", () => {
  it("exits 2 and prints a JSONL failed event when --json-events has bad arguments", () => {
    const result = runCli(["--json-events"]);
    expect(result.status).toBe(2);
    const lines = result.stdout.trim().split("\n").filter((line) => line.length > 0);
    const event = JSON.parse(lines[lines.length - 1]!);
    expect(event).toMatchObject({
      event: "failed",
      phase: "verify",
      datasetVersionId: 0,
    });
    expect(typeof event.message).toBe("string");
  });

  it("exits 2 and prints usage to stderr in human mode", () => {
    const result = runCli(["--dataset-version-id", "abc"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/dataset-version-id/);
  });

  it("rejects unknown flags", () => {
    const result = runCli(["--dataset-version-id", "1", "--nope"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/未知参数/);
  });
});
