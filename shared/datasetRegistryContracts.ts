/**
 * STEP DATASET-002.2 — Dataset Registry tRPC 契约（shared 层：前后端共享的唯一契约来源）。
 *
 * 定位（与 researchContracts.ts 同源，ROADMAP §2 正确性优先 / §9 Frontend 不是 Quant Engine）：
 * - 本文件只描述**传输形状**（入参校验 + 返回 wire 类型），不定义量化语义；
 *   一切语义（PIT / 首板 / 回踩 / 结果口径）由后端 `server/datasetRegistry/*` 权威给出。
 * - **写端点收敛**：updateDefinition / archiveDefinition / createDatasetVersion /
 *   createBuildJob / startBuildJob / cancelBuildJob / retryBuildJob 为 admin 专属写端点；
 *   其余（Definition / Version / Build Job / Statistics / Event / Path / Outcome）为只读。
 *   不触碰旧 `researchDataset.*`。
 * - 枚举值以 `as const` 字面量数组 + zod enum 双写，由契约单测断言与后端领域类型一致，防静默漂移。
 * - 分页：Event / Path / Outcome 禁止 `SELECT *` 全量返回，统一 keyset 分页（cursor 为不透明字符串，
 *   前端原样回传，不解析、不构造）。
 *
 * ### BigInt / Number 安全（§五）###
 * 数据库 `id` / `datasetId` / `datasetVersionId` / `totalEvents` / `totalRows` / `processedRows` 等
 * 均 `bigint(mode: "number")`（见 drizzle/schema.ts 与 migration 0028）。这些值在本项目语义下
 * （auto-increment 主键 + 行计数，百万级）恒远小于 JS `Number.MAX_SAFE_INTEGER`（2^53-1 ≈ 9.007e15），
 * 可安全以 number 表示。契约层为此加防御：所有 id 入参用 `safeIntId`（.positive().max(MAX_SAFE_INTEGER)），
 * 任何越界值在进入 SQL 前即被拒绝，禁止前端收到不可安全表示的 bigint。
 */

import { z } from "zod";
import { isoDateSchema } from "./researchContracts";

// ---------------------------------------------------------------------------
// 枚举（传输层字面量，与后端 server/datasetRegistry/types.ts 领域类型一致）
// ---------------------------------------------------------------------------

export const DATASET_DEFINITION_TYPE_VALUES = [
  "EVENT",
  "FACTOR",
  "ML",
  "RESEARCH",
] as const;
export const datasetDefinitionTypeSchema = z.enum(DATASET_DEFINITION_TYPE_VALUES);
export type DatasetDefinitionType = (typeof DATASET_DEFINITION_TYPE_VALUES)[number];

export const DATASET_STORAGE_TYPE_VALUES = ["DATABASE"] as const;
export const datasetStorageTypeSchema = z.enum(DATASET_STORAGE_TYPE_VALUES);
export type DatasetStorageType = (typeof DATASET_STORAGE_TYPE_VALUES)[number];

export const DATASET_DEFINITION_STATUS_VALUES = ["ACTIVE", "ARCHIVED"] as const;
export const datasetDefinitionStatusSchema = z.enum(DATASET_DEFINITION_STATUS_VALUES);
export type DatasetDefinitionStatus = (typeof DATASET_DEFINITION_STATUS_VALUES)[number];

export const DATASET_VERSION_STATUS_VALUES = [
  "DRAFT",
  "BUILDING",
  "READY",
  "FAILED",
] as const;
export const datasetVersionStatusSchema = z.enum(DATASET_VERSION_STATUS_VALUES);
export type DatasetVersionStatus = (typeof DATASET_VERSION_STATUS_VALUES)[number];

/**
 * 版本标签（version）正则：**前后端唯一同源**（server/datasetRegistry/naming.ts 复用本常量）。
 * 版本是 dataset_version 内的业务标签（如 `v1` / `2024-full`），不参与物理表命名，
 * 允许字母/数字/`.`/`_`/`-`，须以字母或数字开头，长度 1..32。
 */
