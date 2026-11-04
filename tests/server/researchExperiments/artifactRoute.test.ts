/**
 * RESEARCH-EXPERIMENT-004 · Artifact 内容代理路由的纯函数部分（规格 §18）。
 *
 * 这里**只**测 `artifactFileName` —— 它是唯一一个把「服务端生成的对象 Key」
 * 变成 HTTP header 值的地方，也是本路由里唯一的注入面：
 *
 * ```
 * Content-Disposition: attachment; filename="<这里>"
 * ```
 *
 * 若 Key 里出现引号 / 换行 / 分号，攻击者（或一个写错名字的实验）就能**在响应头上加字段**。
 * 路由整体（读对象、鉴权、错误映射）已由 `runPersistence.test.ts` 覆盖到服务层；
 * 这里补的是那条「拼 header 字符串」的边界。
 */

import { describe, expect, it } from "vitest";
import { artifactFileName } from "../../../server/experimentArtifactRoutes";

describe("artifactFileName（Content-Disposition 安全）", () => {
  it("取 Key 的最后一段作为文件名", () => {
    expect(artifactFileName("experiments/demo/persist/runs/RUN-1/result.json")).toBe("result.json");
    expect(artifactFileName("experiments/demo/persist/runs/RUN-1/tables/cohort.csv")).toBe(
      "cohort.csv",
    );
    expect(artifactFileName("plain.log")).toBe("plain.log");
  });

  it("引号 / 换行 / 反斜杠 / 分号一律替换 —— 不允许在响应头上加字段", () => {
    expect(artifactFileName('a"; DROP=x')).toBe("a__ DROP=x");
    expect(artifactFileName("a\r\nX-Injected: 1")).toBe("a__X-Injected: 1");
    expect(artifactFileName("a\\b.txt")).toBe("a_b.txt");
    expect(artifactFileName("a;b.txt")).toBe("a_b.txt");
    // 结果里绝不出现会终止 / 逃逸 header 值的字符。
    for (const bad of ['"', "\\", "\r", "\n", ";"]) {
      expect(artifactFileName(`x${bad}y.bin`)).not.toContain(bad);
    }
  });

  it("空 / 以斜杠结尾 ⇒ 回落到稳定的占位名（不是空字符串）", () => {
    expect(artifactFileName("")).toBe("artifact");
    expect(artifactFileName("a/b/")).toBe("artifact");
    expect(artifactFileName("///")).toBe("artifact");
  });
});
