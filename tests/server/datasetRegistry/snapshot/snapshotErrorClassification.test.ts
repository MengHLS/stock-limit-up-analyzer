import { describe, expect, it } from "vitest";
import { DatasetSnapshotError } from "../../../../server/datasetRegistry/snapshot/errors";
import { RegistryDatasetBridgeError } from "../../../../server/runWorkbenchAssembly/bridgeError";

/**
 * `assemble.ts` 的回落守卫是 `if (!(error instanceof RegistryDatasetBridgeError)) throw error;`。
 *
 * 这里锁定该判据的分类结果：快照损坏必须**穿透** fallback，而直读桥的可预期失败才回落重建。
 */
function wouldAssembleFallBack(error: unknown): boolean {
  return error instanceof RegistryDatasetBridgeError;
}

describe("DatasetSnapshotError vs RegistryDatasetBridgeError", () => {
  it("does not extend RegistryDatasetBridgeError so assemble never swallows it", () => {
    const snapshotError = new DatasetSnapshotError("SNAPSHOT_CHECKSUM_MISMATCH", "sha 不一致");
    expect(snapshotError).toBeInstanceOf(Error);
    expect(snapshotError).not.toBeInstanceOf(RegistryDatasetBridgeError);
    expect(wouldAssembleFallBack(snapshotError)).toBe(false);
    expect(snapshotError.code).toBe("SNAPSHOT_CHECKSUM_MISMATCH");
    expect(snapshotError.name).toBe("DatasetSnapshotError");
  });

  it("still treats genuine bridge failures as fallback-eligible", () => {
    const bridgeError = new RegistryDatasetBridgeError("REGISTRY_SECURITY_IDENTITY_UNRESOLVED", "身份缺失");
    expect(wouldAssembleFallBack(bridgeError)).toBe(true);
  });

  it("preserves the error code for every snapshot failure mode", () => {
    const codes = [
      "SNAPSHOT_NOT_SUPPORTED",
      "SNAPSHOT_NOT_FOUND",
      "SNAPSHOT_INVALID",
      "SNAPSHOT_MANIFEST_INVALID",
      "SNAPSHOT_SCHEMA_INVALID",
      "SNAPSHOT_CHECKSUM_MISMATCH",
      "SNAPSHOT_COUNT_MISMATCH",
      "SNAPSHOT_VERSION_MISMATCH",
      "SNAPSHOT_IDENTITY_MISSING",
      "SNAPSHOT_EXPORT_FAILED",
      "SNAPSHOT_PUBLISH_FAILED",
    ] as const;
    for (const code of codes) {
      const error = new DatasetSnapshotError(code, `msg:${code}`);
      expect(error.code).toBe(code);
      expect(wouldAssembleFallBack(error)).toBe(false);
    }
  });
});