export const DATASET_VERSION_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/**
 * dataset_code 正则与禁止模式：**前后端唯一同源**（server/datasetRegistry/naming.ts 复用本常量）。
 * datasetCode 是数据集的稳定语义命名空间（决定物理表名 `ds_{code}_{role}`），
 * 故禁止携带版本 / 序号 / 日期 / 环境 / UUID（这些属于 Version 或部署维度，不属于 Dataset 身份）。
 */
export const DATASET_CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const DATASET_CODE_FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  { pattern: /_v\d+$/, message: "禁止包含版本（如 _v1）" },
  { pattern: /_\d+$/, message: "禁止以数字序号/日期结尾（如 _001 / _202609）" },
  { pattern: /_(test|staging|prod|dev|local)$/i, message: "禁止包含环境名（test/staging/prod/dev/local）" },
  { pattern: /[0-9a-f]{8}-[0-9a-f]{4}-/i, message: "禁止包含 UUID" },
];

export const DATASET_BUILD_JOB_STATUS_VALUES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export const datasetBuildJobStatusSchema = z.enum(DATASET_BUILD_JOB_STATUS_VALUES);
export type DatasetBuildJobStatus = (typeof DATASET_BUILD_JOB_STATUS_VALUES)[number];

// ---------------------------------------------------------------------------
// 通用：ID 安全 + 分页上限
// ---------------------------------------------------------------------------

/** 安全整型 ID：bigint(mode:"number") 下的防御（禁止不可安全表示的 bigint 进入 SQL）。 */
export const safeIntId = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER, "ID 超出 JavaScript 安全整数范围");

/** Event / Path / Outcome 分页单页上限（强约束：禁止一次返回全量）。 */
export const DATASET_PAGE_LIMIT_MAX = 200;
export const DATASET_PAGE_LIMIT_DEFAULT = 50;

// ---------------------------------------------------------------------------
// A. Definition
// ---------------------------------------------------------------------------

