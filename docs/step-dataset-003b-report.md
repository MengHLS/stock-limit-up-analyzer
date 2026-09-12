# STEP DATASET-003B — 构建筛选能力补齐（筛选配置固化 + 全链路真实生效）

**任务代号**：DATASET-003B
**状态**：`COMPLETE`
**日期**：2026-09-10
**依赖**：DATASET-001（Registry + 独立物理表）、DATASET-002.2（只读契约/查询/路由）、DATASET-002.3（前端 MVP）、DATASET-002.4A（生命周期状态机）、DATASET-002.4B（真实构建执行器）、DATASET-003A（多数据集插件化 + 删除能力）

---

## 1. 需求原文与澄清

> 「在构建新版本弹窗的筛选功能中，当前可用的筛选项过少，需要补充和完善筛选能力：支持按 t 日事件、t-1 日事件等事件维度选项；支持选择各种板块；支持选择是否排除 ST 股票；支持设置 t 日之前及 t 日之后的数据天数范围。只有在完成上述筛选条件配置后，才能进行数据筛选与构建。请明确该筛选功能的整体设计，并说明这些筛选条件及配置信息的保存方案，评估保存在何处更为合适。」

经澄清确认四条关键口径（用户逐项选择）：

| 决策点 | 用户选择 | 含义 |
| --- | --- | --- |
| 板块口径 | **交易所板块** | 主板 / 创业板 / 科创板 / 北交所，与 `classifyBoard` 同源；拒绝申万行业方案 |
| 事件维度模型 | **相对日 × 事件类型** | 两个控件组合成一条规格，多条规格间为「或」 |
| 保存位置 | **新建独立配置表** | 显式拒绝「版本级 JSON 列」方案 |
| 生效范围 | **全链路真实生效** | 改 builder/IO 让筛选真正决定出数，并做真实 TiDB 端到端验证 |

---

## 2. 整体设计

### 2.1 两层筛选模型（回答两个不同的问题）

```
┌─ Universe 层（池子里有谁）──────────────────────────────┐
│   boards     : 交易所板块多选（空 = 全板块，含无法归类的）  │
│   excludeSt  : 是否按 PIT 状态排除 ST/*ST                │
└────────────────────────────────────────────────────────┘
┌─ Signal 层（谁触发事件、看多远）─────────────────────────┐
│   events          : [{ relativeDay, kind }, ...]  OR 语义 │
│   preWindowDays   : t 日之前物化多少交易日                 │
│   postWindowDays  : t 日之后物化多少交易日                 │
└────────────────────────────────────────────────────────┘
┌─ 执行参数（非筛选维度，同表固化）─────────────────────────┐
│   outcomeHorizons : 结果视界（交易日）                     │
│   batchSize       : 批大小                                │
└────────────────────────────────────────────────────────┘
```

**为什么必须分层**：Universe 层决定「样本池」，Signal 层决定「触发条件」。两者叠加语义不同——先筛板块再判事件，与先判事件再筛板块结果相同，但**性能与语义清晰度**不同：builder 把 Universe 判定放在信号判定之前，避免为注定被剔除的标的做富集查询。

### 2.2 相对日锚点语义（反未来泄漏的硬约束）

`relativeDay ≤ 0`，以**事件日 t 为 0**：

| relativeDay | 含义 | 典型用法 |
| --- | --- | --- |
| `0` | t 日判定 | 等价 DATASET-001/002 既有口径（t 日首板） |
| `-1` | t-1 日判定 | 「T-1 首板，T 日作为观察起点」 |
| `-n` | t-n 日判定 | 更早的锚点 |

**反泄漏双层防护**：契约层（zod `relativeDay ≤ 0`）与纯函数层（`filter.matchesEventSpec`）都不接受正锚点。锚点永远在事件日**当天或之前**，不存在「用未来数据判今天」的可能。

