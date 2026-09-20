# EXPERIMENT-CODE-SPEC — 独立研究实验代码规范（AI 接入用）

> **本文件是给「外部代码生成 AI」看的**：ChatGPT / Claude / Gemini / Cursor / WorkBuddy / 其他。
> 只读本文件 + `research-experiments/template/` + `research-experiments/first-board-pullback/entry-day/`
> 就能写出一个符合本项目规范的实验，**不需要读整个仓库**。
>
> 项目：`stock-limit-up-analyzer`（A 股涨停/首板研究平台）
> 体系编号：`RESEARCH-EXPERIMENT-001` ~ `004` · 契约版本 `1.0.0`
> 唯一契约文件：`shared/researchExperimentsContracts.ts`
>
> 🔴 **004 起「结果会被持久化」**：Run 元数据进 TiDB，结果与产物进对象存储（MinIO）。
>    ⇒ 新增 **§P 结果持久化与产物** 是**必读**节 —— 它决定你的实验「关掉页面后还能不能查看」。
>    001~003 时执行是**请求内计算**、结果不落库、刷新需重跑；004 改变了这一点。

---

## A. Experiment 是什么

一个 **Experiment = 一个目录 = 一个可执行的 `ExperimentDefinition`**。

它和「旧研究链路」的区别：

| | 旧 Research（`/research`） | 独立 Experiment（`/research-experiments`） |
| --- | --- | --- |
| 结构 | 固定：Research → Analysis → Finding → Conclusion | **实验自己定**：参数 + 结果结构 + 页面 |
| 数据 | 经引擎的变量目录 | 直接声明 Dataset 需求并取数 |
| 结果 | 必须落库成 Analysis / Finding / Conclusion | **不落库**（请求内计算，零新表） |
| 新增成本 | 改核心引擎 | **只加 2 行注册**，核心零改动 |

一句话：**旧的适合「平台替你设计分析」，新的适合「我脑子里有一个具体实验，想直接算」。**

两套体系**并存**（规格 §14）。新实验**不得**被强制转换成旧结构；契约里**不得**出现
`analysisId` / `findingIds` / `conclusion` / `candidateId` 等旧结构字段（有静态测试挡着）。

---

## B. 目录结构

```
research-experiments/                       ← 实验体系根目录（仓库根，与 client/ server/ 平级）
├── manifest.ts                             ← 【注册点 1】服务端发现：加 1 行 import + 1 行数组项
├── README.md
├── template/                               ← 模板（复制它开始）
│   ├── experiment.ts
│   ├── result.ts
│   ├── page.tsx
│   └── README.md
└── <你的组>/                                ← 小写 kebab-case
    └── <你的实验>/                          ← 小写 kebab-case
        ├── experiment.ts                   ← 必需：descriptor + run()
        ├── result.ts                       ← 必需：自有结果 schema + 组装
        ├── page.tsx                        ← 必需：实验自己的展示页面
        └── README.md                       ← 必需：口径说明与已知偏差

client/src/researchExperiments/pages.ts     ← 【注册点 2】前端发现：加 1 行 pageKey → 组件
```

实验 id = `<组>/<实验>`，**必须**与目录路径逐字一致。

---

## C. 文件命名规则

| 文件 | 职责 | 硬规则 |
| --- | --- | --- |
| `experiment.ts` | 元数据 + 取数 + 计算 | 导出 `export const xxxExperiment: ExperimentDefinition`；**不得** import 任何 `client/**` 或 React |
| `result.ts` | 自有 `customPayload` 的 zod schema + 结果组装 | schema 与组装函数**必须同文件**（防口径与产物漂移） |
| `page.tsx` | 展示 | `export default` 一个 `ExperimentPageComponent`；**不得** import `experiment.ts` 或 `server/**` 的运行时；**只引类型**时用 `import type` |
| `README.md` | 口径与偏差说明 | 必须写明「样本口径 / 参数默认值 / 已知偏差 / 本实验刻意不做什么」 |

命名：目录与文件全小写 kebab-case；导出名用驼峰 + `Experiment` 后缀。

---

## D. Experiment Contract

唯一契约文件：`shared/researchExperimentsContracts.ts`。**用别名 import，不要用相对路径**
（实验目录层级不固定，相对路径会因复制目录而失效）：

```ts
import type {
  ExperimentDefinition,
  ExperimentRunContext,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";
```

### D.1 `ExperimentDefinition`（核心）

```ts
interface ExperimentDefinition {
  descriptor: ExperimentDescriptor;              // 元数据 + 参数定义 + Dataset 需求 + 页面键
  resultSchema: z.ZodType;                       // 校验 result.customPayload
  run(context: ExperimentRunContext):
    | Promise<ExperimentResultPayload>
    | ExperimentResultPayload;
}
```

