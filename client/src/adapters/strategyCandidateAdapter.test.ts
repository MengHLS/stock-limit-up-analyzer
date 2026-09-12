/**
 * strategyCandidateAdapter 测试。
 *
 * 重点不是「字符串长什么样」，而是三条**会误导用户**的风险点：
 *   1. 草图缺失必须显示为「未填写」而不是空字符串 —— 否则「没写规则」会被读成「规则是空的」；
 *   2. 来源缺失必须明说「已不存在」且说明是快照 —— 否则「快照而非 FK」会被读成数据损坏；
 *   3. 错误提示只能由**后端语义 code** 驱动 —— 前端不许臆造领域错误码（否则用户会去查一个不存在的码）。
 */

import { describe, expect, it } from "vitest";
import {
  candidateErrorDiagnostic,
  candidateStatusLabelOf,
  candidateToDetailVm,
  candidateToRowVm,
  CANDIDATE_SKETCH_FIELDS,
  parsePromoteWritebackDetails,
  PROMOTE_DOMAIN_HINTS,
  promoteFailureVm,
  promoteResultToVm,
  promotionProvenanceToVm,
  PROVENANCE_DISCLAIMER,
  provenanceMissingNote,
  readRpcDomainCode,
  sketchFieldText,
  sourceMissingNote,
  strategyVersionPath,
  type CandidateDetailViewLike,
  type PromoteResultLike,
  type PromotionProvenanceLike,
} from "./strategyCandidateAdapter";
import { STRATEGY_CANDIDATE_ERROR } from "../../../server/research/strategyCandidate/candidateTypes";

function view(overrides: Partial<CandidateDetailViewLike> = {}): CandidateDetailViewLike {
  return {
    candidate: {
      id: 41,
      experimentId: 7,
      conclusionId: 12,
      name: "首板隔日溢价",
      description: "首板后隔日溢价显著",
      status: "DRAFT",
      strategyDefinitionId: null,
      entryRule: { when: "first_board" },
      filterRule: null,
      exitRule: undefined,
      riskRule: { maxBoards: 3 },
      parameterSpace: { holdDays: [1, 2] },
      sourceDatasetVersionId: 900,
      sourceResearchRunId: 55,
      sourceDatasetDivergenceReason: null,
      createdAt: "2026-09-12T01:00:00.000Z",
      updatedAt: "2026-09-12T02:00:00.000Z",
    },
    experiment: { id: 7, name: "首板研究", status: "ACTIVE", datasetVersionId: 900 },
    conclusion: {
      id: 12,
      title: "首板隔日溢价",
      conclusionType: "DIRECTIONAL",
      status: "DRAFT",
      confidence: 0.72,
    },
    dataset: {
      datasetVersionId: 900,
      label: "v2",
      status: "READY",
      datasetId: 3,
      datasetCode: "first_board",
    },
    sourceMissing: [],
    ...overrides,
  };
}

describe("sketchFieldText", () => {
  it("1-a) null / undefined / 纯空白字符串都表示「未填写」", () => {
    expect(sketchFieldText(null)).toBeNull();
    expect(sketchFieldText(undefined)).toBeNull();
    expect(sketchFieldText("   ")).toBeNull();
  });

  it("1-b) 对象 → 缩进 JSON（原样，不重排语义）", () => {
    expect(sketchFieldText({ when: "first_board" })).toBe('{\n  "when": "first_board"\n}');
  });

  it("1-c) 字符串 → 原文；其它原始值 → String()", () => {
    expect(sketchFieldText("首板")).toBe("首板");
    expect(sketchFieldText(3)).toBe("3");
    expect(sketchFieldText(false)).toBe("false");
  });
});