/** 列表条目（wire：与后端 DatasetDefinition 同构）。 */
export interface DatasetDefinitionListItem {
  id: number;
  datasetCode: string;
  name: string;
  description: string | null;
  datasetType: DatasetDefinitionType;
  storageType: DatasetStorageType;
  status: DatasetDefinitionStatus;
  eventTableName: string | null;
  /** 前置原始行情表（rd ≤ 0，PIT 安全特征窗口）。 */
  prefixTableName: string | null;
  /** 后置原始行情表（rd ≥ 1，回测撮合 / 标签窗口）。 */
  postTableName: string | null;
  pathTableName: string | null;
  outcomeTableName: string | null;
  featureTableName: string | null;
  /**
   * 是否具备构建能力（该 datasetCode 是否已注册构建插件）。
   * false = 可以管理定义 / 版本，但「构建」会被明确拒绝（BUILDER_NOT_REGISTERED），
   * 需先实现并注册该数据集的插件（表结构 + 构建器）。
   */
  buildable: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** 详情 = 定义 + 其版本列表。 */
export interface DatasetDefinitionDetail extends DatasetDefinitionListItem {
  versions: DatasetVersionListItem[];
}

export const getDefinitionInputSchema = z.object({
  definitionId: safeIntId,
});
export type GetDefinitionInput = z.infer<typeof getDefinitionInputSchema>;

export const updateDefinitionInputSchema = z.object({
  definitionId: safeIntId,
  name: z.string().min(1, "名称必填").max(128).optional(),
  description: z.string().max(2000).nullable().optional(),
});
export type UpdateDefinitionInput = z.infer<typeof updateDefinitionInputSchema>;

export const archiveDefinitionInputSchema = z.object({
  definitionId: safeIntId,
});
export type ArchiveDefinitionInput = z.infer<typeof archiveDefinitionInputSchema>;

// ---------------------------------------------------------------------------
// A'. 多数据集管理（DATASET-003A：新建数据集 / 删除数据集）
// ---------------------------------------------------------------------------

/** datasetCode 形态校验（与 server/datasetRegistry/naming.ts 同源）；含禁止模式复检。 */
export const datasetCodeSchema = z
  .string()
  .min(1, "datasetCode 必填")
  .max(64, "datasetCode 最长 64")
  .regex(DATASET_CODE_PATTERN, "datasetCode 须为 lowercase snake_case（如 first_limit_pullback）")
  .superRefine((code, ctx) => {
    for (const { pattern, message } of DATASET_CODE_FORBIDDEN_PATTERNS) {
      if (pattern.test(code)) {
        ctx.addIssue({ code: "custom", message: `datasetCode ${message}` });
      }
    }
  });

/**
 * 新建 Dataset 定义（admin 写端点）。
 * 若该 datasetCode 已注册构建插件，后端会**同时建立其物理表**；未注册则只登记定义
 * （可在列表中看到并管理版本，但构建会被拒绝，直到实现并注册插件）。
 */
export const createDatasetDefinitionInputSchema = z.object({
  datasetCode: datasetCodeSchema,
  name: z.string().min(1, "名称必填").max(128),
  description: z.string().max(2000).nullable().optional(),
  datasetType: datasetDefinitionTypeSchema,
});
export type CreateDatasetDefinitionInput = z.infer<typeof createDatasetDefinitionInputSchema>;

/**
 * 删除 Dataset 定义（admin 写端点，**危险操作**）。
 * 必须回传 `confirmDatasetCode`（与落库 datasetCode 完全一致）作为二次确认，防误删。
 * 语义：级联删除所有版本数据 + 所有构建作业 + DROP 该数据集全部物理表 + 删除定义记录。
 * 若存在 RUNNING 作业 → 拒绝（先取消或等待结束）。
 */
export const deleteDatasetDefinitionInputSchema = z.object({
  definitionId: safeIntId,
  confirmDatasetCode: z.string().min(1, "必须回传确认用的 datasetCode").max(64),
});
export type DeleteDatasetDefinitionInput = z.infer<typeof deleteDatasetDefinitionInputSchema>;

/** 单个数据集可注册的构建插件（供前端在「新建数据集」时判断可构建性与展示物理表）。 */
export interface DatasetPluginListItem {
  datasetCode: string;
  displayName: string;
  description: string;
  /** 该插件声明的物理表（表名已按 datasetCode 派生）。 */
  physicalTables: Array<{ role: string; label: string; tableName: string }>;
}

/** 已注册插件的返回（`listDatasetPlugins`）。 */
export interface DatasetPluginListResult {
  plugins: DatasetPluginListItem[];
}

/** 删除数据集的结果（诚实回报级联清理量）。 */
export interface DeleteDatasetDefinitionResult {
  definitionId: number;
  datasetCode: string;
  versionsDeleted: number;
  purgedRows: number;
  jobsDeleted: number;
  /** DROP 掉的物理表（表结构随数据集一并删除）。 */
  droppedTables: Array<{ table: string; dropped: boolean }>;
}

// ---------------------------------------------------------------------------
// B. Version
// ---------------------------------------------------------------------------

/** 版本列表条目（wire：与后端 DatasetVersion 同构，剔除超长 JSON 字段）。 */
export interface DatasetVersionListItem {
  id: number;
  datasetId: number;
  version: string;
  status: DatasetVersionStatus;
  startDate: string | null;
  endDate: string | null;
  featureVersion: string | null;
  sourceVersion: string | null;
  totalEvents: number | null;
  totalRows: number | null;
  createdAt: string | null;
  completedAt: string | null;
}

/** 版本详情 = 版本 + 其构建作业列表 + 已固化的筛选配置。 */
export interface DatasetVersionDetail extends DatasetVersionListItem {
  jobs: DatasetBuildJobListItem[];
  /**
   * 已固化的构建 / 筛选配置（DATASET-003B）。
   * 历史版本（DATASET-001/002 创建）无配置行 → null（不臆造，UI 显示「未记录筛选口径」）。
   */
  buildConfig: DatasetBuildConfigView | null;
}

export const listVersionsInputSchema = z.object({
  datasetId: safeIntId,
});
export type ListVersionsInput = z.infer<typeof listVersionsInputSchema>;

export const getVersionInputSchema = z.object({
  datasetVersionId: safeIntId,
});
export type GetVersionInput = z.infer<typeof getVersionInputSchema>;

/**
 * 删除 Dataset 版本（admin 写端点，**危险操作**）。
 * 语义：删除该版本的物理表数据行（**保留表结构**）+ 该版本全部构建作业 + 版本记录。
 * 若存在 RUNNING 作业 → 拒绝（先取消或等待结束）。
 */
export const deleteDatasetVersionInputSchema = z.object({
  datasetVersionId: safeIntId,
});
export type DeleteDatasetVersionInput = z.infer<typeof deleteDatasetVersionInputSchema>;

/** 删除版本的结果（诚实回报实际清理量；表结构保留）。 */
export interface DeleteDatasetVersionResult {
  datasetVersionId: number;
  datasetId: number;
  version: string;
  purgedRows: number;
  jobsDeleted: number;
  /** 各物理表删除明细（表不存在时 deleted=0 / tableMissing=true）。 */
  tables: Array<{ table: string; deleted: number; tableMissing: boolean }>;
}

// ---------------------------------------------------------------------------
// B2. Build / Filter Config（DATASET-003B：构建新版本的筛选口径）
// ---------------------------------------------------------------------------
//
// 分层（与姊妹模块 server/researchDataset 的 UniverseFilter 词汇对齐，不另立口径）：
//   - Universe 层 = 「池子里有谁」：boards（板块）+ excludeSt（排除 ST）
//   - Signal 层   = 「谁触发事件、看多远」：events（相对日 × 事件类型）+ pre/postWindowDays
// 落库：dataset_build_config 主表（标量）+ _event / _board 子表（多值），与 dataset_version 一对一。

/** 构建参数边界（防止非法构建窗口/批量把构建实例打爆）。 */
export const DATASET_BUILD_CONFIG_LIMITS = {
  pathHorizon: { min: 1, max: 120 },
  horizon: { min: 1, max: 120 },
  maxHorizons: 8,
  batchSize: { min: 1, max: 10000 },
} as const;

/** outcomeHorizons 单个视界：正整数，1..120。 */
const horizonSchema = z
  .number()
  .int()
  .min(DATASET_BUILD_CONFIG_LIMITS.horizon.min)
  .max(DATASET_BUILD_CONFIG_LIMITS.horizon.max);


/**
 * 市场板块类别（与 server/data/boardRules.classifyBoard 输出一致）。
 * 涨跌停比例：main 10%（ST/*ST 5%）/ chinext·star 20% / bse 30%。
 */
export const DATASET_BOARDS = ["main", "chinext", "star", "bse"] as const;
export type DatasetBoard = (typeof DATASET_BOARDS)[number];

/** 板块中文标签（前端展示唯一来源，避免各处硬编码）。 */
export const DATASET_BOARD_LABELS: Record<DatasetBoard, string> = {
  main: "主板",
  chinext: "创业板",
  star: "科创板",
  bse: "北交所",
};

/**
 * 事件类型（客观市场事实，非策略信号；边界铁律：Dataset 不绑定 Strategy）。
 *   - firstBoard：锚点日涨停 且 前一交易日未涨停（首板）
 *   - limitUp：锚点日涨停（不限连板高度）
 *   - consecutiveBoard：锚点日涨停 且 前一交易日也涨停（连板）
 */
export const DATASET_EVENT_KINDS = ["firstBoard", "limitUp", "consecutiveBoard"] as const;
export type DatasetEventKind = (typeof DATASET_EVENT_KINDS)[number];

export const DATASET_EVENT_KIND_LABELS: Record<DatasetEventKind, string> = {
  firstBoard: "首板",
  limitUp: "涨停",
  consecutiveBoard: "连板",
};

/**
 * 事件维度规格 = 相对日 × 事件类型。
 *
 * `relativeDay` 以「事件日 t」为 0（取值 ≤ 0）：
 *   - 0  → 事件日当天判定（等价 DATASET-001/002 既有口径）
 *   - -1 → t-1 日判定（如「T-1 首板，T 日作为观察起点」）
 *   - -2 → t-2 日判定
 *
 * 语义：在交易日 `t + relativeDay` 上判定 `kind`，命中即把该 (symbol, t) 收录为事件。
 * 多条规格之间为 **OR**（任一命中即收录）。
 */
export interface DatasetEventSpec {
  relativeDay: number;
  kind: DatasetEventKind;
}

/**
 * 筛选 + 执行参数默认值（**权威默认**）。
 * 默认值 = 「事件日首板 / 不筛板块 / 不排除 ST / 无前置窗口 / t 后 20 日」，
 * 与 DATASET-001/002 既有口径完全一致（新版本若不改任何筛选项，建出的数据与旧版一致）。
 */
export const DATASET_BUILD_FILTER_DEFAULTS = {
  /** 板块（空 = 不过滤，含 unknown 板块）。 */
  boards: [] as readonly DatasetBoard[],
  /** 排除 ST/*ST（PIT st 维度）。 */
  excludeSt: false,
  /** 事件维度（默认 = 事件日首板）。 */
  events: [{ relativeDay: 0, kind: "firstBoard" }] as readonly DatasetEventSpec[],
  /** t 日之前的数据天数（前置窗口，0 = 不物化前置行）。 */
  preWindowDays: 0,
  /** t 日之后的数据天数（后置窗口，等价旧 pathHorizon）。 */
  postWindowDays: 20,
  /** 结果视界（交易日，去重升序）。 */
  outcomeHorizons: [5, 10, 20] as readonly number[],
  /** 批量写入大小。 */
  batchSize: 1000,
} as const;

/** 筛选 / 窗口边界（防止非法配置把构建实例打爆）。 */
export const DATASET_BUILD_FILTER_LIMITS = {
  preWindowDays: { min: 0, max: 120 },
  postWindowDays: { min: 1, max: 120 },
  /** relativeDay 允许 t-10 .. t；不允许 > 0（未来锚点 = 泄漏）。 */
  relativeDay: { min: -10, max: 0 },
  maxEvents: 6,
} as const;

export const datasetBoardSchema = z.enum(DATASET_BOARDS);
export const datasetEventKindSchema = z.enum(DATASET_EVENT_KINDS);

export const datasetEventSpecSchema = z.object({
  relativeDay: z
    .number()
    .int()
    .min(DATASET_BUILD_FILTER_LIMITS.relativeDay.min)
    .max(DATASET_BUILD_FILTER_LIMITS.relativeDay.max),
  kind: datasetEventKindSchema,
});

/**
 * 构建筛选入参（**必填**：未完成筛选配置不得创建版本 / 不得构建）。
 * events 至少 1 条（必须明确「什么事件」）；boards 为空表示显式选择「全板块」。
 */
export const datasetBuildFilterSchema = z.object({
  boards: z.array(datasetBoardSchema).max(DATASET_BOARDS.length).default([]),
  excludeSt: z.boolean().default(false),
  events: z
    .array(datasetEventSpecSchema)
    .min(1, "至少配置一个事件维度")
    .max(DATASET_BUILD_FILTER_LIMITS.maxEvents, `事件维度最多 ${DATASET_BUILD_FILTER_LIMITS.maxEvents} 条`),
  preWindowDays: z
    .number()
    .int()
    .min(DATASET_BUILD_FILTER_LIMITS.preWindowDays.min)
    .max(DATASET_BUILD_FILTER_LIMITS.preWindowDays.max)
    .default(DATASET_BUILD_FILTER_DEFAULTS.preWindowDays),
  postWindowDays: z
    .number()
    .int()
    .min(DATASET_BUILD_FILTER_LIMITS.postWindowDays.min)
    .max(DATASET_BUILD_FILTER_LIMITS.postWindowDays.max)
    .default(DATASET_BUILD_FILTER_DEFAULTS.postWindowDays),
  outcomeHorizons: z
    .array(horizonSchema)
    .min(1, "至少一个结果视界")
    .max(DATASET_BUILD_CONFIG_LIMITS.maxHorizons, `结果视界最多 ${DATASET_BUILD_CONFIG_LIMITS.maxHorizons} 个`)
    .default([...DATASET_BUILD_FILTER_DEFAULTS.outcomeHorizons]),
  batchSize: z
    .number()
    .int()
    .min(DATASET_BUILD_CONFIG_LIMITS.batchSize.min)
    .max(DATASET_BUILD_CONFIG_LIMITS.batchSize.max)
    .default(DATASET_BUILD_FILTER_DEFAULTS.batchSize),
});
export type DatasetBuildFilter = z.infer<typeof datasetBuildFilterSchema>;

/** 构建 / 筛选配置视图（wire：主表标量 + 子表多值已展开，供版本详情与构建前回读）。 */
export interface DatasetBuildConfigView {
  id: number;
  datasetVersionId: number;
  boards: DatasetBoard[];
  excludeSt: boolean;
  events: DatasetEventSpec[];
  preWindowDays: number;
  postWindowDays: number;
  outcomeHorizons: number[];
  batchSize: number;
  configVersion: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export const getBuildConfigInputSchema = z.object({
  datasetVersionId: safeIntId,
});
export type GetBuildConfigInput = z.infer<typeof getBuildConfigInputSchema>;

/**
 * 筛选口径的人类可读摘要（前后端唯一来源，禁止各处自行拼文案）。
 * 例：`主板·创业板 / 排除ST / T日首板 + T-1日涨停 / t-5..t+20`。
 */
export function describeDatasetFilter(filter: {
  boards: readonly DatasetBoard[];
  excludeSt: boolean;
  events: readonly DatasetEventSpec[];
  preWindowDays: number;
  postWindowDays: number;
}): string {
  const boards = filter.boards.length > 0
    ? filter.boards.map((b) => DATASET_BOARD_LABELS[b]).join("·")
    : "全板块";
  const st = filter.excludeSt ? "排除ST" : "含ST";
  const events = filter.events.length > 0
    ? filter.events
        .map((e) => `${e.relativeDay === 0 ? "T日" : `T${e.relativeDay}日`}${DATASET_EVENT_KIND_LABELS[e.kind]}`)
        .join(" + ")
    : "无事件";
  return `${boards} / ${st} / ${events} / t-${filter.preWindowDays}..t+${filter.postWindowDays}`;
}

/**
 * 构建参数默认值（**权威默认，与 server/datasetRegistry/lifecycle.ts 的 BUILD_DEFAULTS 同值**）。
 * 旧 `/dataset-builder` 页面的三项构建配置（回踩窗口 / 结果视界 / 批大小）迁移至此，作为
 * 「构建新版本」入参的缺省，避免前后端各写一套默认值产生漂移。
 *
 * @deprecated DATASET-003B 起改用 `DATASET_BUILD_FILTER_DEFAULTS`（筛选口径统一入口），
 *             本常量仅为兼容旧构建配置的解析回退保留。
 */
export const DATASET_BUILD_CONFIG_DEFAULTS = {
  /** 回踩路径窗口（交易日）。 */
  pathHorizon: 20,
  /** 结果视界（交易日，去重升序）。 */
  outcomeHorizons: [5, 10, 20] as readonly number[],
  /** 批量写入大小。 */
  batchSize: 1000,
} as const;

/**
 * 创建新版本（admin 写端点：建版本 + 固化筛选配置，落地 DRAFT）。
 * 与只读 getVersionInputSchema 不同，这是「构建新版本」入口的入参契约。
 *
 * DATASET-003B：入参收敛为单一 `filter`（筛选 + 执行参数），不再接受 pathHorizon / outcomeHorizons /
 * batchSize 三个散装字段 —— 避免「筛选口径」与「执行参数」两处各写一套而产生漂移。
 */
export const createDatasetVersionInputSchema = z
  .object({
    datasetId: safeIntId,
    version: z.string().regex(DATASET_VERSION_LABEL_PATTERN, "version 须为 1..32 位字母/数字/._-，且以字母或数字开头"),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    /** 筛选 + 执行参数（**必填**：未完成筛选配置不得创建版本 / 构建）。 */
    filter: datasetBuildFilterSchema,
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "startDate 不能晚于 endDate",
    path: ["startDate"],
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.filter.events.forEach((e, i) => {
      const key = `${e.relativeDay}:${e.kind}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "事件维度存在重复项",
          path: ["filter", "events", i],
        });
      }
      seen.add(key);
    });
    const horizons = [...v.filter.outcomeHorizons];
    if (new Set(horizons).size !== horizons.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "结果视界存在重复项",
        path: ["filter", "outcomeHorizons"],
      });
    }
  });
export type CreateDatasetVersionInput = z.infer<typeof createDatasetVersionInputSchema>;

// ---------------------------------------------------------------------------
// C. Build Job
// ---------------------------------------------------------------------------

/** 作业列表条目（wire：与后端 DatasetBuildJob 同构，剔除 lastCursor 原始 LONGTEXT）。 */
export interface DatasetBuildJobListItem {
  id: number;
  datasetVersionId: number;
  jobId: string;
  status: DatasetBuildJobStatus;
  totalChunks: number | null;
  completedChunks: number | null;
  currentChunk: number | null;
  processedRows: number | null;
  failedRows: number | null;
  lastSymbol: string | null;
  lastTradeDate: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  /** 构建进度 0..100；COMPLETED 恒 100；信息不足（totalChunks 缺失/<=0）为 null（不臆造）。 */
  progress: number | null;
}

/** checkpoint 摘要（从 lastCursor 反序列化后的关键进度，不返回原始 LONGTEXT）。 */
export interface DatasetBuildCheckpointSummary {
  phase: string;
  lastTradeDate: string | null;
  lastSymbol: string | null;
  lastEventId: string | null;
  processedRows: number;
  completedChunks: number;
}

/** 作业详情 = 作业 + checkpoint 摘要。 */
export interface DatasetBuildJobDetail extends DatasetBuildJobListItem {
  checkpointSummary: DatasetBuildCheckpointSummary | null;
}

export const listJobsInputSchema = z.object({
  datasetVersionId: safeIntId,
});
export type ListJobsInput = z.infer<typeof listJobsInputSchema>;

export const getJobInputSchema = z.object({
  jobId: z.string().min(1, "jobId 必填").max(64),
});
export type GetJobInput = z.infer<typeof getJobInputSchema>;

// ---------------------------------------------------------------------------
// C'. Build Lifecycle mutation（admin 写端点：create/start/cancel/retry）
// ---------------------------------------------------------------------------

export const createBuildJobInputSchema = z.object({
  datasetVersionId: safeIntId,
});
export type CreateBuildJobInput = z.infer<typeof createBuildJobInputSchema>;

export const startBuildJobInputSchema = z.object({
  jobId: z.string().min(1, "jobId 必填").max(64),
});
export type StartBuildJobInput = z.infer<typeof startBuildJobInputSchema>;

export const cancelBuildJobInputSchema = z.object({
  jobId: z.string().min(1, "jobId 必填").max(64),
});
export type CancelBuildJobInput = z.infer<typeof cancelBuildJobInputSchema>;

export const retryBuildJobInputSchema = z.object({
  jobId: z.string().min(1, "jobId 必填").max(64),
});
export type RetryBuildJobInput = z.infer<typeof retryBuildJobInputSchema>;

// ---------------------------------------------------------------------------
// D. Statistics
// ---------------------------------------------------------------------------

/** 单版本统计（COUNT / MIN / MAX / GROUP BY 数据库聚合，禁止全量加载到 Node）。 */
export interface DatasetStatistics {
  datasetVersionId: number;
  version: string;
  status: DatasetVersionStatus;
  /** 版本元数据声明的统计（markReady 时写入）。 */
  declared: {
    totalEvents: number | null;
    totalRows: number | null;
  };
  /** 物理表实测统计（真实 COUNT）。 */
  actual: {
    eventCount: number;
    prefixCount: number;
    postCount: number;
    pathCount: number;
    outcomeCount: number;
    /** event + prefix + post + path + outcome 五表行数之和。 */
    rowCount: number;
    firstDate: string | null;
    lastDate: string | null;
    /** 该版本 outcome 表实际出现的 horizon 集合（升序）。 */
    horizons: number[];
  };
}

export const getStatisticsInputSchema = z.object({
  datasetVersionId: safeIntId,
});
export type GetStatisticsInput = z.infer<typeof getStatisticsInputSchema>;

// ---------------------------------------------------------------------------
// E / F / G. Event / Path / Outcome（keyset 分页）
// ---------------------------------------------------------------------------

/** 分页返回（cursor 不透明；nextCursor=null 表示已到末页）。 */
export interface DatasetPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Event 行（wire：与后端 FirstLimitPullbackEvent 同构）。
 * **不含逐日行情** —— t 日 OHLCV 在 `prefix`（`relativeDay = 0` 行）。
 */
export interface DatasetEventItem {
  datasetVersionId: number;
  eventId: string;
  symbol: string;
  tradeDate: string;
  market: string | null;
  industryCode: string | null;
  boardType: string | null;
  previousClose: number | null;
  limitUpPrice: number | null;
  turnover: number | null;
  isFirstLimit: boolean | null;
  previousLimitDate: string | null;
  daysSincePreviousLimit: number | null;
  historicalLimitCount: number | null;
  marketCap: number | null;
  floatMarketCap: number | null;
}

/**
 * 原始行情窗口行（wire：`prefix` / `post` 同构，与后端 FirstLimitPullbackRawBar 同构）。
 * 只含纯日线列，**不含任何衍生列**（结构级 PIT 防线）。
 */
export interface DatasetRawBarItem {
  datasetVersionId: number;
  eventId: string;
  symbol: string;
  tradeDate: string;
  /** prefix：∈ [-preWindowDays, 0]；post：∈ [1, postWindowDays]。 */
  relativeDay: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  amount: number | null;
}

/** Path 行（wire：与后端 FirstLimitPullbackPath 同构；仅衍生量，`relativeDay ≥ 1`）。 */
export interface DatasetPathItem {
  datasetVersionId: number;
  eventId: string;
  symbol: string;
  tradeDate: string;
  relativeDay: number;
  highFromEventClose: number | null;
  lowFromEventClose: number | null;
  closeFromEventClose: number | null;
  pullbackFromEventHigh: number | null;
  volumeRatio: number | null;
  isBreakout: boolean | null;
  breakoutPrice: number | null;
  daysToBreakout: number | null;
}

/** Outcome 行（wire：与后端 FirstLimitPullbackOutcome 同构）。 */
export interface DatasetOutcomeItem {
  datasetVersionId: number;
  eventId: string;
  horizon: number;
  maxReturn: number | null;
  minReturn: number | null;
  maxDrawdown: number | null;
  isBreakout: boolean | null;
  daysToBreakout: number | null;
}

/** 不透明分页游标（前端原样回传，不解析）。 */
const cursorSchema = z.string().min(1).max(512);

export const eventPageInputSchema = z.object({
  datasetVersionId: safeIntId,
  fromDate: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(DATASET_PAGE_LIMIT_MAX).optional(),
});
export type EventPageInput = z.infer<typeof eventPageInputSchema>;

export const pathPageInputSchema = z.object({
  datasetVersionId: safeIntId,
  eventId: z.string().min(1).max(64).optional(),
  fromDate: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(DATASET_PAGE_LIMIT_MAX).optional(),
});
export type PathPageInput = z.infer<typeof pathPageInputSchema>;

/** 原始行情窗口分页（prefix / post 同构，共用一套 keyset 游标语义）。 */
export const rawBarPageInputSchema = z.object({
  datasetVersionId: safeIntId,
  eventId: z.string().min(1).max(64).optional(),
  fromDate: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(DATASET_PAGE_LIMIT_MAX).optional(),
});
export type RawBarPageInput = z.infer<typeof rawBarPageInputSchema>;

export const outcomePageInputSchema = z.object({
  datasetVersionId: safeIntId,
  eventId: z.string().min(1).max(64).optional(),
  horizon: z.number().int().min(1).max(1000).optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(DATASET_PAGE_LIMIT_MAX).optional(),
});
export type OutcomePageInput = z.infer<typeof outcomePageInputSchema>;

export type EventPage = DatasetPage<DatasetEventItem>;
export type RawBarPage = DatasetPage<DatasetRawBarItem>;
export type PathPage = DatasetPage<DatasetPathItem>;
export type OutcomePage = DatasetPage<DatasetOutcomeItem>;