### 2.3 保存方案评估与选型

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| A. 版本级 JSON 列（复用 `filterDefinition`） | 零 migration、改动最小 | 不可索引 / 不可 SQL 约束 / 多值维度（板块、事件）无结构 / 无法按板块反查版本 | ❌ 否决 |
| B. 纯 JSON 一把梭（新表 + 单 JSON 列） | 表数量少 | 同上：结构不可约束、不可索引 | ❌ 否决 |
| **C. 独立配置表（标量入列 + 多值入子表）** | 标量可索引 / 多值可约束（唯一键）/ 可反查 / 配置与版本 1:1 显式建模 | 需 3 张表 | ✅ **采纳（用户选择）** |

**最终结构（3 表）**：

```
dataset_build_config          ── 主表，与 dataset_version 1:1
  id, datasetVersionId(UNIQUE), excludeSt, preWindowDays, postWindowDays,
  outcomeHorizonsJson(LONGTEXT), batchSize, configVersion, createdAt, updatedAt
dataset_build_config_event    ── 事件维度（多值）
  configId, relativeDay, eventKind, sortOrder
  UNIQUE(configId, relativeDay, eventKind)
dataset_build_config_board    ── 板块（多值）
  configId, board, sortOrder
  UNIQUE(configId, board)
```

设计要点：
- **标量入列**（`excludeSt` / 前后窗口 / 批大小）→ 可索引、可 SQL 过滤、可做数据质量审计；
- **多值入子表**（板块 / 事件规格）→ 有唯一键约束，天然去重，不需要应用层去重；
- **一个逻辑配置 = 3 张表的一组固定行**；版本通过 `configId` 关联，`datasetVersionId` 上 `UNIQUE` 保证 1:1；
- `outcomeHorizonsJson` 用 **LONGTEXT**（与 checkpoint 同一教训：`TEXT` 在上限边缘会撑爆）。

---

## 3. 落地改动清单

### 3.1 新增

| 文件 | 职责 |
| --- | --- |
| `drizzle/0029_dataset_build_config.sql` | 3 表幂等 DDL（`CREATE TABLE IF NOT EXISTS` + 唯一键） |
| `scripts/applyDatasetBuildConfig.mjs` | 幂等建表脚本（剥注释 → 按分号切分 → 逐条执行 → 校验 3 表 + 3 唯一约束） |
| `server/datasetRegistry/filter.ts` | **筛选语义唯一权威（纯函数层）**：`matchesEventKind/Spec/AnyEventSpec`、`eventSpecKey`、`isBoardAllowed`、`isStExcluded`、`maxLookbackDays`、`BUILD_FILTER_DEFAULTS/LIMITS` |
| `client/src/components/datasetRegistry/datasetFilterForm.ts` | **前端筛选纯逻辑层**（无 UI / 无网络）：表单状态 → 校验（构建门禁）→ wire 载荷 |
| `server/datasetRegistry/filter.test.ts` | 筛选纯函数单测（20 例） |
| `client/src/components/datasetRegistry/datasetFilterForm.test.ts` | 前端表单逻辑单测（26 例） |
| `scripts/verifyDataset003b.mts` | 真实 TiDB 端到端验证（含网络重试 + 紧急清理） |
| `docs/step-dataset-003b-report.md` | 本报告 |

### 3.2 修改（后端）