### D.2 `ExperimentDescriptor`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `<组>/<实验>`，小写 kebab-case，**两段**，必须与目录一致 |
| `name` | string | 展示名（中文可以） |
| `version` | string | 语义化；**改任何计算口径都要升** |
| `description` | string | 研究问题与口径一句话说清 |
| `source` | string | 作者 / 来源 |
| `tags` | string[]? | 可选 |
| `parameters` | ExperimentParameterDefinition[] | 见 §G |
| `datasetRequirement` | ExperimentDatasetRequirement | 见 §E |
| `pageKey` | string | 前端页面注册键（通常与 id 相同） |
| `pageTitle` | string | 页面标题 |

### D.3 `ExperimentRunContext`（`run()` 能拿到的一切）

```ts
interface ExperimentRunContext {
  descriptor: ExperimentDescriptor;   // 只读
  parameters: ExperimentParameterValues;  // 已归并默认值、已通过校验
  dataset: ExperimentDatasetAccess;   // 唯一数据面（见 §E）
  log: (message: string) => void;     // 进 execution.logs（最多 200 行），**不是** console
  artifact: (spec: ExperimentArtifactFileSpec) => void;  // 声明落对象存储的产物（004 新增，见 §P）
}
```

### D.4 `ExperimentResultPayload`（`run()` 的产物）

```ts
interface ExperimentResultPayload {
  sampleSummary: {                    // 必填，且**账必须平**（见 §H.4）
    candidateCount: number;
    eligibleCount: number;
    excludedCount: number;
    excludedByReason: Record<string, number>;
    notes?: string[];
  };
  tables?: ExperimentResultTable[];         // 自定义表格
  statistics?: ExperimentResultStatistic[]; // 标量统计（value 可为 null = 无法计算）
  distributions?: ExperimentResultDistribution[];
  comparisons?: ExperimentResultComparison[]; // 多组比较
  charts?: ExperimentResultChart[];        // 图表数据（BAR / LINE）
  customPayload?: unknown;                 // 自有结构（由 resultSchema 校验）
}
```

🔴 `metadata`（实验 id / 版本 / Dataset 版本 / 时间）与 `parameters` **不要自己填** ——
Runner 用**自己解析出的坐标**填，实验无法谎报「我跑的是哪个 Dataset 版本」。

🔴 **产物内容不进这个 payload**（004）。`tables` / `charts` 这些是**给页面直接渲染的小数据**，
留在信封里没问题；但**大型**产物（逐事件明细 CSV、Parquet、图片、图表数据文件）必须走
`context.artifact(spec)` 落到对象存储，**不要**塞进 `customPayload` 或 `tables` ——
那会把一次 Run 的结果体撑到几十 MB，正是规格 §17 要避免的。见 §P。

---

## E. Dataset 使用方法

### E.1 声明（`datasetRequirement`）

```ts
datasetRequirement: {
  datasetCode: "first_limit_pullback",     // 数据集语义代码（当前项目只有这一个）
  requiredColumns: {
    events: ["isFirstLimit", "boardType"],        // 事件表要读的列
    feature: ["close"],                            // rd ≤ 0 的行情列（PIT 安全）
    observation: ["open", "high", "low", "close"],  // rd ≥ 1 的行情列
  },
  prefixRelativeDays: [0],                 // 要读的 rd ≤ 0 相对日（必须 ≤ 0）
  postRelativeDays: [1, 2, 3, 4, 5],       // 要读的 rd ≥ 1 相对日（必须 ≥ 1）
  decisionOffsetDays: null,                // 样本资格的信息边界，见 §F
  usesForwardData: true,                   // 是否读事件日之后的数据
  forwardDataPurpose: "研究事件后收益…",     // usesForwardData=true 时必填
}
```

### E.2 真实可用的列（**只允许这些**）

`ds_first_limit_pullback_event`
```
eventId, symbol, tradeDate, market, industryCode, boardType,
previousClose, limitUpPrice, turnover, isFirstLimit,
previousLimitDate, daysSincePreviousLimit, historicalLimitCount,
marketCap, floatMarketCap
```

`ds_first_limit_pullback_prefix`（rd ∈ [-20, 0]）/ `ds_first_limit_pullback_post`（rd ∈ [1, 20]）
```
eventId, symbol, tradeDate, relativeDay, open, high, low, close, volume, amount
```

🔴 声明一个**不存在**的列 ⇒ 运行时报 `EXPERIMENT_METADATA_INVALID`（**刻意**：Drizzle 的列裁剪
会把写错的列静默变成 `null`，取值悄悄变空是最危险的失败模式）。
🔴 `isFirstLimit` 在领域层是 **boolean**（不是 0/1）。

### E.3 取数 API（**唯一**数据面）

```ts
const events = await context.dataset.events();        // 事件行（列投影 = requiredColumns.events）
const base   = await context.dataset.feature(0);      // prefix 行情，rd 必须在 prefixRelativeDays 里
const next   = await context.dataset.observation(1);  // post 行情，rd 必须在 postRelativeDays 里
context.dataset.facts;  // datasetVersionId / datasetCode / datasetVersionLabel / status /
                        // startDate / endDate / totalEvents / postRelativeDayRange
```