describe("candidateStatusLabelOf", () => {
  it("2-a) 六态都有中文标签", () => {
    expect(candidateStatusLabelOf("DRAFT")).toBe("草稿");
    expect(candidateStatusLabelOf("REVIEW")).toBe("待复核");
    expect(candidateStatusLabelOf("ACCEPTED")).toBe("已采纳");
    expect(candidateStatusLabelOf("REJECTED")).toBe("已否决");
    expect(candidateStatusLabelOf("ARCHIVED")).toBe("已归档");
    expect(candidateStatusLabelOf("CONVERTED")).toBe("已转正");
  });

  it("2-b) 未收录状态回退原文、空值回退「—」（不猜）", () => {
    expect(candidateStatusLabelOf("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(candidateStatusLabelOf(null)).toBe("—");
    expect(candidateStatusLabelOf(undefined)).toBe("—");
  });
});

describe("candidateToDetailVm", () => {
  it("3-a) 基础信息 + 来源 + 草图一次映射完整", () => {
    const vm = candidateToDetailVm(view());
    expect(vm.id).toBe(41);
    expect(vm.name).toBe("首板隔日溢价");
    expect(vm.status).toBe("DRAFT");
    expect(vm.statusLabel).toBe("草稿");
    expect(vm.createdAt).toBe("2026-09-12T01:00:00.000Z");
    expect(vm.updatedAt).toBe("2026-09-12T02:00:00.000Z");
    expect(vm.source.experiment?.id).toBe(7);
    expect(vm.source.conclusion?.id).toBe(12);
    expect(vm.source.runId).toBe(55);
    expect(vm.source.dataset?.label).toBe("v2");
    expect(vm.source.missingNote).toBeNull();
  });

  it("3-b) 草图五项齐全，未填写的标 present=false（不是空字符串）", () => {
    const vm = candidateToDetailVm(view());
    expect(vm.sketch.map((s) => s.key)).toEqual([
      "entryRule",
      "filterRule",
      "exitRule",
      "riskRule",
      "parameterSpace",
    ]);
    const byKey = Object.fromEntries(vm.sketch.map((s) => [s.key, s]));
    expect(byKey.entryRule!.present).toBe(true);
    expect(byKey.filterRule!.present).toBe(false);
    expect(byKey.filterRule!.text).toBeNull();
    expect(byKey.exitRule!.present).toBe(false);
    expect(byKey.riskRule!.present).toBe(true);
    expect(byKey.parameterSpace!.text).toBe('{\n  "holdDays": [\n    1,\n    2\n  ]\n}');
  });

  it("3-c) 未转正时 strategyDefinitionId 为 null（合法状态，不伪造）", () => {
    expect(candidateToDetailVm(view()).strategyDefinitionId).toBeNull();
    const converted = view({ candidate: { ...view().candidate, status: "CONVERTED", strategyDefinitionId: "cand-41" } });
    expect(candidateToDetailVm(converted).strategyDefinitionId).toBe("cand-41");
  });

  it("3-d) sourceResearchRunId 为 null 时如实为 null（证据提不出，不伪造）", () => {
    const vm = candidateToDetailVm(view({ candidate: { ...view().candidate, sourceResearchRunId: null } }));
    expect(vm.source.runId).toBeNull();
  });

  it("3-e) 来源缺失必须转成人话，并说明是快照", () => {
    const vm = candidateToDetailVm(
      view({ experiment: null, conclusion: null, dataset: null, sourceMissing: ["EXPERIMENT", "CONCLUSION", "DATASET_VERSION"] }),
    );
    expect(vm.source.experiment).toBeNull();
    expect(vm.source.missing).toEqual(["EXPERIMENT", "CONCLUSION", "DATASET_VERSION"]);
    expect(vm.source.missingNote).toContain("来源实验在当前库中已不存在");
    expect(vm.source.missingNote).toContain("来源 Dataset 版本在 Dataset Registry 中查不到");
    expect(vm.source.missingNote).toContain("快照");
  });

  it("3-f) CANDIDATE_SKETCH_FIELDS 与 VM 输出顺序一致（防止两处顺序漂移）", () => {
    expect(candidateToDetailVm(view()).sketch.map((s) => s.key)).toEqual(
      CANDIDATE_SKETCH_FIELDS.map((f) => f.key),
    );
  });
});

describe("sourceMissingNote", () => {
  it("4-a) 无缺失 → null（不显示无用提示）", () => {
    expect(sourceMissingNote([])).toBeNull();
    expect(sourceMissingNote(null)).toBeNull();
    expect(sourceMissingNote(undefined)).toBeNull();
  });

  it("4-b) 未收录的缺失原因原样透出（不吞、不猜）", () => {
    expect(sourceMissingNote(["SOMETHING_ELSE" as never])).toContain("SOMETHING_ELSE");
  });
});

describe("candidateToRowVm", () => {
  it("5-a) 列表行保留来源结论与来源 Dataset 坐标（唯一坐标，不用 label 比对）", () => {
    const row = candidateToRowVm({
      id: 41,
      experimentId: 7,
      conclusionId: 12,
      name: "首板隔日溢价",
      status: "ACCEPTED",
      strategyDefinitionId: null,
      sourceDatasetVersionId: 900,
      createdAt: "2026-09-12T01:00:00.000Z",
    });
    expect(row.statusLabel).toBe("已采纳");
    expect(row.conclusionId).toBe(12);
    expect(row.sourceDatasetVersionId).toBe(900);
    expect(row.strategyDefinitionId).toBeNull();
  });
});

describe("candidateErrorDiagnostic", () => {
  it("6-a) 同名候选冲突：给出可执行解释 + 后端原文", () => {
    const d = candidateErrorDiagnostic(
      { message: "结论 #12 下已存在同名候选「首板隔日溢价」", data: { code: "CONFLICT" } },
      "CREATE_FROM_CONCLUSION",
    );
    expect(d.code).toBe("CONFLICT");
    expect(d.title).toContain("登记策略候选失败");
    expect(d.explanation).toContain("换一个候选名");
    expect(d.explanation).toContain("服务端说明：结论 #12 下已存在同名候选");
  });

  it("6-b) 权限不足：标题与建议都指向管理员身份", () => {
    const d = candidateErrorDiagnostic({ message: "需要 admin", data: { code: "FORBIDDEN" } }, "CREATE_FROM_CONCLUSION");
    expect(d.title).toContain("需要管理员权限");
    expect(d.suggestions?.[0]).toContain("管理员");
  });

  it("6-c) 状态流转 CONFLICT：提示按当前状态重选，不替换成前端自己的判定", () => {
    const d = candidateErrorDiagnostic(
      { message: "非法候选状态迁移：DRAFT → ACCEPTED", data: { code: "CONFLICT" } },
      "TRANSITION",
    );
    expect(d.explanation).toContain("状态机");
    expect(d.explanation).toContain("非法候选状态迁移：DRAFT → ACCEPTED");
  });

  it("6-d) 状态流转 CONFLICT 明确写出「CONVERTED 不由状态流转产生」", () => {
    const d = candidateErrorDiagnostic({ message: "x", data: { code: "CONFLICT" } }, "TRANSITION");
    expect(d.explanation).toContain("STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE");
    expect(d.explanation).toContain("CONVERTED");
  });

  it("6-e) 没有 hint 的组合只回显后端原文 —— 不编造「合理但不存在」的规则", () => {
    // 「候选已转正 ⇒ 草图不可改」是**不存在**的规则（update 只挡结构与来源字段），
    // 因此 UPDATE_SKETCH 不收录 PRECONDITION_FAILED，必须老实回显服务端原文。
    const d = candidateErrorDiagnostic(
      { message: "服务端自定义原因", data: { code: "PRECONDITION_FAILED" } },
      "UPDATE_SKETCH",
    );
    expect(d.explanation).toBe("服务端自定义原因");
    expect(d.explanation).not.toContain("CONVERTED");
  });

  it("6-f) 没有错误码时**不臆造**领域码：回退 RPC_ERROR，只展示后端原文", () => {
    const d = candidateErrorDiagnostic(new Error("socket hang up"), "UPDATE_SKETCH");
    expect(d.code).toBe("RPC_ERROR");
    expect(d.title).toContain("保存候选草图失败");
    expect(d.explanation).toBe("socket hang up");
  });

  it("6-g) 无消息、非对象输入都不崩，且给出「无错误信息」兜底", () => {
    const d = candidateErrorDiagnostic(null, "UPDATE_SKETCH");
    expect(d.code).toBe("RPC_ERROR");
    expect(d.explanation).toContain("后端未返回可读的错误信息");
    expect(d.technical).toBe("null");
  });

  it("6-h) 未收录的 code 只显示通用标题，不编解释", () => {
    const d = candidateErrorDiagnostic({ message: "too many", data: { code: "TOO_MANY_REQUESTS" } }, "TRANSITION");
    expect(d.title).toContain("请求过于频繁");
    expect(d.explanation).toBe("too many");
  });
});

// ---------------------------------------------------------------------------
// RESEARCH-006.4.1-B —— 转正结果 / 转正失败 / Research 溯源（§17 ~ §27.4）
// ---------------------------------------------------------------------------

function result(overrides: Partial<PromoteResultLike> = {}): PromoteResultLike {
  return {
    candidateId: 180001,
    strategyId: "cand-180001",
    strategyVersionId: 88001,
    strategyVersion: "1.0.0",
    provenanceId: 501,
    origin: "DIRECT",
    candidateStatus: "CONVERTED",
    sourceDatasetVersionId: 900,
    sourceDatasetLabel: "v2",
    executionDatasetVersionId: 901,
    datasetDivergence: true,
    sourceDatasetDivergenceReason: "执行域样本更长",
    fingerprint: "sha256:abc",
    idempotent: false,
    ...overrides,
  };
}

describe("promoteResultToVm", () => {
  it("7-a) 首次转正：说「转正成功」，并同时给出 Strategy 坐标与执行 Dataset", () => {
    const vm = promoteResultToVm(result(), { executionDatasetLabel: "v3" });
    expect(vm.title).toBe("转正成功");
    expect(vm.summary).toContain("cand-180001@1.0.0");
    expect(vm.summary).toContain("#901（v3）");
    expect(vm.idempotent).toBe(false);
    expect(vm.strategyVersionId).toBe(88001);
    expect(vm.strategyVersion).toBe("1.0.0");
  });

  it("7-b) 🔴 幂等命中：标题必须是「未创建新的 Strategy Version」，**不得**出现「创建成功」", () => {
    const vm = promoteResultToVm(result({ idempotent: true }), { executionDatasetLabel: "v3" });
    expect(vm.title).toBe("该候选已经转正，本次未创建新的 Strategy Version");
    expect(vm.title).not.toContain("创建成功");
    expect(vm.summary).toContain("没有");
    expect(vm.summary).toContain("复用既有 Strategy");
    expect(vm.summary).toContain("cand-180001@1.0.0");
  });

  it("7-c) 拿不到执行 Dataset 的 label 时只显示 #id（不猜一个像样的名字）", () => {
    const vm = promoteResultToVm(result());
    expect(vm.executionDatasetLabel).toBeNull();
    expect(vm.summary).toContain("#901");
    expect(vm.summary).not.toContain("（");
  });

  it("7-d) 来源/执行两个 Dataset 坐标与分歧原因原样带出（对照展示用，不重算）", () => {
    const vm = promoteResultToVm(result(), { executionDatasetLabel: "v3" });
    expect(vm.sourceDatasetVersionId).toBe(900);
    expect(vm.sourceDatasetLabel).toBe("v2");
    expect(vm.executionDatasetVersionId).toBe(901);
    expect(vm.datasetDivergence).toBe(true);
    expect(vm.sourceDatasetDivergenceReason).toBe("执行域样本更长");
    expect(vm.fingerprint).toBe("sha256:abc");
  });
});

describe("strategyVersionPath", () => {
  it("8-a) 落点是**现有**策略页 + 坐标查询参数 —— 不新增第二套 Strategy Version 页面", () => {
    expect(strategyVersionPath("cand-180001", "1.0.0")).toBe(
      "/strategy-editor?strategyId=cand-180001&version=1.0.0",
    );
  });

  it("8-b) 坐标做 URL 编码（不裸拼，特殊字符不会串位）", () => {
    const path = strategyVersionPath("a b/c", "1.0.0+build");
    expect(path).toContain("strategyId=a%20b%2Fc");
    expect(path).toContain("version=1.0.0%2Bbuild");
  });

  it("8-c) promoteResultToVm 产出的 path 与直接构造一致（不会两处漂移）", () => {
    const vm = promoteResultToVm(result());
    expect(vm.path).toBe(strategyVersionPath("cand-180001", "1.0.0"));
  });
});

function rpcError(message: string, trpcCode: string) {
  return { message, data: { code: trpcCode } };
}

/** 模拟后端 `withDomainCode`：领域码写在 message 里，tRPC code 保持不变。 */
function promoteError(code: string, trpcCode: string, tail = "") {
  return rpcError(`[${code}] 转正失败${tail}`, trpcCode);
}

/**
 * 转正链路上真实会发生的 14 个领域错误码 → 各自对应的 tRPC code。
 *
 * 🔴 映射**逐条对照** `server/research/strategyCandidate/router.ts#toTrpcError`
 * （不是猜的）：前置条件类 → `PRECONDITION_FAILED`；入参 / 坐标类 → `BAD_REQUEST`；
 * 与既有事实冲突 → `CONFLICT`；找不到 → `NOT_FOUND`。
 */
const FAILING_CODES = [
  { code: STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED, trpc: "PRECONDITION_FAILED" },
  { code: STRATEGY_CANDIDATE_ERROR.PROMOTE_SOURCE_INCOMPLETE, trpc: "PRECONDITION_FAILED" },
  { code: STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE, trpc: "PRECONDITION_FAILED" },
  { code: STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID, trpc: "BAD_REQUEST" },
  { code: STRATEGY_CANDIDATE_ERROR.PROMOTE_DEFINITION_INVALID, trpc: "PRECONDITION_FAILED" },
  { code: STRATEGY_CANDIDATE_ERROR.DATASET_DIVERGENCE_REASON_REQUIRED, trpc: "BAD_REQUEST" },
  { code: STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_READY, trpc: "PRECONDITION_FAILED" },
  { code: STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_FOUND, trpc: "NOT_FOUND" },
  { code: STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_INVALID, trpc: "PRECONDITION_FAILED" },
  { code: STRATEGY_CANDIDATE_ERROR.DATASET_BINDING_INVALID, trpc: "BAD_REQUEST" },
  { code: STRATEGY_CANDIDATE_ERROR.PROMOTE_STRATEGY_ID_CONFLICT, trpc: "CONFLICT" },
  { code: STRATEGY_CANDIDATE_ERROR.PROMOTE_VERSION_CONFLICT, trpc: "CONFLICT" },
  { code: STRATEGY_CANDIDATE_ERROR.PROMOTE_STATE_INCONSISTENT, trpc: "CONFLICT" },
  { code: STRATEGY_CANDIDATE_ERROR.INVALID_INPUT, trpc: "BAD_REQUEST" },
] as const;

describe("readRpcDomainCode（§7 领域码跨 tRPC 边界的读取约定）", () => {
  it("9-a) 只认 `[CODE]` 写法：裸词 / 小写 / 长度不足都不算领域码（不推断）", () => {
    expect(readRpcDomainCode({ message: "STRATEGY_CANDIDATE_NOT_ACCEPTED 转正失败", data: {} })).toBeNull();
    expect(readRpcDomainCode({ message: "[X] y", data: {} })).toBeNull();
    expect(readRpcDomainCode({ message: "[strategy_candidate_x] y", data: {} })).toBeNull();
    expect(readRpcDomainCode({ message: "[ABC] y", data: {} })).toBe("ABC");
    expect(
      readRpcDomainCode({ message: "[STRATEGY_CANDIDATE_NOT_ACCEPTED] y", data: {} }),
    ).toBe("STRATEGY_CANDIDATE_NOT_ACCEPTED");
  });

  it("9-b) 领域码在 message 开头 —— 与后端 `withDomainCode` 拼接顺序一致", () => {
    const message = `[${STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE}] 策略草图缺少必填内容`;
    expect(readRpcDomainCode(rpcError(message, "BAD_REQUEST"))).toBe(
      STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE,
    );
  });
});

describe("promoteFailureVm（§11 / §27.4）", () => {
  it("9-c) 14 个领域码得到**两两不同**的诊断（≥7 个各不相同，不能一句话糊弄所有失败）", () => {
    const seen = new Map<string, string>();
    for (const { code, trpc } of FAILING_CODES) {
      const vm = promoteFailureVm(promoteError(code, trpc));
      expect(vm.domainCode).toBe(code);
      expect(vm.diagnostic.code).toBe(code);
      expect(vm.trpcCode).toBe(trpc);
      expect(vm.diagnostic.title.startsWith("转正失败：")).toBe(true);
      const fingerprint = `${vm.diagnostic.title}｜${vm.diagnostic.explanation}`;
      expect(seen.has(fingerprint), `${code} 与 ${seen.get(fingerprint)} 诊断完全相同`).toBe(false);
      seen.set(fingerprint, code);
    }
    expect(seen.size).toBe(FAILING_CODES.length);
    expect(seen.size).toBeGreaterThanOrEqual(7);
  });

  it("9-d) 领域解释与后端原文**同时**呈现（不吞原文，用户与开发者都能看懂）", () => {
    const vm = promoteFailureVm(
      promoteError(STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_READY, "BAD_REQUEST", "：dataset_version 902"),
    );
    expect(vm.diagnostic.explanation).toContain("只有 READY 的 Dataset 版本");
    expect(vm.diagnostic.explanation).toContain("服务端说明：");
    expect(vm.diagnostic.explanation).toContain("dataset_version 902");
  });

  it("9-e) 拿不到领域码（如 zod 传输层拒绝）→ 不臆造，回退 tRPC 通用标题并保留原文", () => {
    const vm = promoteFailureVm(rpcError("Too small: expected number", "BAD_REQUEST"));
    expect(vm.domainCode).toBeNull();
    expect(vm.diagnostic.code).toBe("BAD_REQUEST");
    expect(vm.diagnostic.title).toBe("转正失败：请求内容不合法");
    expect(vm.diagnostic.explanation).toBe("Too small: expected number");
    expect(vm.writeback).toBeNull();
  });

  it("9-f) 完全没有可用信息也不崩，且不编造领域码", () => {
    const vm = promoteFailureVm(new Error("socket hang up"));
    expect(vm.domainCode).toBeNull();
    expect(vm.trpcCode).toBeNull();
    expect(vm.diagnostic.code).toBe("RPC_ERROR");
    expect(vm.diagnostic.explanation).toBe("socket hang up");
  });

  it("9-g) 🔴 写回失败：解析后端 details 的三个坐标 + stage，并劝「不要新建候选」", () => {
    const vm = promoteFailureVm(
      promoteError(
        STRATEGY_CANDIDATE_ERROR.PROMOTE_WRITEBACK_FAILED,
        "INTERNAL_SERVER_ERROR",
        "（strategyId=cand-180001 / strategyVersionId=88001 / strategyVersion=1.0.0 / stage=PROVENANCE_WRITE）",
      ),
    );
    expect(vm.domainCode).toBe(STRATEGY_CANDIDATE_ERROR.PROMOTE_WRITEBACK_FAILED);
    expect(vm.writeback).not.toBeNull();
    expect(vm.writeback!.strategyId).toBe("cand-180001");
    expect(vm.writeback!.strategyVersionId).toBe("88001");
    expect(vm.writeback!.strategyVersion).toBe("1.0.0");
    expect(vm.writeback!.stage).toBe("PROVENANCE_WRITE");
    expect(vm.diagnostic.suggestions?.join()).toContain("不要创建新的候选");
    expect(vm.diagnostic.suggestions?.join()).toContain("幂等闸门");
  });

  it("9-h) 只有写回失败才带 writeback 坐标（其余失败绝不显示「已产出的 Strategy」）", () => {
    for (const { code, trpc } of FAILING_CODES) {
      expect(promoteFailureVm(promoteError(code, trpc)).writeback, `${code} 不该有写回坐标`).toBeNull();
    }
  });

  it("9-i) 草图类失败的建议是「回去改草稿」，不是「在转正时另给定义」", () => {
    const incomplete = promoteFailureVm(
      promoteError(STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INCOMPLETE, "BAD_REQUEST"),
    );
    expect(incomplete.diagnostic.suggestions?.join()).toContain("补齐");
    const invalid = promoteFailureVm(
      promoteError(STRATEGY_CANDIDATE_ERROR.PROMOTE_SKETCH_INVALID, "BAD_REQUEST"),
    );
    expect(invalid.diagnostic.suggestions?.join()).toContain("修正草图");
  });

  it("9-j) 状态不对时建议「先流转到 ACCEPTED」（可执行，而不是泛泛重试）", () => {
    const vm = promoteFailureVm(
      promoteError(STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_ACCEPTED, "PRECONDITION_FAILED"),
    );
    expect(vm.diagnostic.suggestions?.join()).toContain("ACCEPTED");
    expect(vm.diagnostic.title).toContain("不是「已采纳」状态");
  });
});

// ---------------------------------------------------------------------------
// Research 溯源（只读）：§20 ~ §23
// ---------------------------------------------------------------------------

function provenanceView(overrides: Partial<PromotionProvenanceLike> = {}): PromotionProvenanceLike {
  return {
    strategyId: "cand-180001",
    version: "1.0.0",
    strategyVersionId: 88001,
    provenance: {
      id: 501,
      origin: "DIRECT",
      sourceCandidateId: 180001,
      sourceConclusionId: 12,
      sourceExperimentId: 7,
      sourceResearchRunId: 55,
      sourceDatasetVersionId: 900,
      sourceDatasetLabel: "v2",
      createdAt: "2026-09-12T03:00:00.000Z",
    },
    executionDatasetVersionId: 901,
    executionDatasetLabel: "v3",
    sourceDatasetDivergenceReason: "执行域样本更长",
    missingUpstreams: [],
    ...overrides,
  };
}

describe("promotionProvenanceToVm", () => {
  it("10-a) 完整溯源：来源类型 + 五个上游坐标 + 创建时间，一项不少", () => {
    const vm = promotionProvenanceToVm(provenanceView());
    expect(vm.hasProvenance).toBe(true);
    expect(vm.originLabel).toBe("DIRECT");
    const byLabel = Object.fromEntries(vm.rows.map((r) => [r.label, r]));
    expect(Object.keys(byLabel)).toEqual([
      "来源类型",
      "Source Candidate ID",
      "Source Conclusion ID",
      "Source Experiment ID",
      "Source Research Run ID",
      "Source Dataset Version ID",
      "Source Dataset Label",
      "Created At",
    ]);
    expect(byLabel["来源类型"]!.value).toBe("DIRECT");
    expect(byLabel["Source Candidate ID"]!.value).toBe("180001");
    expect(byLabel["Source Conclusion ID"]!.value).toBe("12");
    expect(byLabel["Source Experiment ID"]!.value).toBe("7");
    expect(byLabel["Source Research Run ID"]!.value).toBe("55");
    expect(byLabel["Source Dataset Version ID"]!.value).toBe("900");
    expect(byLabel["Source Dataset Label"]!.value).toBe("v2");
    expect(byLabel["Created At"]!.value).toBe("2026-09-12T03:00:00.000Z");
  });

  it("10-b) 没有溯源行（未转正 / 非本系统产出）→ hasProvenance=false 且**不生成**空行", () => {
    const vm = promotionProvenanceToVm(provenanceView({ provenance: null }));
    expect(vm.hasProvenance).toBe(false);
    expect(vm.rows).toEqual([]);
    expect(vm.originLabel).toBe("—");
    expect(vm.missingNote).toBeNull();
  });

  it("10-c) 上游已删除：如实标注该行缺失 + 明说「不影响策略读取与执行」（§23）", () => {
    const vm = promotionProvenanceToVm(
      provenanceView({ missingUpstreams: ["SOURCE_CONCLUSION", "SOURCE_RESEARCH_RUN"] }),
    );
    const byLabel = Object.fromEntries(vm.rows.map((r) => [r.label, r]));
    expect(byLabel["Source Conclusion ID"]!.missing).toBe(true);
    expect(byLabel["Source Research Run ID"]!.missing).toBe(true);
    expect(byLabel["Source Candidate ID"]!.missing).toBe(false);
    // 快照值本身**不丢**：行还在，只是被标记。
    expect(byLabel["Source Conclusion ID"]!.value).toBe("12");
    expect(vm.missingNote).toContain("来源结论");
    expect(vm.missingNote).toContain("来源 Research Run");
    expect(vm.missingNote).toContain("已不存在");
    expect(vm.missingNote).toContain("这不影响该策略的读取与执行");
  });

  it("10-d) 无缺失时不显示无用提示", () => {
    expect(promotionProvenanceToVm(provenanceView()).missingNote).toBeNull();
    expect(provenanceMissingNote([])).toBeNull();
    expect(provenanceMissingNote(null)).toBeNull();
    expect(provenanceMissingNote(undefined)).toBeNull();
  });

  it("10-e) 来源 Dataset 与执行 Dataset **两个坐标都保留**（对照展示，不合并、不覆盖）", () => {
    const vm = promotionProvenanceToVm(provenanceView());
    expect(vm.executionDatasetVersionId).toBe(901);
    expect(vm.executionDatasetLabel).toBe("v3");
    const sourceRow = vm.rows.find((r) => r.label === "Source Dataset Version ID")!;
    expect(sourceRow.value).toBe("900");
    expect(vm.sourceDatasetDivergenceReason).toBe("执行域样本更长");
  });

  it("10-f) 缺值一律显示 null（如实留空，不补 0 / 不补「未知」）", () => {
    const vm = promotionProvenanceToVm(
      provenanceView({
        provenance: {
          id: 501,
          origin: "DIRECT",
          sourceCandidateId: 180001,
          sourceConclusionId: 12,
          sourceExperimentId: 7,
          sourceResearchRunId: null,
          sourceDatasetVersionId: null,
          sourceDatasetLabel: null,
          createdAt: null,
        },
      }),
    );
    const byLabel = Object.fromEntries(vm.rows.map((r) => [r.label, r]));
    expect(byLabel["Source Research Run ID"]!.value).toBeNull();
    expect(byLabel["Source Dataset Version ID"]!.value).toBeNull();
    expect(byLabel["Source Dataset Label"]!.value).toBeNull();
    expect(byLabel["Created At"]!.value).toBeNull();
  });

  it("10-g) 免责声明是原话：溯源不参与执行（§13 要求必须展示）", () => {
    expect(PROVENANCE_DISCLAIMER).toBe(
      "Research Provenance 仅用于来源追溯，不参与 Strategy 执行。",
    );
  });
});

describe("parsePromoteWritebackDetails", () => {
  it("11-a) 解析后端 `describeDetails` 的真实格式（key=value / key=value）", () => {
    const details = parsePromoteWritebackDetails(
      "[STRATEGY_CANDIDATE_PROMOTE_WRITEBACK_FAILED] 转正失败（strategyId=cand-180001 / strategyVersionId=88001 / strategyVersion=1.0.0 / stage=PROVENANCE_WRITE）",
    );
    expect(details).toEqual({
      strategyId: "cand-180001",
      strategyVersionId: "88001",
      strategyVersion: "1.0.0",
      stage: "PROVENANCE_WRITE",
    });
  });

  it("11-b) 解析不到就全 null（**绝不**用本地状态补一个看起来对的 id）", () => {
    expect(parsePromoteWritebackDetails("转正失败：内部错误")).toEqual({
      strategyId: null,
      strategyVersionId: null,
      strategyVersion: null,
      stage: null,
    });
  });

  it("11-c) 键名必须完全匹配：近似的错误键名不会被误读", () => {
    const details = parsePromoteWritebackDetails("（strategy_id=x / strategyversion=1.0.0 / Stage=y）");
    expect(details.strategyId).toBeNull();
    expect(details.strategyVersion).toBeNull();
    expect(details.stage).toBeNull();
  });

  it("11-d) 键存在但值为空 → null（不把空串当坐标）", () => {
    const details = parsePromoteWritebackDetails("（strategyId=/ stage=）");
    expect(details.strategyId).toBeNull();
    expect(details.stage).toBeNull();
  });
});
