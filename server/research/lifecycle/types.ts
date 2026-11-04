/**
 * STEP 21 / C-21.1 — Strategy Lifecycle Management：策略生命周期状态机 + 审计（类型权威源）。
 *
 * 目标（ROADMAP §23）：完整管理 Draft → Research → Candidate → Validated → Paper →
 * Approved → Production → Retired 全生命周期；每次状态变化必须有 timestamp / reason /
 * experiment / evidence 四要素；禁止策略无记录地修改。§45.2：研究结论（Research→Candidate）
 * 与进入生产前必须 Validated（数据链就绪认证），禁止无证据升级。
 *
 * 两套状态机的关系（必须区分，禁止概念污染）：
 *   - §7「项目任务 7 态」（DESIGN/CODE_READY/DATA_READY/VALIDATED/RESEARCH_READY/
 *     PRODUCTION_READY/BLOCKED）：描述**子系统/交付物**（引擎、数据集、本任务……）的
 *     开发成熟度，由协调者在 ROADMAP/TASK_TRACKING 记账；
 *   - §23「策略生命周期 8 态」（本目录）：描述**单个策略本体版本**（C-15.1
 *     StrategyVersionRecord）的研究治理状态，是其内容寻址版本的「生命周期壳」。
 *     二者维度不同：本项目「engine 层 VALIDATED」≠「某策略生命周期 Validated」。
 *     本目录只做策略生命周期；与 7 态的映射仅用于汇报（见 conceptMap.ts），
 *     断言「生命周期 Research/Candidate/Paper… 一律不得上报为任务 VALIDATED」。
 *
 * 载体决策（差距判定）：
 *   - C-15.1 strategySchema 已交付 StrategyDocument（§16 本体）+ StrategyVersionRecord
 *     （§17 九项追溯：snapshot/parameters/dataset/universe/backtest/cost/execution/
 *     codeVersion/createdAt + bump 语义）。其 types.ts 明确声明「生命周期状态机属 C-21.1，
 *     本目录不做」，**无 status/lifecycle 字段**；
 *   - 本目录提供「壳层」StrategyLifecycleRecord：绑定一个 StrategyVersionRecord
 *     （以 versionRecordFingerprint 内容寻址锚定），不修改 strategySchema 任何既有文件；
 *   - C-13.3 experimentLineage 已覆盖 §28 实验谱系（实验「怎么产生」）；本目录的
 *     LifecycleTransition.experimentId / evidence 是对其记录/产物的**引用**（注入式、
 *     只校验格式与必填性，不连 DB、不跑真实 gate——由未来 runner 接线后真实验证）。
 *
 * 不可变性与审计（§23「禁止无记录修改」）：
 *   - StrategyLifecycleRecord 与 LifecycleTransition 全部 readonly、深冻结；
 *   - 状态每次变化 = append 一条 LifecycleTransition（genesis 首跳 from=null），
 *     任何迁移 API 都同步产出一条 transition（见 map.ts/ledger.ts），不存在
 *     「只改状态不落审计」的入口（fail fast）；
 *   - 防篡改可校验链：每条 transition 的 hash = sha256(prevHash + 本跳全部字段)，
 *     改动任何历史跳都会使后续 hash 链断裂，serialize/deserialize/verify 时复核。
 *
 * 铁律：纯模块，无 DB / 无 Date.now / 无 Math.random / 无 IO；不可变、可序列化、确定性；
 * 失败响亮（中文信息）。timestamp/actor/codeVersion 类注入式——本模块不取时钟。
 */

// ---------------------------------------------------------------------------
// 记录书签
// ---------------------------------------------------------------------------

/** 策略生命周期壳记录种类标签（供序列化 / 反序列化判别）。 */
export const STRATEGY_LIFECYCLE_RECORD_KIND = "STRATEGY_LIFECYCLE_RECORD" as const;

/** 生命周期壳记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const STRATEGY_LIFECYCLE_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// §23 八态（顺序即规范推进顺序，权威来源；禁止散落各处硬编码状态字符串）
// ---------------------------------------------------------------------------

/**
 * §23 生命周期八态，按规范顺序（Draft 最早 → Retired 最晚）。
 * 状态值采用 ROADMAP §23 原文大小写（Draft/Research/…），作为记录的稳定身份。
 */