行形状：
```ts
{ eventId, symbol, tradeDate, relativeDay,
  values: { /* 只含你声明过的列 */ } }
```

### E.4 三条结构级限制（不是「约定」，是取不到）

1. **没有 DB**：拿不到 `db` / 表对象 / 任意 SQL；只能经 `dataset` 取数；
2. **列投影即声明**：未声明的列在 `values` 里**根本不存在**（读出来是 `undefined`）；
3. **相对日白名单**：未声明的相对日调用即抛 `EXPERIMENT_DATASET_REQUIREMENT_INVALID`。

### E.5 平台行为（要知道的）

- 事件读取有**平台安全阀**（最多 20000 个事件），触顶时 `execution.datasetFacts.eventCount`
  会停在 20000；**不会静默**，你的结果应把「数据集共几个、扫到几个、用了几个」如实写进
  `customPayload` 与 `sampleSummary.notes`；
- 同一相对日**只读一次**（惰性缓存）；
- 实际读取行数与最远相对日会进 `execution.datasetFacts`（可复核「读了什么」）。

---

## F. PIT / `decisionOffsetDays` 规则

项目的 PIT（point-in-time）纪律，新实验**必须**遵守：

| 概念 | 含义 |
| --- | --- |
| `relativeDay = 0` | 事件日（首板日）。落在 `prefix`，**PIT 安全** |
| `relativeDay < 0` | 事件日之前。落在 `prefix`，PIT 安全特征窗口 |
| `relativeDay ≥ 1` | 事件日之后。落在 `post`，**违反信息边界**，即「未来数据」 |
| `decisionOffsetDays = d` | **样本资格的信息边界**：判定「该样本是否入池」只允许使用 rd ∈ [1, d] |

### F.1 两种研究，两种声明

**① 只用事件日及之前的数据**（推荐起点，天然 PIT 安全）：
```ts
prefixRelativeDays: [0], postRelativeDays: [], usesForwardData: false, decisionOffsetDays: null
```

**② 必须看事件日之后的行情**（描述性前瞻统计、事件研究）：
```ts
postRelativeDays: [1,2,3,4,5], usesForwardData: true,
forwardDataPurpose: "研究事件后入场位置与持有收益分布（描述性，不是可交易决策）",
decisionOffsetDays: null,   // 样本资格不使用未来价格条件
```

- 🔴 `postRelativeDays` 非空 但 `usesForwardData !== true` ⇒ **注册被拒**（堵「偷偷读未来数据」）；
- 🔴 `usesForwardData === true` 但 `forwardDataPurpose` 为空 ⇒ **注册被拒**；
- 🔴 未声明 `usesForwardData` 时 `dataset.observation(k)` **调用即抛** `EXPERIMENT_FORWARD_DATA_FORBIDDEN`
  —— 这是结构级闸门，不是注释提醒；
- 声明的 rd 超出该 Dataset 版本**真实视界**（`postRelativeDayRange`）⇒ 抛
  `EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE`。**夹取等于悄悄改窄研究范围，所以绝不夹取。**

### F.2 如果样本资格用了未来价格

`decisionOffsetDays` 必须写成**真正的最小信息边界 d**（不是「窗口长度」）。
项目对它的语义是：判样本入池只能用 rd ∈ [1, d]；用整窗判定 = look-ahead，
既有的旧链路会因此拒整个 Run。

### F.3 身份 ≠ 代码（跨键域必须桥接）

`event.symbol` / `bar.symbol` 是**代码**（如 `600000.SH`），**不是身份**。
项目里 `securityId`（canonical `sec_<uuid>`）与 `code` 是两个键域，`ds_*` 表**只有 `symbol`**。

若你的研究要**按证券聚合**（同一只股票跨事件），必须经
`server/security/engineKeyBridge.ts#resolveSecurityIdByEngineKey`
**逐事件按其自身 `tradeDate`** 解析（同一代码在不同历史区间可能属于不同证券），
解析歧义时**响亮失败**。**绝不可**把 `symbol` 当身份用。

---

## G. 参数定义方式

```ts
parameters: [
  { code: "entryDays", label: "入场日集合", description: "…",
    kind: "INT_LIST", required: false, defaultValue: [1,2,3,4,5],
    bounds: { min: 1, max: 20 }, unit: "个交易日" },

  { code: "exitRelativeDay", label: "退出日", kind: "INT",
    required: false, defaultValue: 5, bounds: { min: 1, max: 20 } },

  { code: "includeSt", label: "包含 ST", kind: "BOOLEAN", required: false, defaultValue: false },

  { code: "groupBy", label: "分组维度", kind: "ENUM",
    required: false, defaultValue: "boardType", allowedValues: ["boardType", "market"] },
]
```

