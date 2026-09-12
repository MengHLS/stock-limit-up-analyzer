/**
 * BuildVersionDialog — 版本标签建议纯函数单测（STEP DATASET-002.4B）。
 *
 * 只测纯函数 `suggestNextVersion`，不渲染组件（不触 DOM / tRPC）。
 */

import { describe, expect, it } from "vitest";
import { suggestNextVersion } from "./BuildVersionDialog";

describe("suggestNextVersion", () => {
  it("无版本 → v1", () => {
    expect(suggestNextVersion([])).toBe("v1");
  });

  it("全部为 v{n} → max+1（不因缺口而回填）", () => {
    expect(suggestNextVersion(["v1"])).toBe("v2");
    expect(suggestNextVersion(["v1", "v2", "v3"])).toBe("v4");
    expect(suggestNextVersion(["v2", "v5"])).toBe("v6");
  });

  it("存在非 v{n} 标签 → count+1（不回填、不冲突）", () => {
    expect(suggestNextVersion(["smoke"])).toBe("v2");
    expect(suggestNextVersion(["smoke", "v1"])).toBe("v3");
    expect(suggestNextVersion(["2024-full"])).toBe("v2");
  });
});