export const STRATEGY_LIFECYCLE_STATUSES = [
  "Draft",
  "Research",
  "Candidate",
  "Validated",
  "Paper",
  "Approved",
  "Production",
  "Retired",
] as const;

export type StrategyLifecycleStatus = (typeof STRATEGY_LIFECYCLE_STATUSES)[number];

/** 逐状态常量（供迁移表 Record 键与调用方引用，防拼写漂移）。 */
export const STRATEGY_STATUS_DRAFT = "Draft" as const;
export const STRATEGY_STATUS_RESEARCH = "Research" as const;
export const STRATEGY_STATUS_CANDIDATE = "Candidate" as const;
export const STRATEGY_STATUS_VALIDATED = "Validated" as const;
export const STRATEGY_STATUS_PAPER = "Paper" as const;
export const STRATEGY_STATUS_APPROVED = "Approved" as const;
export const STRATEGY_STATUS_PRODUCTION = "Production" as const;
export const STRATEGY_STATUS_RETIRED = "Retired" as const;

/** 值是否为 §23 合法生命周期状态。 */
export function isStrategyLifecycleStatus(value: string): value is StrategyLifecycleStatus {
  return (STRATEGY_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

/** 生命周期状态在 §23 规范链上的次序（0 = Draft，7 = Retired；用于 advance/rollback 判定）。 */
export const STRATEGY_LIFECYCLE_STATUS_ORDER: Readonly<Record<StrategyLifecycleStatus, number>> = {
  Draft: 0,
  Research: 1,
  Candidate: 2,
  Validated: 3,
  Paper: 4,
  Approved: 5,
  Production: 6,
  Retired: 7,
};

/** Retired 是否为终态：是（本版本不可复活；复活 = bump 出新版本 + 新生命周期壳，见 transition.ts）。 */
export const STRATEGY_LIFECYCLE_TERMINAL_STATUS = STRATEGY_STATUS_RETIRED;

/** genesis（新建壳）允许的初始状态：仅 Draft（默认）或 Research（需 inheritance 证据的版本演进继承）。 */
export const STRATEGY_LIFECYCLE_GENESIS_STATUSES = [STRATEGY_STATUS_DRAFT, STRATEGY_STATUS_RESEARCH] as const;
export type StrategyLifecycleGenesisStatus = (typeof STRATEGY_LIFECYCLE_GENESIS_STATUSES)[number];

// ---------------------------------------------------------------------------
// Evidence 引用（§23 evidence：结果引用；本任务只校验格式与必填性，不执行真实验证）
// ---------------------------------------------------------------------------

/** Evidence 引用载体种类白名单。 */
export const LIFECYCLE_EVIDENCE_KINDS = [
  "datasetGate",    // 数据链 gate 结果（C-12.6.x Research Dataset gate，rd-… 数据集版本）
  "metricsRecord",  // 绩效/评估记录 id（C-16.x 评估产出；result 为达标声明）
  "searchRun",      // 候选策略产出 run（C-17.x 参数搜索/候选生成）
  "paperRun",       // 纸面/模拟盘 run（STEP 23 paper trading 链路）
  "approval",       // 审批/复核文档（Approved 治理动作的文档化引用）
  "inheritance",    // 版本演进继承（新 StrategyVersionRecord 的生命周期壳出生引用父壳）
] as const;

export type LifecycleEvidenceKind = (typeof LIFECYCLE_EVIDENCE_KINDS)[number];

/**
 * 数据链 gate 结果引用（§45.2：进入 Validated / Production 前必须数据链就绪认证）。
 * gate 值域与 researchDataset/types.ts ResearchDatasetGate 对齐（FAIL/PASS/INCONCLUSIVE）。
 */
export interface LifecycleDatasetGateEvidence {
  readonly kind: "datasetGate";
  readonly gate: "FAIL" | "PASS" | "INCONCLUSIVE";
  /** 内容寻址数据集版本（rd-…；validator 校验格式，与策略 datasetVersion 语义对齐）。 */
  readonly datasetVersion: string;
  readonly note?: string;
}

/** 绩效/评估记录达标引用（metricsId = C-16.x 评估记录 id，由未来 runner 接线；result 达标声明）。 */
export interface LifecycleMetricsRecordEvidence {
  readonly kind: "metricsRecord";
  readonly metricsId: string;
  /** 达标声明：PASS/FAIL（→Validated 等阈值检查要求 PASS）。 */
  readonly result: "PASS" | "FAIL";
  readonly note?: string;
}

/** 候选策略产出 run 引用（C-17.x 搜索 run id）。 */
export interface LifecycleSearchRunEvidence {
  readonly kind: "searchRun";
  readonly runId: string;
}

/** 纸面/模拟盘 run 引用（STEP 23 paper trading run id）。 */
export interface LifecyclePaperRunEvidence {
  readonly kind: "paperRun";
  readonly runId: string;
}

/** 审批/复核文档引用（decision 表达文档裁定的去向）。 */
export interface LifecycleApprovalEvidence {
  readonly kind: "approval";
  readonly documentId: string;
  readonly decision: "approved" | "rejected";
}

/** 版本演进继承引用（genesis 以 Research 出生时的父壳锚点；Retired 版本复活 = 新版本壳引用其父）。 */
export interface LifecycleInheritanceEvidence {
  readonly kind: "inheritance";
  /** 父生命周期壳记录（strategyId@version 的可读锚点，如 "lc-limit-up-baseline@2.0.0"）。 */
  readonly parentLifecycleId: string;
  /** 父壳当前状态（须为合法生命周期状态，且不得为 Draft——见 gates.ts 语义）。 */
  readonly parentStatus: StrategyLifecycleStatus;
}

/** §23 evidence 引用（判别联合）。 */
export type LifecycleEvidenceRef =
  | LifecycleDatasetGateEvidence
  | LifecycleMetricsRecordEvidence
  | LifecycleSearchRunEvidence
  | LifecyclePaperRunEvidence
  | LifecycleApprovalEvidence
  | LifecycleInheritanceEvidence;

/** 值是否为合法 evidence 引用形状（浅判；深校验见 validate.ts）。 */
export function isLifecycleEvidenceRef(value: unknown): value is LifecycleEvidenceRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (LIFECYCLE_EVIDENCE_KINDS as readonly string[]).includes(String(kind));
}

// ---------------------------------------------------------------------------
// LifecycleTransition（§23 每次状态变化的一条审计记录）
// ---------------------------------------------------------------------------

/**
 * 一次生命周期迁移的审计记录（append-only 链节）。
 *
 * §23 四要素映射：
 *   - timestamp  → timestamp（注入式 ISO-8601 UTC，本模块不取时钟）；
 *   - reason     → reason（必填非空，人类可读；禁止空 reason 的静默迁移）；
 *   - experiment → experimentId（引用产生该次状态结论的实验；规则见 gates.ts，
 *                  关键升级必填，Draft→Research / 回退 / 退役等治理决策显式可空）；
 *   - evidence   → evidence（引用 gate/metrics/run/审批文档；阈值见 gates.ts）。
 *
 * 防篡改：hash = sha256(seq/from/to/timestamp/reason/experimentId/evidence/actor/prevHash)；
 * genesis 首跳 from=null、prevHash=null。seq 从 0 连续递增。
 */
export interface LifecycleTransition {
  /** 链内序号（0 = genesis；非 genesis 必须 = 前一条 seq + 1）。 */
  readonly seq: number;
  /** 迁移前状态；genesis 首跳为 null（记录诞生，非状态迁移）。 */
  readonly from: StrategyLifecycleStatus | null;
  readonly to: StrategyLifecycleStatus;
  /** 迁移时间（注入式，ISO-8601 UTC：YYYY-MM-DDTHH:mm:ss[.sss]Z）。 */
  readonly timestamp: string;
  /** 迁移原因（必填非空；§23 reason）。 */
  readonly reason: string;
  /** §23 experiment 引用（可空语义与必填规则见 gates.ts；显式 null 表示治理决策/研究启动）。 */
  readonly experimentId: string | null;
  /** §23 evidence 引用清单（可空迁移允许空数组；关键升级阈值见 gates.ts）。 */
  readonly evidence: readonly LifecycleEvidenceRef[];
  /** 操作人（注入式身份，可空）。 */
  readonly actor: string | null;
  /** 前一条 transition 的 hash；genesis 首跳为 null。 */
  readonly prevHash: string | null;
  /** 本跳内容指纹（sha256 hex）：含 prevHash 但不含本字段自身。 */
  readonly hash: string;
}

// ---------------------------------------------------------------------------
// StrategyLifecycleRecord（§23 生命周期壳：与策略本体的绑定）
// ---------------------------------------------------------------------------

/**
 * 给 §16/§17 策略版本（StrategyVersionRecord）加的生命周期壳（只读不改 strategySchema）。
 *
 * 版本绑定语义（设计决策，见本文件头注释）：
 *   - 一个壳**恰好绑定一个策略版本**（strategyId + strategyVersion + 内容指纹
 *     versionRecordFingerprint）。版本内容变化（C-15.1 cloneStrategyDocument bump）产出
 *     新 StrategyVersionRecord → 需为它建新壳；新壳可以 genesis 到 Draft（重新走链），
 *     或以 inheritance 证据 genesis 到 Research（版本演进继承，见 gates.ts 语义）。
 *   - Retired 是终态（同一版本不可复活）；「复活」= bump 出更新版本 + 新壳 genesis
 *     Research（inheritance 引用 Retired 父壳）。这样历史链永不改写。
 *
 * 一致性不变量（validate 复核）：transitions[0] 为 genesis（from=null）；非 genesis 跳的
 * from === 上一跳 to；本记录 status === 最后一跳 to；chain hash 逐跳可复核。
 */
export interface StrategyLifecycleRecord {
  readonly recordKind: typeof STRATEGY_LIFECYCLE_RECORD_KIND;
  readonly recordVersion: typeof STRATEGY_LIFECYCLE_RECORD_VERSION;

  /** 被治理策略 id（= StrategyVersionRecord.strategyId）。 */
  readonly strategyId: string;
  /** 被治理策略版本（严格 major.minor.patch）。 */
  readonly strategyVersion: string;
  /** 绑定的 §17 版本追溯记录内容指纹（sha256 hex 64 位；内容寻址锚定，防版本重名串绑）。 */
  readonly versionRecordFingerprint: string;

  /** 当前生命周期状态（= 迁移历史最后一跳的 to）。 */
  readonly status: StrategyLifecycleStatus;

  /** 迁移历史（append-only；含 genesis 首跳；按 seq 升序，chain hash 防篡改）。 */
  readonly transitions: readonly LifecycleTransition[];

  /** 内容指纹（sha256 hex）：除本字段外全部字段的 canonical JSON 摘要（含整条 chain）。 */
  readonly fingerprint: string;
}

/** createStrategyLifecycleRecord 输入（recordKind/recordVersion/status/transitions/fingerprint 由组装层固定）。 */
export interface StrategyLifecycleRecordInput {
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 绑定的 §17 版本追溯记录指纹（sha256 hex 64 位）。 */
  readonly versionRecordFingerprint: string;
  /** 初始状态：缺省 Draft；Research 需 evidence 含 inheritance（见 gates.ts）。 */
  readonly initialStatus?: StrategyLifecycleGenesisStatus;
  // -- genesis 跳的 §23 四要素（timestamp/reason 必填） --
  /** 壳创建时间（注入式 ISO-8601 UTC）。 */
  readonly timestamp: string;
  /** 壳创建/继承原因（必填非空；如「新基线 v2.0.0 启动生命周期」/「继承自父壳 1.0.0 的研究态」）。 */
  readonly reason: string;
  /** genesis 实验引用（可空；genesis 一般无实验可引，显式语义见 gates.ts）。 */
  readonly experimentId?: string | null;
  /** genesis evidence（initialStatus=Research 时必须含 inheritance 引用）。 */
  readonly evidence?: readonly LifecycleEvidenceRef[];
  /** 操作人（注入式，可空）。 */
  readonly actor?: string | null;
}

/**
 * applyLifecycleTransition 输入（from 取记录当前 status，不随输入传入，防止来源漂移）。
 * timestamp/reason 必填；其余按 gates.ts 阈值校验。
 */
export interface LifecycleTransitionInput {
  readonly to: StrategyLifecycleStatus;
  /** 迁移时间（注入式 ISO-8601 UTC）。 */
  readonly timestamp: string;
  /** 迁移原因（必填非空；§23 reason）。 */
  readonly reason: string;
  /** §23 experiment 引用（必填规则见 gates.ts）。 */
  readonly experimentId?: string | null;
  /** §23 evidence（关键升级阈值见 gates.ts）。 */
  readonly evidence?: readonly LifecycleEvidenceRef[];
  /** 操作人（注入式，可空）。 */
  readonly actor?: string | null;
}