| `kind` | 值类型 | 校验 |
| --- | --- | --- |
| `INT` | number（整数） | 整数 + `bounds` |
| `NUMBER` | number（有限） | 有限 + `bounds` |
| `BOOLEAN` | boolean | 严格布尔 |
| `ENUM` | string | 必须 ∈ `allowedValues`（必填，非空） |
| `INT_LIST` | number[] | 非空、元素整数、元素各自过 `bounds` |

**注册期硬规则**（不合规**注册就被拒**）：
- `code` 必须唯一；
- 非必填参数**必须**给 `defaultValue`（否则运行时会冒出「没有值的参数」）；
- `ENUM` 必须给非空 `allowedValues`，且 `defaultValue` 必须在其中；
- 非 `ENUM` 不得声明 `allowedValues`；`bounds.min ≤ bounds.max`。

**运行期硬规则**（服务端独立校验，前端表单校验**不是权威**）：
- **未知参数键一律拒绝**（打错参数名不该静默无效）；
- 缺必填 ⇒ 拒绝（**不用 0 / 空串兜底**）；
- 越界 / 类型不符 ⇒ 拒绝（**不夹取**，夹取等于悄悄改窄实验）。

🔴 **跨参数**的一致性检查（如「入场日必须 ≤ 退出日」）要在 `run()` 里做，
并用**抛异常**表达「请求本身不成立」（Runner 会把它捕获成 `FAILED` 并如实回报）。

---

## H. Result Schema

### H.1 信封 + 自有结构

- **信封**（`metadata` / `parameters` / `sampleSummary` / `tables` / …）由**平台 schema** 校验；
- **`customPayload`** 由**你的** `resultSchema` 校验。

```ts
export const myCustomPayloadSchema = z.object({ /* … */ });
export const myExperiment: ExperimentDefinition = {
  descriptor: { /* … */ },
  resultSchema: myCustomPayloadSchema,
  run: (ctx) => ({ /* … */ }),
};
```

`resultSchema` 返回 `z.unknown()` 表示「没有自有结构」，但**不建议省略** ——
有 schema 才能被 Contract Test 钉住。

### H.2 数值一律「算不出就是 `null`」

`statistics[].value` / `table.rows[].xxx` 允许 `null`。**禁 0 兜底** ——
「0 收益」与「样本不足」是两件完全不同的事，用 0 兜底会让页面撒谎。

### H.3 缺数据一律剔除 + 登记原因

剔除原因写成**闭集**（码 → 人读说明），并把这张表放进 `customPayload`
（如 `exclusionReasonLabels`），页面据此翻译。**不要臆造原因**；
每条原因都必须真的会出现（臆造的 hint 会误导排查）。

### H.4 样本账必须平（平台强制校验）

```
eligibleCount + excludedCount === candidateCount
Σ excludedByReason 的值 === excludedCount
```

不满足 ⇒ `EXPERIMENT_RESULT_INVALID`。理由：这是「样本为什么变少」的**唯一**诊断线索，
账不平就意味着有样本被静默吞掉。

### H.5 不要产出排序 / 评级字段

同一份数据上挑「最优」是样本内选择，不是结论。不要写 `bestXxx` / `worstXxx` / `rank`
这类字段，也不要按数量/收益给分组排序（按分组键字典序排是稳定且中性的）。
要用「比较」就写成**相对基准的差值**（`comparisons`），并在页面说明这是描述性统计。

---

## I. 前端 Page Contract

```tsx
// page.tsx
import type { ExperimentPageProps } from "@/researchExperiments/contract";

export default function MyExperimentPage({ descriptor, outcome }: ExperimentPageProps) {
  const result = outcome?.result ?? null;
  if (result === null) { /* 尚未运行，或运行失败（outcome.error 有值） */ }
  /* 用 result.tables / statistics / distributions / comparisons / charts / customPayload 渲染 */
}
```

| props | 含义 |
| --- | --- |
| `descriptor` | 实验描述符（含参数定义、Dataset 需求） |
| `outcome` | `null` = 本次会话**还没运行过**；非空 = 一次执行的全部事实（`runStatus` / `execution` / `result` / `error`） |

🔴 **平台已经把执行做完了**，页面**不要自己发请求** —— 执行入口在服务端只有一套
（Registry + Runner，负责参数校验 / Dataset 校验 / PIT 闸门 / 结果校验）。
页面自己 fetch 会立刻产生第二套执行入口。

🔴 页面**不得**：import `experiment.ts`、import `server/**` 的运行时、
引入新的 UI 框架 / 图表库。

✅ 页面**可以**：自定义表格与图表、多维度比较、参数说明、样本详情、统计解释、
自定义研究说明（规格 §7 全部允许）。

### I.1 可用组件与主题