| 文件 | 关键改动 |
| --- | --- |
| `drizzle/schema.ts` | 新增 3 配置表定义 + 类型导出 |
| `shared/datasetRegistryContracts.ts` | 新增 B2 节：`DATASET_BOARDS`/`LABELS`、`DATASET_EVENT_KINDS`/`LABELS`、`datasetBuildFilterSchema`（含默认值 + 边界 + 去重 `superRefine`）、`DatasetBuildConfigView`、`describeDatasetFilter`（唯一文案来源）；`createDatasetVersionInputSchema` 入参收敛为单一 `filter` 字段 |
| `server/datasetRegistry/types.ts` | 新增 `DatasetBoard`/`DatasetEventKind`/`DatasetEventSpec`/`DatasetBuildConfigRecord`；checkpoint 新增 `limitUpDays` + `schemaVersion` |
| `server/datasetRegistry/lifecycle.ts` | 新增错误码 `INVALID_BUILD_FILTER` / `CHECKPOINT_INCOMPATIBLE`；新增 `normalizeBuildFilter`（权威规范化，非法即抛，**不静默夹取**）；`resolveBuildConfig` 改为**三级回退链** |
| `server/datasetRegistry/registry.ts` | Repo 契约 + 内存实现新增 `saveBuildConfig`/`getBuildConfig`/`deleteBuildConfigsByVersion`；`createVersionWithBuildConfig` 接收 `filter` 并固化配置；删除级联返回 `configsDeleted` |
| `server/datasetRegistry/db.ts` | 配置表读写（主表 `onDuplicateKeyUpdate` + 子表先删后插）；`buildConfigMasterToDomain` 映射 |
| `server/datasetRegistry/query.ts` | `getVersion` 返回 `buildConfig`（`toBuildConfigView`） |
| `server/datasetRegistry/runner.ts` | 构建前 `getBuildConfig` → `resolveBuildConfig` → 传给 builder（**与 CLI 同一解析路径**） |
| `server/datasetRegistry/builder.ts` | **筛选真实生效落点**（见 §4） |
| `server/datasetRegistry/router.ts` | 2 个新端点 `getBuildConfig` / `resolveBuildConfig`；错误码映射（`INVALID_BUILD_FILTER`→BAD_REQUEST、`CHECKPOINT_INCOMPATIBLE`→PRECONDITION_FAILED） |

### 3.3 修改（前端）

| 文件 | 关键改动 |
| --- | --- |
| `BuildVersionDialog.tsx` | 新增完整筛选面板（板块 Checkbox 组 / 排除 ST / 事件维度行「相对日 × 事件类型」可增删 / t 前后窗口）+ 筛选摘要行；**构建门禁**：校验未通过则提交按钮禁用 |
| `pages/datasets/VersionDetail.tsx` | 新增「构建筛选口径（建版本时固化，不可后改）」区块，用 `describeDatasetFilter` 展示已固化口径 |

### 3.4 顺带修复的两处「形态变更遗留」（否则会静默出错）

| 文件 | 问题 | 修复 |
| --- | --- | --- |
| `scripts/runDataset001Build.mts` | 仍传旧字段 `pathHorizon`，且 `scripts/` **不在 tsconfig 内**（tsc 查不到）→ 运行时会因 `postWindowDays` 为 `undefined` 而**静默产出 0 条 path** | 新增筛选 CLI 参数（`--boards/--exclude-st/--events/--pre/--post/...`，`--path-horizon` 保留为 `--post` 兼容别名）；构建配置改为**从已固化配置解析**（`resolveBuildConfigForVersion`），CLI 与产品路径不可能再分叉 |
| `scripts/verifyDataset0024a.mts` / `verifyDataset0024b.mts` | 旧 `createVersion` 调用缺 `filter` → 会被新门禁拒绝；`0024b` 还断言已废弃的 `filterDefinition.pathHorizon` | 补 `filter`；`0024b` 改为断言**配置表回读**（更权威） |

---

## 4. 构建器内的关键语义决定（筛选真实生效）

### 4.1 索引基准与构建窗口解耦

`tradingDayIndex` 基于**完整交易日历**，构建范围另用 `[windowStartIdx, windowEndIdx]` 表达。
原因：负锚点（T-1/T-n）与 `preWindowDays` 都需要回看到**构建窗口之前**的交易日；若把索引基准裁到窗口内，T-1 锚点与前置窗口在左边界处必然取不到。

### 4.2 逐 bar 全量判定（不能只遍历涨停 bar）

旧实现 `if (!isLimitUp) continue`。负锚点下**事件日 t 当天可以完全不涨停**（「T-1 首板，T 日观察」），因此必须**逐 bar 全量判定**，命中与否由锚点日决定。

### 4.3 左边界预热（warm-up）—— 有界回扫

窗口首日的「上一交易日是否涨停」必须已知，否则会把**连板误判成首板**。为此在事件循环前有界回扫：

```
warmupDays   = max(|负锚点相对日|, 1)     // 真正需要的回看深度由筛选口径决定
warmupStart  = max(0, windowStartIdx - warmupDays)
```

只把涨停日序号补进 `limitUpDays`，**不产出事件**；`resume` 时 checkpoint 已携带完整 `limitUpDays`，不重复预热。

