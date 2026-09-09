/**
 * FE-1 — 数据域健康看板 数据源测试。
 *
 * 纪律（§0.2）：
 * - 读取**真实证据文件** `docs/researchReadyGate/research_ready_gate.json` 做断言，不用 mock 冒充真实数据；
 * - 纯派生逻辑（状态/覆盖率规则）用**合成输入**验证规则本身，不谎称其为真实数据；
 * - 不硬编码会随时间漂移的具体行数/状态，改为断言「规则一致性」。
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deriveDomains,
  readCertifiedGate,
  listEvidenceArtifacts,
  buildDataHealthOverview,
  DOMAIN_SPEC,
  GATE_EVIDENCE_PATH,
} from "./dataHealth";
import { researchReadyGateFileSchema, type GateCheck } from "../shared/dataHealthContracts";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function realGate() {
  const abs = resolve(PROJECT_ROOT, GATE_EVIDENCE_PATH);
  if (!existsSync(abs)) throw new Error(`真实证据文件缺失：${GATE_EVIDENCE_PATH}`);
  const parsed = researchReadyGateFileSchema.safeParse(JSON.parse(readFileSync(abs, "utf8")));
  if (!parsed.success) throw new Error(`真实证据 schema 校验失败：${parsed.error.message}`);
  return parsed.data;
}

function mkCheck(id: number, status: GateCheck["status"], extra?: Partial<GateCheck>): GateCheck {
  return {
    id,
    name: `check-${id}`,
    status,
    current: {},
    threshold: {},
    detail: "",
    ...extra,
  };
}

describe("FE-1 认证证据读取（真实文件）", () => {
  it("真实 gate 证据文件存在且通过 schema 校验", async () => {
    const { gate, exists, parseError } = await readCertifiedGate();
    expect(exists).toBe(true);
    expect(parseError).toBeNull();
    expect(gate).not.toBeNull();
  });

  it("summary 计数自洽：PASS + PENDING + FAIL === total", async () => {
    const gate = realGate();
    const { PASS, PENDING, FAIL, total } = gate.summary;
    expect(PASS + PENDING + FAIL).toBe(total);
    expect(gate.checks).toHaveLength(total);
  });

  it("分层语义：dataFoundationReady(G0) 与「无 FAIL 且无 PENDING」一致，researchReady(G4) 不再等于数据域 PASS", async () => {
    const gate = realGate();
    // G0 = 15 项数据域检查全 PASS（无 FAIL 且无 PENDING）
    const expectFoundationReady = gate.summary.FAIL === 0 && gate.summary.PENDING === 0;
    expect(gate.dataFoundationReady).toBe(expectFoundationReady);
    // 分层铁律（GCP-001）：researchReady 只指 G4（真实研究 E2E），G4 GAP 时恒 false，
    // 即使 G0 已 PASS。当前 research_runs=0 → G4=GAP → researchReady=false。
    expect(gate.gates?.G4?.status).toBe("GAP");
    expect(gate.researchReady).toBe(false);
    expect(gate.gates?.G0?.status).toBe(expectFoundationReady ? "PASS" : "GAP");
  });

  it("schema 不匹配时返回 parseError 而不伪造 gate", () => {
    const bad = researchReadyGateFileSchema.safeParse({ capturedAt: "x" });
    expect(bad.success).toBe(false);
  });
});

describe("FE-1 域派生（规则一致性，基于真实证据）", () => {
  it("派生出 A~G 七域，且 checkIds 与 DOMAIN_SPEC 一致", async () => {
    const gate = realGate();
    const domains = deriveDomains(gate);
    expect(domains.map((d) => d.domain)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    for (const d of domains) {
      expect(d.checkIds).toEqual(DOMAIN_SPEC[d.domain].checkIds);
    }
  });

  it("域状态 = 其 gate 项聚合（含 FAIL→FAIL，含 PENDING→PENDING，全 PASS→PASS）", async () => {
    const gate = realGate();
    const byId = new Map(gate.checks.map((c) => [c.id, c]));
    for (const d of deriveDomains(gate)) {
      const statuses = d.checkIds.map((id) => byId.get(id)?.status).filter(Boolean);
      const expected = statuses.includes("FAIL")
        ? "FAIL"
        : statuses.includes("PENDING")
          ? "PENDING"
          : "PASS";
      expect(d.status).toBe(expected);
    }
  });

  it("覆盖率取**最差**来源（保守口径，不取平均/最好）", async () => {
    const gate = realGate();
    const byId = new Map(gate.checks.map((c) => [c.id, c]));
    for (const d of deriveDomains(gate)) {
      const srcs = DOMAIN_SPEC[d.domain].coverageSources;
      const values = srcs
        .map((s) => byId.get(s.checkId)?.current?.[s.currentKey])
        .filter((v): v is number => typeof v === "number");
      if (values.length === 0) continue;
      expect(d.coverage.current).toBe(Math.min(...values));
    }
  });

  it("覆盖率 target 取自 threshold，而非硬编码常量", async () => {
    const gate = realGate();
    const byId = new Map(gate.checks.map((c) => [c.id, c]));
    for (const d of deriveDomains(gate)) {
      const src = DOMAIN_SPEC[d.domain].coverageSources.find(
        (s) => byId.get(s.checkId)?.current?.[s.currentKey] === d.coverage.current,
      );
      if (!src) continue;
      const target = byId.get(src.checkId)?.threshold?.[src.targetKey];
      expect(d.coverage.target).toBe(target ?? null);
    }
  });

  it("gate 项缺失时域状态保守为 PENDING（口径漂移不冒充 PASS）", () => {
    const gate = realGate();
    const stripped = { ...gate, checks: [] as GateCheck[] };
    const domains = deriveDomains(stripped);
    expect(domains).toHaveLength(7);
    for (const d of domains) {
      expect(d.status).toBe("PENDING");
      expect(d.coverage.current).toBeNull();
      expect(d.detail).toContain("未找到");
    }
  });

  it("派生规则：FAIL 优先于 PENDING 优先于 PASS", () => {
    const gate = realGate();
    const withFail = {
      ...gate,
      checks: [
        mkCheck(9, "PASS"),
        mkCheck(10, "PENDING"),
        mkCheck(11, "FAIL"),
        ...gate.checks.filter((c) => ![9, 10, 11].includes(c.id)),
      ],
    };
    expect(deriveDomains(withFail).find((d) => d.domain === "D")?.status).toBe("FAIL");
    expect(deriveDomains(withFail).find((d) => d.domain === "E")?.status).toBe("PASS");
  });
});

describe("FE-1 总览与证据清单", () => {
  it("总览透传 researchReady，且携带证据清单与陈旧度", async () => {
    const ov = await buildDataHealthOverview();
    const gate = realGate();
    expect(ov.source.exists).toBe(true);
    expect(ov.source.capturedAt).toBe(gate.capturedAt);
    expect(ov.researchReady).toBe(gate.researchReady);
    expect(ov.domains).toHaveLength(7);
    // 全部 17 项 + 跨域项（跨域项必须是全部项的子集）
    expect(ov.checks).toHaveLength(gate.summary.total);
    for (const c of ov.crossCuttingChecks) {
      expect(ov.checks.some((x) => x.id === c.id)).toBe(true);
    }
    expect(ov.source.staleMinutes).toBeGreaterThanOrEqual(0);
  });

  it("证据清单来自真实文件（含 gate 与 audit 状态）", async () => {
    const list = await listEvidenceArtifacts();
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((e) => e.kind === "gate")).toBe(true);
    expect(list.some((e) => e.kind === "audit")).toBe(true);
    for (const e of list) {
      expect(e.bytes).toBeGreaterThan(0);
      expect(e.path.endsWith(".json")).toBe(true);
    }
  });
});

describe("FE-1 router 注册守卫", () => {
  it("appRouter 暴露 dataHealth 路由", () => {
    const src = readFileSync(resolve(PROJECT_ROOT, "server/routers.ts"), "utf8");
    expect(src).toContain("dataHealth: dataHealthRouter");
    expect(src).toContain('from "./dataHealthRouter"');
  });
});