- UI：`@/components/ui/*`（shadcn 全量：`card` / `table` / `badge` / `alert` / `tabs` / `select` …）
- 公共业务组件：`@/components/common`（`EmptyState` / `ErrorState` / `StatusBadge` / `SectionCard` …）
- 图表：`recharts`（`BarChart` / `LineChart` / `ResponsiveContainer` …）

**主题纪律**（明暗双主题都要成立）：
- 文字 / 网格一律用 `currentColor` 或 Tailwind 语义色（`text-muted-foreground`、`border`）；
- **A 股颜色语义**：涨 = 红 `#e11d48`、跌 = 绿 `#059669`（与欧美相反，不要搞反）；
- 图表容器给固定高度（如 `h-64`）并包在 `ResponsiveContainer` 里。

**空/错误/加载三态**：`outcome === null` 显示空态；`outcome.result === null` 说明本次执行失败
并指向「执行状态」区块（错误码在那里）；**不要自己实现错误 UI**。

---

## J. Experiment 注册 / 自动发现机制

平台**不做**文件系统扫描（项目约定：无 `import.meta.glob`、无 `readdir`、无 codegen ——
可复现性优先于「魔法发现」）。注册是**两行**：

**① 服务端发现** —— `research-experiments/manifest.ts`
```ts
import { myExperiment } from "./my-group/my-experiment/experiment";
export const EXPERIMENT_DEFINITIONS: readonly ExperimentDefinition[] = [
  entryDayExperiment,
  myExperiment,          // ← 加这一行
];
```

**② 前端页面** —— `client/src/researchExperiments/pages.ts`
```ts
import MyPage from "@experiments/my-group/my-experiment/page";
export const EXPERIMENT_PAGES = {
  "first-board-pullback/entry-day": EntryDayExperimentPage,
  "my-group/my-experiment": MyPage,     // ← 键必须等于 descriptor.pageKey
};
```

之后**无需**改任何核心代码：不改 Research Core、不改 Strategy Core、不改 tRPC 路由、不改数据库。
`server/routers.ts` 里的 `researchExperiments` 端点一次挂好后对所有实验通用。

⚠️ 忘记做 ② ⇒ **不会白屏**，平台降级到通用结果渲染器（渲染结果信封的通用字段）
并明确提示「该实验未注册自定义页面」。有测试同时钉住 ①⇄② 的双向一致。

---

## K. 错误处理

### K.1 两类失败，两条不同的出口

| 何时 | 例子 | 表现 |
| --- | --- | --- |
| **执行前**可判定 | 实验未注册 / 参数非法 / 版本不存在或非 READY / 相对日超视界 | **抛领域错误** → tRPC 错误，message 带 `[CODE] …` |
| **执行中**才发生 | `run()` 抛异常 / 结果不符契约 / 样本账不平 | **返回 `runStatus: "FAILED"`**（`result: null` + `error{code,message,detail}`） |

含义：前者是「这次请求本身不成立」（调用方参数问题）；后者是执行事实，
页面上要能同时看到「用了哪个版本 / 什么参数 / 跑了多久 / 失败码」。

### K.2 `run()` 里怎么报错

- 「请求本身不成立」（如跨参数矛盾）⇒ **`throw new Error("人读说明")`**，
  Runner 会捕获成 `EXPERIMENT_RUN_FAILED` 并保留你的消息；
- 想让错误更可读 ⇒ `throw new ExperimentError("EXPERIMENT_PARAMETER_INVALID", "…")`
  （领域码定义在 `EXPERIMENT_ERROR_CODES`）；
- **不要吞错**（`try/catch` 后返回空结果），也不要 `console.log` 代替 `ctx.log()`。

### K.3 错误码全集

```
EXPERIMENT_NOT_FOUND                       实验 id 未注册
EXPERIMENT_METADATA_INVALID                元数据非法（id 形态 / 参数定义 / Dataset 声明不自洽）
EXPERIMENT_PARAMETER_INVALID               参数不合法（缺必填 / 越界 / 枚举外 / 类型不符）
EXPERIMENT_DATASET_REQUIREMENT_INVALID     Dataset 需求非法（如读了未声明的相对日）
EXPERIMENT_DATASET_VERSION_NOT_FOUND       数据集版本不存在
EXPERIMENT_DATASET_VERSION_NOT_READY       数据集版本不是 READY
EXPERIMENT_DATASET_CODE_MISMATCH           数据集语义代码与声明不匹配
EXPERIMENT_FORWARD_DATA_FORBIDDEN          未声明使用未来数据却读 rd ≥ 1（PIT 结构闸门）
EXPERIMENT_FORWARD_DATA_PURPOSE_MISSING    声明了 usesForwardData 却没写用途
EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE       声明的相对日超出该版本真实视界
EXPERIMENT_RESULT_INVALID                  结果不符信封契约 / 自有 schema / 样本账不平
EXPERIMENT_RUN_FAILED                      执行期失败（含 run() 抛出的非领域错误）
```