### 4.4 涨停状态用「涨停日序号数组」而非双标量

`limitUpDays: Map<symbol, number[]>`（升序、二分查找）取代旧的 `prevLimitUp + cumulative` 双标量——只有它才能精确回答**任意相对日**的涨停状态。

### 4.5 三级回退链

`dataset_build_config` 行 → `version.filterDefinition`（legacy 镜像）→ 权威默认值。
保证：新版本走配置表；DATASET-003B 之前建的旧版本（无配置行）仍按历史镜像/默认口径可解析，不会因新功能而无法构建。

### 4.6 诚实失败（两个明确错误码）

| 错误码 | 触发 | 为什么不静默兜底 |
| --- | --- | --- |
| `INVALID_BUILD_FILTER` | 筛选配置缺失/越界/正锚点/未知板块 | 静默夹取会产出「用户以为筛了、其实没筛」的数据 |
| `CHECKPOINT_INCOMPATIBLE` | 旧 checkpoint 无 `limitUpDays` 且 `completedChunks > 0` | 静默续跑会用不完整状态产出**错误样本且无人察觉** |

---

## 5. 🔴 重大发现并修复：涨停判定浮点精度导致系统性漏判（38%）

### 5.1 发现过程

为 DATASET-003B 补 builder 筛选单测时，构造「前收 11 → 涨停价 12.10」的封板样本，断言失败。追查发现：

```ts
// 旧实现（server/datasetRegistry/detection.ts）
return close >= limitUpPrice(preClose, ratio);   // = preClose * (1 + ratio)，未四舍五入
```

`11 × 1.1 = 12.100000000000001 > 12.10` → **真实封板收盘价被判为「未涨停」**。

### 5.2 真实数据量化（`docs/evidence/_limitprecision_probe.mjs`，真实 TiDB）

扫描 `stock_daily_prices` 2025-01-01..2026-09-04（299,946 行）：

| 指标 | 数值 |
| --- | --- |
| 收盘价恰为「四舍五入到分」涨停价的封板样本 | **4,325** |
| 旧实现能识别的 | 2,680 |
| **漏判** | **1,645（38.03%）** |

漏判率与板块无关（主板 10% / 创业板·科创板 20% / 北交所 30% / ST 5% 均受影响）。

### 5.3 根因

A 股交易所的涨停价是**四舍五入到分**的（如前收 6.81 → 涨停价 7.49）；而旧实现拿**未四舍五入的原始浮点乘积**（`6.81 × 1.1 = 7.491`）作阈值。当「四舍五入后的价格 < 原始乘积」时（实测约 40–47% 的价位区间），封板价 `>= 原始乘积` 恒为 false。

### 5.4 修复

新增**交易所口径**的唯一权威函数（`server/data/boardRules.ts`）：

```ts
export function exchangeLimitUpPrice(prevClose: number, limitUpRatio: number): number {
  return Math.round(prevClose * (1 + limitUpRatio) * 100) / 100;
}
```

两处消费点统一改用它：
1. `detection.isLimitUpClose` —— 判定口径（附 `1e-9` 容差仅抵御两位小数 double 比较误差，不放松业务口径）；
2. `builder.assembleEventRow` 的 `limitUpPrice` **事实列**（此前记录的是 `12.100000000000001` 这类脏值）。

同时**未改动** `engine/execution.limitUpPrice`（回测执行模型的口径有其既有锁定测试，属另一条链路，不在本任务范围）。

### 5.5 影响面（必须如实说明）

- 该缺陷影响**所有历史构建的 ds_\* 数据**（DATASET-001 的 smoke/v1/v2 均在其下）；
- 结论：**既有数据集已不可用于正式研究，必须重建**；
- 新增回归测试锁定正确行为（`detection.test.ts` 新增 3 组：封板价必判涨、低 1 分必判否、超涨停价仍判涨）。

---

## 6. 另一个发现（未修复，如实上报）：执行器终态写库非原子

`runner.ts` 收尾为两次独立写库：

```ts
await service.completeJob(job.jobId);          // job → COMPLETED
await service.markReady(versionId, { ... });   // version → READY + 计数
```

