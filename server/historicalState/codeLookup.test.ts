/**
 * FE-2 — 代码 → 候选证券 解析测试。
 *
 * 纪律（§0.2）：纯解析函数覆盖各种输入；DB 检索在无 DATABASE_URL 环境验证「诚实失败」路径
 * （返回 error 而非空数组冒充「查无此代码」）。真实检索结果由 M0/P1 认证承担（TiDB 回填期间不可靠）。
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lookupSecuritiesByCode, parseCodeQuery } from "./codeLookup";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");

afterEach(() => {
  // 复原环境，避免污染同文件其它用例 / 模块级 _db 缓存判断
  if (process.env.DATABASE_URL === undefined) {
    // 已删除则保持删除
  }
});

describe("parseCodeQuery（纯函数）", () => {
  it("6 位纯数字 → digits + 无交易所", () => {
    expect(parseCodeQuery("600000")).toEqual({
      digits: "600000",
      exchange: null,
      error: null,
    });
  });

  it("带 .SH/.SZ 后缀（大小写不敏感、容忍空白）", () => {
    expect(parseCodeQuery(" 600000.SH ")).toEqual({
      digits: "600000",
      exchange: "SH",
      error: null,
    });
    expect(parseCodeQuery("000001.sz")).toEqual({
      digits: "000001",
      exchange: "SZ",
      error: null,
    });
  });

  it("支持北交所后缀 .BJ", () => {
    expect(parseCodeQuery("830799.BJ")).toEqual({
      digits: "830799",
      exchange: "BJ",
      error: null,
    });
  });

  it("非法输入 → 可读 parseError 而非静默猜测", () => {
    expect(parseCodeQuery("")).toEqual({
      digits: null,
      exchange: null,
      error: "查询为空",
    });
    for (const bad of ["abc", "12345", "1234567", "600000.US", "600000SH"]) {
      const r = parseCodeQuery(bad);
      expect(r.error).not.toBeNull();
      expect(r.digits).toBeNull();
    }
  });
});

describe("lookupSecuritiesByCode（无 DB 环境：诚实失败）", () => {
  it("DATABASE_URL 缺失 → 返回 error 而非空数组", async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const r = await lookupSecuritiesByCode({ digits: "600000", exchange: null });
      expect(r.error).not.toBeNull();
      expect(r.candidates).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });
});

describe("FE-2 接线守卫", () => {
  it("historicalState router 暴露 resolveCode（前端页面可调用）", () => {
    const src = readFileSync(resolve(PROJECT_ROOT, "server/historicalStateRouter.ts"), "utf8");
    expect(src).toContain("resolveCode");
    expect(src).toContain("lookupSecuritiesByCode");
  });

  it("契约 schema 定义 resolve 入参/结果类型", () => {
    const src = readFileSync(resolve(PROJECT_ROOT, "shared/researchContracts.ts"), "utf8");
    expect(src).toContain("historicalStateResolveInputSchema");
    expect(src).toContain("historicalStateResolveResultSchema");
    expect(src).toContain("codeCandidateSchema");
  });
});