前端只认既有那一套抠码协议（`[CODE] ` 前缀 + `readRpcDomainCode`），**不要新造第二套**。

---

## L. 测试要求

新实验至少补这四类（放 `tests/server/researchExperiments/` 或 `tests/shared/`，
**测试文件必须在 `tests/` 下**才会被 vitest 执行）：

1. **Contract Test** —— 元数据自洽 + 参数校验（含越界/枚举外/未知键）+ 结果 schema；
2. **Runner Test** —— 用内存 Dataset 桥跑通 `SUCCEEDED`，并覆盖
   「`run()` 抛异常 ⇒ FAILED」与「结果不符 schema ⇒ FAILED」；
3. **Example E2E（真实 Dataset）** —— 走 `appRouter.createCaller` 真实执行一次，
   断言结果形状与样本账；**禁止 mock 结果**；
4. **Frontend Smoke** —— 无头 Edge + CDP 量 DOM（本机 `agent-browser` 不可用）。

**验收四层**（与项目既有纪律一致）：
```
npx tsc --noEmit                    → 必须 0 error
npx vitest run <新测试目录>          → 全绿
npx vitest run                      → 失败文件集合必须与既有基线一致（零新增）
npx vite build                      → exit 0
```

---

## M. 禁止事项

| 禁止 | 原因 |
| --- | --- |
| 删除 / 修改旧 Research（Analysis / Finding / Conclusion） | 两套体系并存（规格 §14） |
| 改 Strategy Core / 重做 Parameter Search / Backtest / OOS / Walk-Forward / Robustness | 本体系不碰这些能力 |
| 绕过 Dataset 契约直连数据库（`getDb()` / `ds_*` 直查） | 版本边界与 PIT 会失守 |
| 在契约或代码里引入 `analysisId` / `findingIds` / `conclusion` / `candidateId` | 新实验不得耦合旧结构 |
| `db:push` / `drizzle-kit generate` / 新增表 | 本体系**零新表、零写口** |
| mock / fake 研究结果 | 示例与 E2E 必须用真实数据 |
| 页面里自己 fetch / import `server/**` 运行时 | 会造出第二套执行入口 |
| 引入新的 UI 框架 / 图表库 / 新 npm 依赖 | 沿用既有 `@/components/ui` + `recharts` |
| 产出 `best/worst/rank` 之类排序评级字段 | 样本内选择不是结论 |
| 用 0 / 空串兜底「算不出来」 | 会让页面撒谎 |
| 静默丢弃样本（不登记原因） | 样本账必须平 |
| 吞错（catch 后返回空结果） | 失败必须可见 |

---

## N. 一个完整可运行示例

**完整源码 = `research-experiments/first-board-pullback/entry-day/`**（4 个文件，逐行可读）。
概览：

| 项 | 内容 |
| --- | --- |
| 研究问题 | 首板之后，在第 T+k 个交易日开盘入场、持有到第 T+exit 收盘，不同 k 的基础统计差多少 |
| id / pageKey | `first-board-pullback/entry-day` |
| 参数 | `entryDays`（INT_LIST，默认 `[1,2,3,4,5]`）、`exitRelativeDay`（INT，默认 5）、`maxEvents`（INT，默认 2000） |
| Dataset 声明 | `first_limit_pullback`；events `[isFirstLimit, boardType, previousClose]`、feature `[close]`、observation `[open, high, low, close]`；`prefixRelativeDays [0]`、`postRelativeDays [1..20]`；`usesForwardData: true`、`decisionOffsetDays: null` |
| 样本单位 | （事件 × 入场日）一次可评估的入场机会 |
| 结果 | 1 张逐入场日统计表 + 4 项统计量 + 5 个收益分布 + 1 组相对基准比较 + 2 张柱状图 + `customPayload`（逐入场日机器可读汇总 + 剔除原因中文表 + 选择偏差登记） |
| 真实运行结果（v2 数据集，`maxEvents=400`） | T+1：399 样本 / 平均 +4.61% / 中位 +2.44% / 胜率 57.9% / 平均入场位置 +1.58% / 平均最大不利偏移 −6.84% |

它刻意演示了：规格 §7 允许的**每一种页面能力**、样本账怎么记、
选择偏差怎么如实登记、以及「为什么不给最佳入场日」。

模板（更简单的起点，**不用未来数据**）= `research-experiments/template/`。

---

## O. 如何把生成后的 Experiment 放入项目

```bash
# 1) 在仓库根创建目录（<组> 与 <实验> 都是小写 kebab-case）
mkdir -p research-experiments/my-group/my-experiment
#   放入 experiment.ts / result.ts / page.tsx / README.md（照 template 改）

# 2) 注册（两处各加一行）
#    research-experiments/manifest.ts                 ← import + 数组项
#    client/src/researchExperiments/pages.ts          ← pageKey → 组件

# 3) 自检（必须全过）
npx tsc --noEmit
npx vitest run tests/server/researchExperiments
npx vite build
```