**可观测后果**：窗口内 `job=COMPLETED` 但 `version=BUILDING`、`totalEvents/totalRows = 0`。
本地验证脚本已**两次**撞上该窗口（第一次读到 `events=0 rows=0`，而物理表已有 2346 行）。

**风险**：若进程在两次写库之间崩溃，版本将**永久停留 BUILDING 且计数为 0**；由于 `COMPLETED` 作业不可 retry，只能删版本重建。

**状态**：DATASET-003A 时已在**验证脚本侧**规避（等 version READY），但**执行器侧从未修复**。本次仅加入显式测量与上报，**未做修复**（属独立改造：需把两次写库合并为一个事务，涉及 Repo 契约与状态机校验搬迁，有回归风险，不宜夹带进本任务）。

**建议修复**：新增 repo 方法 `completeJobAndMarkVersionReady(jobId, counts)`，在**单个 DB 事务**内完成两次写；或增加启动期对账（`version=BUILDING` 且其作业全部 COMPLETED → 依据物理表真实行数补 `markReady`）。

---

## 7. 验证

### 7.1 静态与单测

| 项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **exit 0** |
| 目标测试套件（datasetRegistry + contracts + 前端筛选/适配器） | **17 文件 / 252 tests 全过**（基线 193 → 252，新增 59 例） |
| `npm run build` | **PASS**（vite 2970 模块 + esbuild 服务端 bundle） |
| 全量 `vitest run` | 2604 过 / 16 失败 —— **8 个失败文件均为既有环境依赖（跨境 DB 写、Tushare token 缺失、网络超时），已逐一确认无一import 本任务改动模块** |

### 7.2 真实 TiDB 端到端（`scripts/verifyDataset003b.mts`）

生产同源装配：`DbDatasetRegistry` + `DatasetRegistryService(plugins, DbDatasetPhysicalStore)` + `DefaultDatasetBuildRunner`（与线上 runner 同一条路径，构建配置由配置表解析）。

| 阶段 | 检查内容 | 结果 |
| --- | --- | --- |
| 0 | 3 张配置表就位 + 基线快照 | ✅ |
| 1 | **构建门禁**：events 空 / postWindowDays 越界 / 正锚点 / 未知板块 → 均 `INVALID_BUILD_FILTER`，且**不留半成品版本** | ✅ 5/5 |
| 2 | 基准版本（全板块·含ST·T日首板·t+20）真实构建 → READY + 计数落库 + **配置回读与提交逐字段一致**（主表标量 + 子表多值）+ 版本详情视图带 `buildConfig` | ✅ |
| 3 | **板块筛选**：仅主板版本事件**全部** boardType=main，且事件集是基准版本的**严格子集** | ✅ |
| 4 | **排除 ST**：逐事件用**生产 PIT 口径**（`DbDatasetBuildIO.resolveSt`）回查，事件日处于 ST/*ST 的样本 **0 例**；同时报告基准版本含 ST 样本数（证明约束被真实触发） | ✅ |
| 5 | **事件维度 T-1 锚点**：逐事件回查前一交易日，用生产口径（含 **PIT ST 的 5%**）判定确实涨停，**0 违规**；且事件集与 T 日口径不同 | ✅ |
| 6 | **前置窗口**：`preWindowDays=5` 真实物化负相对日 path 行（-5..-1），**带真实 OHLC 而非占位 null** | ✅ |
| 7 | **级联清理**：`deleteVersion` → `configsDeleted≥1` + 配置回读 null + 物理行清零；`deleteDefinition` → 该定义下配置全清 | ✅ |
| 8 | **零残留**：无遗留临时版本 / 配置行 / 临时定义 | ✅ |
| 9 | 终态非原子性时间差测量（见 §6） | ✅（见脚本输出） |

**验证过程中发现并修正的两处「脚本自身」错误（诚实记录）**：

1. **假阳性**：T-1 锚点校验最初按代码前缀取 10% 涨停比例，把 **PIT ST 股（5%）** 误判为「前一日未涨停」（4 例）。DB 取证确认 `000615.SZ / 000669.SZ / 002309.SZ` 在前一日均为 **ST** 且收盘价恰等于 5% 涨停价 —— **构建器是对的，脚本是错的**。已改为复用生产函数 `limitUpRatio + isLimitUpClose`。
2. **脚本健壮性**：等版本 READY 超时后仍在阶段 7 尝试删除带 RUNNING 作业的版本而崩溃；跨境 TiDB 偶发 `ECONNRESET` 中断脚本并遗留临时版本。已加入：瞬时错误有限重试（只读）、删除前先取消非终态作业、`unhandledRejection/uncaughtException` 紧急清理。

### 7.3 端到端验证后的数据快照

- `first_limit_pullback` 定义：**1 行**（`id=1`），版本恢复为 **3 个**（smoke / v1 / v2），临时版本与配置行**零残留**；
- 三张 `ds_first_limit_pullback_*` 物理表**行数未变**（临时版本的行已随删版本清除）。

---

## 8. 附：关于「path / outcome 数据看起来一直重复」的排查结论

同期收到反馈「path 跟 outcome 的数据一直重复」。用真实 DB 分三层取证（`docs/evidence/_dupcheck_probe.mjs`）：

| 层 | 判定 | 证据 |
| --- | --- | --- |
| **L1 表内重复** | **0** | 按 `(datasetVersionId, eventId, relativeDay)` / `(…, horizon)` / `(…, eventId)` 分组 `HAVING COUNT(*)>1` → **三张表均 0 组**；唯一索引实际存在（`uq_ds_flp_path_version_event_day` 等） |
| **L2 跨版本同源** | 存在，且**正确** | 同一 `eventId+relativeDay` 最多出现在 6 个 `datasetVersionId` 下（205,954 行仅属 1 个版本，427 行属 6 个版本）—— 每个版本各有自己的一份，这是**版本隔离的正确行为** |
| **L3 行数关系** | 无重复 | `path_rows = 事件数 × 相对日数` 严格成立（如 740×21=15540、682×6=4092 → 实测一致），偏差只出现在窗口边缘（日历边界截断） |

**结论**：不是重复写入。观感上的「重复」来自两件事叠加——
1. **验证脚本临时建的多个版本落在同一窗口**，同一批市场事实在多个版本下各存一份（脚本结束已全部清除）；
2. 既有 `v1`（1 个月，516 事件）的窗口是 `v2`（2024 全年，10,240 事件）的**子集**，两者并存时同一事件自然出现两次。

前端预览按 `(eventId, relativeDay)` keyset 分页且**强制 `datasetVersionId` 下推**，不存在跨页重复。

---

## 9. 交付物

| 类型 | 路径 |
| --- | --- |
| 详细报告 | `docs/step-dataset-003b-report.md`（本文） |
| 端到端验证 | `scripts/verifyDataset003b.mts` |
| 精度证据探针 | `docs/evidence/_limitprecision_probe.mjs`（涨停漏判量化）、`docs/evidence/_t1anchor_probe.mjs`（PIT ST 取证）、`docs/evidence/_dupcheck_probe.mjs`（重复排查） |
| 建表脚本 | `scripts/applyDatasetBuildConfig.mjs` + `drizzle/0029_dataset_build_config.sql` |
| 一次性清理脚本 | `scripts/_cleanup003b.mts`（取消非终态作业 + 删临时版本/定义） |

---

## 10. 遗留与后续建议

| 优先级 | 事项 | 说明 |
| --- | --- | --- |
| **P0** | **重建既有数据集** | 涨停漏判修复后，smoke/v1/v2 的样本数偏低（实测封板漏判 38%），须用修复后的口径重建；重建前不应基于旧数据产出任何策略结论 |
| **P1** | 修复执行器终态非原子 | `completeJob` + `markReady` 合并为单事务（§6） |
| **P2** | checkpoint 体积优化 | `limitUpDays` 随构建天数增长（每 symbol 全部涨停日序号），每日 checkpoint 重写全量 JSON；长窗口构建的写放大明显。若要优化需保留 `historicalLimitCount` 的语义（不能简单截断窗口） |
| **P3** | 筛选面板可加「已用约束提示」 | 例如所选板块在该窗口内的样本量为 0 时提前提示，避免用户建出版本才发现空数据 |