然后在浏览器打开左侧栏「研究 → **独立实验**」（`/research-experiments`），
点开你的实验，选择 Dataset 版本，点「运行」。

### 交付前逐条自检

- [ ] `descriptor.id` 与目录路径**逐字一致**，且形如 `<组>/<实验>`
- [ ] `pageKey` 已在 `pages.ts` 登记（键与 `pageKey` 完全相同）
- [ ] `requiredColumns` 里每个列名都在 §E.2 的真实列清单里
- [ ] `prefixRelativeDays` 全部 ≤ 0、`postRelativeDays` 全部 ≥ 1
- [ ] 有 `postRelativeDays` ⇒ `usesForwardData: true` 且写了 `forwardDataPurpose`
- [ ] `run()` 里**没有**任何 DB / 文件 / 网络访问，全部数据来自 `context.dataset`
- [ ] `sampleSummary` 的账是平的（`eligible + excluded === candidate`、原因合计 === `excluded`）
- [ ] 缺数据都进了 `excludedByReason`，且原因码都在你的闭集表里
- [ ] 算不出来的量一律 `null`，没有 0 / 空串兜底
- [ ] 没有 `best/worst/rank` 之类字段
- [ ] `page.tsx` 没有运行时 import `experiment.ts` 或 `server/**`
- [ ] 明暗主题都能读（文字用语义色 / `currentColor`；涨红跌绿）
- [ ] 改了计算口径 ⇒ `descriptor.version` 与 `customPayload.computationVersion` **同步**升
- [ ] `README.md` 写清了口径、参数默认值、已知偏差、刻意不做的事
- [ ] 补了 Contract / Runner / E2E / Frontend Smoke 四类验证
- [ ] （004）声明的产物名字是 **Run 前缀下的相对名字、且不含角色段**（如 `cohort.csv`；
      `tables/` / `charts/` 由 `role` 拼，写了会得到 `tables/tables/…`），**不是**绝对路径、不含 `..`
- [ ] （004）大型产物走 `context.artifact(...)`，**没有**塞进 `customPayload` / `tables`（见 §P.3）

---

## P. 结果持久化与产物（RESEARCH-EXPERIMENT-004）

> 001~003 时执行是**请求内计算**：结果不落库，关掉页面/刷新就没了，想看只能重跑。
> **004 改变了这一点**：Run 元数据进 TiDB，结果与产物进对象存储（MinIO）。
> 这一节是「你的实验跑完之后会发生什么」的完整说明。

### P.1 你不需要做的事（重要）

持久化**全部由平台完成**，实验作者**不需要**、也**不允许**：

| 不要做 | 为什么 |
| --- | --- |
| 不要自己连 DB、写表 | 实验代码**拿不到 DB**（`run()` 里连 `server/**` 都 import 不到） |
| 不要 import MinIO / S3 SDK | 唯一出口是 `context.artifact()`；直接依赖对象存储 SDK 是禁止的 |
| 不要自己拼 Object Key | Key 由平台按坐标拼（见 §P.5） |
| 不要改 tRPC 路由 / 前端路由 | 列表 / 详情 / Run 详情页由平台统一提供 |
| 不要自己写 `manifest.json` | 平台按你声明的产物自动生成 |

你**只需要**：算出结果（返回信封）+ 需要留档的大文件调 `context.artifact(...)` 声明一下。

### P.2 Run 生命周期（你的实验处在哪一步）

```text
建立 Run ──▶ PENDING ──▶ RUNNING ──▶ 执行 run() ──▶ 生成结果信封
                                                      │
                                    ┌─────────────────┴──────────────────┐
                                    ▼                                    ▼
                          上传产物到对象存储                    执行中抛错 / 返回 FAILED
                                    ▼                                    ▼
                          生成 manifest.json 索引                  FAILED + errorMessage
                                    ▼
                     校验产物确实存在 ──▶ 写 resultManifestKey ──▶ COMPLETED
```

- 状态只有四个：`PENDING` / `RUNNING` / `COMPLETED` / `FAILED`。
- 🔴 平台保证**不会**出现「DB 标记 `COMPLETED` 但对象存储里没有结果」——
  顺序是「先上传、再校验、最后才写 `COMPLETED`」。
- 🔴 **失败不会被伪装成成功**：执行失败 ⇒ Run 落 `FAILED` + 错误信息；
  算完了但**产物没传上去** ⇒ 也**不**报成功（会明确显示「实验算完了但结果没能持久化」）。

### P.3 产物分两类

**① 平台自动产出的（你什么都不用做）**

| 文件 | 内容 |
| --- | --- |
| `result.json` | 你返回的结果信封（含 `sampleSummary` / `tables` / `parameters` 等） |
| `logs/run.log` | 你在 `run()` 里 `log(...)` 写下的行（上限 200 行） |
| `manifest.json` | **索引**：登记本次 Run 全部产物的 Key / 类型 / 体积 |

**② 你声明的（必须显式调用）**

```ts
run(context: ExperimentRunContext) {
  const { dataset, artifact } = context;
  return (async () => {
    // …算完…

    // 🔴 大型产物这样留档：name 是 Run 前缀下的相对名字，**不含角色段**
    //    —— 角色段由下面那个 `role` 决定（写重复会得到 `tables/tables/…`）。
    artifact({
      name: "cohort-detail.csv",
      role: "table",                       // "table" | "chart" | "log" | "artifact"
      body: toCsv(rows),                   // string 或 Uint8Array
      contentType: "text/csv",             // 可省，按扩展名推断
      label: "逐事件明细",                  // 显示在页面上的中文标签
      description: "每个事件的入场日 / 收益 / 剔除原因",
    });

    return assembleMyResult({ /* … */ });
  })();
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | ✅ | Run 前缀下的**相对名字**，可含子目录（`cohort.csv` / `detail/rows.csv`）；🔴 **不含角色段**（`tables/` / `charts/` 由 `role` 拼）；**禁止**绝对路径 / `..` / 空 |
| `role` | ✅ | 落哪个固定段：`table` / `chart` / `log` / `artifact` |
| `body` | ✅ | `string` 或 `Uint8Array` |
| `contentType` | ❌ | MIME；缺省按扩展名推断 |
| `label` / `description` | ❌ | 人读标签，进 Manifest 并显示在页面上 |

⚠️ `name` 非法会在**收集时立刻抛领域错误**（`EXPERIMENT_ARTIFACT_KEY_INVALID`），
不会等到上传阶段才炸 —— 那时结果已经算完了，白跑一次。

### P.4 什么时候「不该」用 `artifact()`

- **小表格 / 指标 / 图表数据** ⇒ 走返回值里的 `tables` / `statistics` / `charts`，
  页面直接渲染，**不用**落对象存储；
- **几十 MB 的逐事件明细** ⇒ 走 `artifact()`；
- 🔴 页面初始化时**不会**自动下载全部产物（规格 §17）：大文件只在你**主动点开**时才发请求。
  所以不要在 `run()` 里为了「让页面能显示」而产出超大文件。

### P.5 Object Key 规范（平台自动拼，你只需知道长什么样）

```text
experiments/{group}/{key}/runs/{runId}/manifest.json
experiments/{group}/{key}/runs/{runId}/result.json
experiments/{group}/{key}/runs/{runId}/logs/run.log
experiments/{group}/{key}/runs/{runId}/tables/cohort-detail.csv      ← role: "table"
experiments/{group}/{key}/runs/{runId}/charts/equity-curve.svg        ← role: "chart"
experiments/{group}/{key}/runs/{runId}/artifacts/raw.bin              ← role: "artifact"
```

`{group}/{key}` = 你的 `descriptor.id` 的两段（如 `first-board-pullback/entry-day`）；
`{runId}` 形如 `RUN-20260920-1F0B5D96`（平台生成，一个 Experiment → **多个** Run，旧 Run 不被覆盖）。

### P.6 `manifest.json` 是什么，以及「授权 = Manifest 白名单」

Manifest 是本次 Run 的**产物索引**（不是新格式，只是 Key + 类型 + 体积的清单）。
它同时是**访问控制的唯一依据**：

- 前端只能读**已登记**在 Manifest 里的对象 ⇒ 未登记 ⇒ `404`；
- 一个 Run 的凭据**不能**读另一个 Run 的对象 ⇒ 跨 Run ⇒ `400`；
- MinIO 凭据**不进**浏览器 bundle；页面只能经后端 `GET /api/experiments/artifact` 取产物。

⇒ 这也意味着：**没调 `artifact()` 的文件，页面上也不会有**（它压根不存在）。

### P.7 跑完之后，在页面上能看到什么

| 页面 | 路由 | 看到什么 |
| --- | --- | --- |
| 实验列表 | `/research-experiments` | 每个实验：版本 / 数据集 / 状态 / **Latest Run** / **最近运行时间** |
| 实验详情 | `/research-experiments/<组>/<实验>` | 元数据 / Dataset 版本 / 参数 / **运行历史**（多次 Run 并存） |
| **Run 详情** | `/research-experiments/<组>/<实验>/runs/<runId>` | 状态 / 数据集 / 参数 / 开始与完成时间 / **耗时** / 结果 / **产物清单** |

★ 核心能力：**关掉页面再打开，历史 Run 仍在那里，不需要重跑。**

### P.8 你需要为之负责的只有一件事

**让产物可解释**：产物名字与 `label` 要让人（和以后的你）看懂这是什么。
平台负责「存得住、找得到、不串号」，不负责「这份 CSV 是什么意思」。

