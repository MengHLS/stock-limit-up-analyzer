# SCOPE-002 — 策略创作工作台（前端完整构建 Strategy 的契约与交互设计）

> 日期：**2026-10-03** · 状态：**DECIDED（§6 六项已裁定，未实现）** · 作者：Architecture / Frontend / Product 联合设计
> 目标策略：**Strategy Version `3570001`**（`first-limit-pullback-3f-top3-runner-hold20@1.0.0`）
> 上游裁定（用户，2026-10-03）：① 起点 = **空白 canonical 从零搭**；② 编辑面 = **预设 + 参数，预设可扩展**；③ **允许**前端创建"无证据开发草稿"；④ 本文档只做**设计**，不写代码；⑤ 顺序 = **数据结构 + API → 前端交互 → 代码开发**。
> 二次裁定（用户，2026-10-03）：**§6 的 Q1–Q5 与前置项 R6 共六项，全部按建议通过** ⇒ 设计冻结，可直接进入 S0。
> 关联不变量：`AGENTS.md` §2（I-2 `datasetVersionId` · I-5 StrategyVersion · I-6 Strategy Core 唯一权威 · I-7 FIXED/TUNABLE/DERIVED · I-8 canonicalMetrics）
> 事实来源：工作区实查（`server/research/**` · `server/strategyDomainRouter.ts` · `client/src/**`）+ 真实库只读探针（`strategy_versions#3570001`）。

---

## 0. 目标与已裁定前提

### 0.1 完成定义（DoD）

> 在一个全新浏览器会话中，**不写代码、不跑脚本、不改库**，仅通过 UI 就能产出一个 StrategyVersion，使其 `definition` 经服务端规范化后与 `strategy_versions#3570001` 的 `definition` **逐字段相等**（仅 `strategyId` / `version` / `name` / `description` 等身份字段允许不同），`fingerprint` 由服务端重算。

用户动作序列：

```text
① 新建策略（起点：空白 canonical；选 strategyType · 必填）
② 选 Dataset Version（权威坐标 datasetVersionId + PRIMARY 绑定）
③ 填「买什么 / 什么条件买 / 什么时候买」
④ 选 Recipe 预设 + 调参数
⑤ 选 ExitPolicy 预设 + 调参数（含 runnerBridge）
⑥ 填「买多少 / 成本与资金 / 参数搜索空间」
⑦ 校验 → 保存为 Draft（生成冻结版本 + 指纹）
⑧ 运行回测 → 看评估 → 起模拟盘
```

### 0.2 设计铁律

| # | 铁律 | 理由 |
|---|---|---|
| **P1** | **canonical `StrategyDocument.definition` 是唯一编辑对象**。预设、模板、候选草稿只是「起点生成器」，生成后进入同一编辑器 | `AGENTS.md` §2 I-6：Strategy Core 是语义唯一权威；禁止第二套 SoT |
| **P2** | **枚举 / 预设清单由后端提供**，前端不抄第二份词表 | 现有 `client/src/components/strategy/definitionVocabulary.ts` 靠逐字对表测试防漂移（`tests/client/src/components/strategy/definitionVocabulary.test.ts`），新增 policy/recipe 后手抄必崩 |
| **P3** | **校验分层**：前端逐段即时校验（体验） + 服务端权威校验（唯一闸门） | 前端不得自造口径 |
| **P4** | **`payload` 不透明**：前端只做「选预设 + 填参数」，canonical payload 由**服务端物化**，前端逐字复制，绝不自行拼装 | 防止前端成为第二套语义实现 |
| **P5** | **零新增引擎 / 零新表 / 零 migration**：只加只读元数据 + 物化端点，写库复用既有 `StrategyService` | `AGENTS.md` §3 / §4 |

### 0.3 本次明确不做（Non-goals）

- ❌ 不改 `StrategyDefinition` schema、不改 `ExitPolicyDefinition`、不加表、不加 migration
- ❌ 不新增第二套 simulator / backtest / evaluation / paper trading 引擎
- ❌ 不在前端重算任何指标口径（一律走 `canonicalMetrics()`）
- ❌ 不做批量创作 / 协作 / 评论 / 模板市场
- ❌ 不改变「正式提升必须来自有证据的 Research → Strategy 桥」这一规则（见 §1.6）

---

## 1. 数据结构设计

> 本节先于 API，因为 API 只是这些结构在传输层的投影。
> 🔴 **本节不新定义任何已经在用的领域类型**；新增的只有「只读元数据」与「物化请求/响应」。

### 1.1 复用的既有类型（唯一权威，禁止复制）

| 类型 | 权威位置 | 用途 |
|---|---|---|
| `StrategyDocument` | `server/research/strategySchema/types.ts` | 提交 / 保存的顶层文档 |
| `StrategyDefinition` | `server/research/strategySchema/definition.ts` | `document.definition`（canonical 规则快照） |
| `StrategyRecipe` | `server/research/strategySchema/types.ts` | `document.recipe`（执行配方可序列化面） |
| `ExitPolicyDefinition` | `server/research/exitPolicyCommon.ts` | `definition.exit.rules[].policy` |
| `StopPolicyDefinition` | `server/research/stopPolicy.ts` | `policy.stop` |
| `ResearchTrailingPolicyDefinition` | `server/research/trailingPolicy.ts` | `policy.takeProfit` |
| `StrongHoldPolicyDefinition` / `CapitalRecyclePolicyDefinition` / `RunnerHoldingBridgePolicyDefinition` | `server/research/exitPolicyCommon.ts` | `policy.strongHold` / `capitalRecycle` / `runnerBridge` |
| `RunnerStateConditionReference` / `RUNNER_STATE_DEFINITIONS` | `server/research/exitPolicyCommon.ts` · `server/research/stateFactorRegistry.ts` | runner 状态引用与已注册状态清单 |
| `StrategyFamilyDefinition` | `server/research/strategyFamilyRegistry.ts` | 既有「模式族」起点（保留，不改造语义） |

**校验器（唯一闸门，前端不得复制）**：

- `validateCanonicalStrategyDefinition` · `validateStrategyDocument`（`server/research/strategySchema/**`）
- `exitPolicyDefinitionErrors` / `stopPolicyDefinitionErrors` / `runnerBridgePolicyErrors`（`server/research/exitPolicyCommon.ts`）
- `resolveStrategyRecipe`（`server/research/recipeRegistry.ts`，拒绝未注册 recipe / 特征版本不符 / 时点不符）

### 1.2 新增结构 A：作者面槽位（Slot）

```ts
/** 作者面最小可编辑单元；每个 slot 对应一段既有 canonical 结构。 */
export type StrategyAuthoringSlot =
  | "RECIPE"           // → StrategyDocument.recipe
  | "EXIT_POLICY"      // → definition.exit.rules[0].policy（组合槽）
  | "STOP"             // → policy.stop（原子槽）
  | "TAKE_PROFIT"      // → policy.takeProfit（原子槽）
  | "TIME_EXIT"        // → policy.timeExit（原子槽）
  | "STRONG_HOLD"      // → policy.strongHold（原子槽）
  | "CAPITAL_RECYCLE"  // → policy.capitalRecycle（原子槽）
  | "RUNNER_BRIDGE";   // → policy.runnerBridge（原子槽）
```

> `EXIT_POLICY` 是**组合槽**（引用若干原子槽），其余为**原子槽**。这样既能让用户"一键选一整套退出政策"，也能只替换其中一项（例如只换 runnerBridge）。

### 1.3 新增结构 B：预设（Preset）

#### 1.3.1 参数点（JSON Pointer）

「预设 + 参数」要能对**任意 canonical payload** 开放有限可调点，而不必为每个预设写专用映射。采用 **RFC 6901 JSON Pointer** 指向 payload 内部：

```ts
export type StrategyPresetParameterValue = number | boolean | string;

export interface StrategyPresetParameter {
  /** 稳定 code（用于审计 / 搜索空间引用；不得随 UI 文案变化） */
  readonly code: string;
  readonly label: string;
  readonly description: string;
  /** RFC 6901 JSON Pointer，指向预设 payload 内部的可调点。例："/stop/anchor/stopRatio" */
  readonly path: string;
  readonly valueType: "number" | "boolean" | "string";
  readonly unit?: string;
  /** 数值约束（服务端与前端都按此渲染 / 校验；服务端为权威） */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly allowedValues?: readonly string[];
  readonly required: boolean;
  readonly defaultValue: StrategyPresetParameterValue;
}
```

**物化语义（服务端纯函数）**：

```text
payload = deepClone(preset.payload)
for (code, value) of parameters:
    point = preset.parameters.find(p => p.code === code)   // 未知 code ⇒ 响亮失败
    assert value 满足 point 的 valueType / min / max / allowedValues
    setByJsonPointer(payload, point.path, value)
若 payload 中缺少 point.path（含中间父节点）⇒ 响亮失败（不新建路径、不猜测）
```

#### 1.3.2 原子预设

```ts
export interface StrategyPreset<TSlot extends StrategyAuthoringSlot, TPayload> {
  readonly presetId: string;          // 稳定 id，形如 "stop:SL-18.1" / "runnerBridge:NH3_5_20"
  readonly slot: TSlot;
  readonly label: string;
  readonly description: string;
  readonly status: "REGISTERED" | "EXPERIMENTAL" | "DEPRECATED";
  /** 预设自身版本（与策略版本无关，用于审计「当时用的是哪版预设」） */
  readonly version: string;
  /** 溯源：这份 payload 来自哪里（策略版本 / 研究结论 / 注册表常量） */
  readonly sourceRef: string;
  /** canonical 结构本体（类型 = §1.1 的既有类型，绝不新定义 schema） */
  readonly payload: TPayload;
  readonly parameters: readonly StrategyPresetParameter[];
}
```

**已可复用的原子预设来源（实查，均已存在）**：

| slot | 现有来源 | 说明 |
|---|---|---|
| `STOP` | `server/research/exitPolicyExperiments.ts` 的 `STOP_POLICY_EXPERIMENTS` + `getExitPolicyExperiment(id)` | 已有 `SL-18.0/18.1/18.2/19.0/20.0 …` 等命名实验；`SL-18.1` = `FIXED_PERCENT 0.06` + `PEAK_DRAWDOWN 0.03/0.08`，正是 3570001 的 stop |
| `TAKE_PROFIT` | `server/research/trailingPolicy.ts` 的 `RESEARCH_TRAILING_POLICY_KINDS` | 已有 `MA_CROSS / ATR_CHANDELIER / R_MULTIPLE / PROFIT_GIVEBACK / SWING_LOW / PARABOLIC_SAR / HYBRID` |
| `RUNNER_BRIDGE` | `server/research/exitPolicyCommon.ts` 的 `RUNNER_HOLDING_BRIDGE_STATES` + `stateFactorRegistry.ts` 的 `RUNNER_STATE_DEFINITIONS` | 已有 12 个已注册状态；3570001 = `NEW_HIGH_3 / 5 → 20` |
| `RECIPE` | `server/research/recipeRegistry.ts` 的 `resolveStrategyRecipeById(recipeId)` | 运行时可**直接投影**出 canonical `StrategyRecipe`（见 §1.3.3） |
| `TIME_EXIT` / `STRONG_HOLD` / `CAPITAL_RECYCLE` | 无现成命名注册表 | ✅ **裁定 Q2：新建预设常量表**，与原子预设同文件 `presetRegistry.ts`（纯声明；payload 仍用 §1.1 既有类型，非第二套语义） |

> ✅ **裁定 Q1**：预设注册表**集中落位**在 `server/research/strategyAuthoring/presetRegistry.ts`；`exitPolicyExperiments.ts` / `trailingPolicy.ts` / `stateFactorRegistry.ts` / `recipeRegistry.ts` **保持原样不动**。集中注册表只做三件事：**引用**既有 payload、**声明**新预设常量、**暴露**可调参数点。

#### 1.3.3 Recipe 预设的投影（唯一来源，禁止手写）

`server/research/patternLibrary/threeFactorTopNStrategy.ts#buildThreeFactorTopNStrategyDocument` 中已存在**唯一**的 recipe 投影实现：

```ts
const runtime = resolveStrategyRecipeById(recipeId);
const recipe = {
  kind: "signalEngine",
  recipeId,
  point: runtime.point,
  signalFrequency: runtime.signalFrequency,
  signalDescription: runtime.signalDescription,
  featureVersions: runtime.features
    .map(f => ({ featureId: f.featureId, version: f.version }))
    .sort((a, b) => a.featureId.localeCompare(b.featureId)),
  rankingConfig: { ...runtime.rankingConfig },
  selectionConfig: { method: { ...runtime.selectionConfig.method } },
  requiredData: [...runtime.requiredData],
};
```

🔴 **设计要求**：把这段投影**提取**为共享纯函数（建议 `server/research/recipeRegistry.ts#projectStrategyRecipe(recipeId): StrategyRecipe`），`threeFactorTopNStrategy.ts` 与新的物化端点**共用同一实现**。绝不复制第二份。

#### 1.3.4 组合预设（`EXIT_POLICY` 槽）

```ts
export interface ExitPolicyPreset {
  readonly presetId: string;               // 例："exit:sl18.1-macross5x10-time5-strong5-10-nh3-5-20"
  readonly slot: "EXIT_POLICY";
  readonly label: string;
  readonly description: string;
  readonly status: "REGISTERED" | "EXPERIMENTAL" | "DEPRECATED";
  readonly version: string;
  readonly sourceRef: string;
  /** 组合：引用原子预设 id；null = 该子槽显式关闭（canonical 的 null） */
  readonly composition: {
    readonly stop: string;
    readonly takeProfit: string | null;
    readonly timeExit: string | null;
    readonly strongHold: string | null;
    readonly capitalRecycle: string | null;
    readonly runnerBridge: string | null;
  };
  /** 组合层的可调点（path 以 policy 根为基准） */
  readonly parameters: readonly StrategyPresetParameter[];
}
```

**组合物化**：递归物化 6 个原子槽 → 组出 `ExitPolicyDefinition` → 跑 `exitPolicyDefinitionErrors` → 通过才返回。

**3570001 对应的组合预设（验收锚点）**：

```json
{
  "presetId": "exit:sl18.1-macross5x10-time5-strong5-10-nh3-5-20",
  "composition": {
    "stop": "stop:SL-18.1",
    "takeProfit": "takeProfit:MA_CROSS_5_10_ACT0",
    "timeExit": "timeExit:FIXED_5",
    "strongHold": "strongHold:DAY5_TO_10_MIN3PCT_ABOVE_MA5_MA10",
    "capitalRecycle": null,
    "runnerBridge": "runnerBridge:NH3_DECIDE5_EXTEND20"
  },
  "parameters": [
    { "code": "stop.anchor.stopRatio",   "path": "/stop/anchor/stopRatio",  "valueType": "number", "defaultValue": 0.06 },
    { "code": "stop.escalation.drawdownRatio", "path": "/stop/escalation/drawdownRatio", "valueType": "number", "defaultValue": 0.08 },
    { "code": "runner.decisionHoldingDays", "path": "/runnerBridge/decisionHoldingDays", "valueType": "number", "defaultValue": 5 },
    { "code": "runner.extendToHoldingDays", "path": "/runnerBridge/extendToHoldingDays", "valueType": "number", "defaultValue": 20 },
    { "code": "runner.state", "path": "/runnerBridge/state", "valueType": "string", "defaultValue": "NEW_HIGH_3",
      "allowedValues": ["NEW_HIGH_2", "NEW_HIGH_3", "CONSECUTIVE_HIGHER_HIGHS_GE_2", "RETURN_2_POSITIVE", "RETURN_3_POSITIVE",
                        "CLOSE_ABOVE_MA5", "CLOSE_ABOVE_MA10", "MA5_SLOPE_POSITIVE", "MA10_SLOPE_POSITIVE",
                        "NEAR_5D_HIGH", "CONSECUTIVE_LOWER_CLOSES_GE_2", "CLOSE_LOCATION_UPPER_THIRD"] }
  ]
}
```

> `allowedValues` 由服务端从 `RUNNER_HOLDING_BRIDGE_STATES` 生成，前端不得手抄（P2）。

### 1.4 新增结构 C：元数据词表（只读）

```ts
export interface StrategyAuthoringVocabulary {
  /** 内容 hash（含各注册表版本）；前端可据此缓存，变化即失效 */
  readonly vocabularyVersion: string;
  readonly slots: readonly {
    readonly slot: StrategyAuthoringSlot;
    readonly label: string;
    readonly description: string;
    readonly required: boolean;
  }[];
  /** 预设**摘要**（不含 payload，列表渲染用）；详情按需 materialize */
  readonly presets: readonly {
    readonly presetId: string;
    readonly slot: StrategyAuthoringSlot;
    readonly label: string;
    readonly description: string;
    readonly status: "REGISTERED" | "EXPERIMENTAL" | "DEPRECATED";
    readonly version: string;
    readonly sourceRef: string;
    readonly parameters: readonly StrategyPresetParameter[];
  }[];
  /** 已注册 recipe 清单（来自 recipeRegistry，不落库） */
  readonly recipes: readonly {
    readonly recipeId: string;
    readonly point: "open" | "close";
    readonly signalFrequency: string;
    readonly signalDescription?: string;
    readonly featureVersions: readonly { readonly featureId: string; readonly version: string }[];
    readonly requiredData: readonly string[];
    /** 该配方声明可调的门槛参数 code（来自 ResearchParameterSchema） */
    readonly tunableParameterCodes: readonly string[];
  }[];
  /** 已注册 runner 状态（来自 RUNNER_STATE_DEFINITIONS） */
  readonly runnerStates: readonly {
    readonly stateId: string;
    readonly version: string;
    readonly deprecated: boolean;
  }[];
  /** 生命周期八态（来自 STRATEGY_LIFECYCLE_STATUSES） */
  readonly lifecycleStatuses: readonly string[];
}
```

### 1.5 新增结构 D：空白草稿 / 物化请求 / 保存请求

```ts
/** 服务端生成空白 canonical 定义；前端绝不自行拼一份 */
export interface StrategyAuthoringBlank {
  readonly document: StrategyDocument;                 // identity 置空、dataset 未绑定、definition 为最小合法骨架
  readonly requiredSections: readonly string[];        // 必填段清单（与 P3 校验同源）
}

export interface MaterializePresetInput {
  readonly slot: StrategyAuthoringSlot;
  readonly presetId: string;
  /** code → value；未提供的 code 走 defaultValue */
  readonly parameters: Readonly<Record<string, StrategyPresetParameterValue>>;
}

export interface MaterializePresetResult {
  readonly slot: StrategyAuthoringSlot;
  readonly presetId: string;
  readonly payload: unknown;                            // canonical 结构（不透明）
  readonly resolvedParameters: Readonly<Record<string, StrategyPresetParameterValue>>;
  readonly fingerprint: string;                         // payload 内容指纹（审计 / 幂等）
  readonly issues: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}

export interface SaveAuthoringDraftInput {
  readonly document: StrategyDocument;                  // 已含 materialize 结果（逐字复制）
  readonly origin: {
    readonly kind: "BLANK_CANONICAL";
    /**
     * 仅审计用：记录本稿用过哪些预设、哪一版预设、参数取值。
     *
     * ✅ **裁定 Q5（轻量版）**：预设**版本锁定**在这里 —— 冻结 `presetId + presetVersion + parameters`。
     * 🔴 它**不进 `definition`**，因此**不影响策略指纹**：预设版本升级只改变审计记录，
     *    不会让同一份 definition 变成另一个 StrategyVersion（否则预设升版会污染版本不可变性）。
     */
    readonly presetRefs: readonly {
      readonly slot: StrategyAuthoringSlot;
      readonly presetId: string;
      /** 预设自身版本（§1.3.2 的 `version`），保存时冻结 */
      readonly presetVersion: string;
      readonly parameters: Readonly<Record<string, StrategyPresetParameterValue>>;
    }[];
  };
}
```

### 1.6 新增结构 E：Provenance 策略（裁定 ③ 的落地）

| 情形 | 是否写 `strategy_research_provenance` | 版本状态 | UI 标识 |
|---|---|---|---|
| 前端从空白构建（本设计） | **不写** | `Draft` | 醒目标识「**无证据开发草稿**」 |
| 研究候选转正（既有 `strategyCandidate.promote`） | **写**（`INDEPENDENT_EXPERIMENT` / `RESEARCH_CONCLUSION`） | 由桥决定 | 「有证据」标识 + 证据链接 |

**不新增 `sourceKind` 取值**（`drizzle/schema.ts#strategyResearchProvenance.sourceKind` 保持既有词表）。理由：草稿本就不该有 provenance 行；"缺行"本身就是"无证据"的如实表达，比新增一个枚举值更不容易被误读为"有来源"。

🔴 **不变量保持**：正式提升（`Validated` 以上）**仍然必须**走 `strategyCandidate.promote`——本文档不打开任何绕过证据的正式化通道。

### 1.7 落库影响

| 项 | 结论 |
|---|---|
| 新表 | **0** |
| 新列 | **0** |
| migration | **0** |
| 写入路径 | 复用 `StrategyService.save` / `saveVersion`（`server/research/strategyPersistence/**`） |
| 新增持久化数据 | 仅"用户创作出的 Draft `strategy_versions` 行"（业务数据，非结构变更） |

---

## 2. API 契约设计

### 2.1 命名空间与权限

- **命名空间**：`strategyDomain.authoring.*`（新增子 router，**不新增 tRPC 顶层 key**；现有顶层 key 数 21 保持不变）。
- **为何不是 `strategyDomain.strategy.*`**：`strategy.*` 是「策略本体的 CRUD / 版本 / 生命周期」，`authoring.*` 是「**创作辅助**（词表 / 物化 / 草稿门槛）」；混在一起会让"读元数据"和"写策略"的权限面模糊。
- **权限口径**（与既有 `server/strategyDomainRouter.ts` 一致）：
  - 只读 / 物化 / 预览 ⇒ `publicProcedure`（不落库、无副作用）
  - 保存草稿 ⇒ `adminProcedure`（与 `strategy.save` / `createVersion` 同口径）

### 2.2 端点清单

| # | procedure | 类型 | 权限 | 落库 | 复用/新增 |
|---|---|---|---|---|---|
| **A1** | `strategyDomain.authoring.getVocabulary` | query | public | 否 | **新增** |
| **A2** | `strategyDomain.authoring.getBlankDraft` | query | public | 否 | **新增** |
| **A3** | `strategyDomain.authoring.materializePreset` | mutation | public | 否 | **新增** |
| **A4** | `strategyDomain.authoring.previewDocument` | mutation | public | 否 | **新增**（薄封装） |
| **A5** | `strategyDomain.authoring.saveDraft` | mutation | admin | 是 | **新增**（薄封装，内部仍走 `StrategyService.save`） |
| **A6** | `diffAgainstVersion`（**纯函数，非 tRPC 端点**） | — | — | 否 | **新增**（✅ 裁定 Q3：仅测试 / dev 用，不进生产 tRPC 面） |
| — | `strategyDomain.strategy.validate` | mutation | public | 否 | 复用 |
| — | `strategyDomain.strategy.load` / `loadVersion` | query | public | 否 | 复用 |
| — | `strategyDomain.strategy.listVersionCatalog` | query | public | 否 | 复用 |
| — | `strategyDomain.strategyCandidate.promote` | mutation | admin | 是 | 复用（**正式提升唯一入口**，不在本设计内） |
| — | `datasetRegistry.listDefinitions` / `listVersions` / `getVersion` | query | public | 否 | 复用（Dataset 选择器） |
| — | `researchRun.loopRun` | mutation | admin | 是 | 复用（运行回测） |

### 2.3 逐端点定义

#### A1 · `getVocabulary`

```ts
// input: 无
// output: StrategyAuthoringVocabulary（§1.4）
```
- **语义**：返回当前服务端**已注册**的全部预设摘要、recipe 清单、runner 状态清单、槽位定义。
- **权威性**：内容全部来自既有注册表（`STOP_POLICY_EXPERIMENTS` · `RESEARCH_TRAILING_POLICY_KINDS` · `RUNNER_HOLDING_BRIDGE_STATES` · `RUNNER_STATE_DEFINITIONS` · `recipeRegistry`），**不新增语义**。
- **缓存**：`vocabularyVersion` 为内容 hash；前端可长期缓存，hash 变化即失效。
- **失败**：注册表内部不一致 ⇒ 500（响亮失败，不返回部分清单）。

#### A2 · `getBlankDraft`

```ts
input : { datasetVersionId?: number }
output: StrategyAuthoringBlank            // §1.5
```
- **语义**：服务端用 `strategySchema` 的纯函数生成**最小合法 canonical 骨架**（`definition` 存在但各段为空/待填；`strategyId` / `name` 置空；`datasetVersionId` 未绑定时不写）。
- **为什么必须是端点**：`client/**` 不得 import `server/**` 运行时值（`AGENTS.md` §6-10），骨架只能由服务端下发。
- **失败**：`datasetVersionId` 给了但不存在 / 非 READY ⇒ `AUTHORING_DATASET_NOT_READY`。

#### A3 · `materializePreset`

```ts
input : MaterializePresetInput              // { slot, presetId, parameters }
output: MaterializePresetResult             // { payload, resolvedParameters, fingerprint, issues }
```
- **语义**：按 §1.3.1 的 JSON Pointer 语义物化 canonical payload，并跑对应校验器（`exitPolicyDefinitionErrors` / `resolveStrategyRecipe` / `runnerBridgePolicyErrors` / …）。
- **幂等**：同输入 ⇒ 同 `payload` / 同 `fingerprint`（纯函数，无 `Date.now` / 随机）。
- **前端义务**：把 `payload` **逐字复制**进 `document`，不解释、不增删字段。
- **失败**（见 §2.4）：`issues` 非空时 `payload` 视为不可用。

#### A4 · `previewDocument`

```ts
input : { document: StrategyDocument }
output: {
  valid: boolean;
  issues: readonly { code: string; path: string; message: string }[];
  fingerprint: string | null;                 // 仅 valid 时给
  canonicalDefinitionPresent: boolean;        // 保存门槛的前置展示
  gaps: readonly { segment: string; label: string }[];   // 与前端逐段徽标同源
}
```
- **语义**：调用既有 `validateStrategyDocument` + `validateCanonicalStrategyDefinition`，**不新增校验规则**。
- **用途**：保存前预检 + 前端缺口锚点。**它不是闸门**（闸门仍在 A5 / `strategy.save`）。

#### A5 · `saveDraft`

```ts
input : SaveAuthoringDraftInput             // { document, origin }
output: StrategyDocument                    // 已落库、含重算后的 fingerprint
```
- **门槛**（任一不满足即拒绝，不静默修）：
  1. `document.definition` 必须存在 ⇒ 否则 `AUTHORING_DEFINITION_MISSING`
  2. `validateStrategyDocument` + `validateCanonicalStrategyDefinition` 必须通过
  3. 强制 `status = Draft`；`origin.kind` 必须为 `BLANK_CANONICAL`
  4. ✅ **裁定 Q4**：`document.strategyType` **必填**（必须属于 `STRATEGY_TYPES`）⇒ 否则 `AUTHORING_STRATEGY_TYPE_REQUIRED`
     - ⚠️ 该门槛**只作用于 `saveDraft` 这条创作路径**；既有 `strategyDomain.strategy.save` / `saveVersion` 的可空语义**保持不变**（存量 3570001 的 `strategyType=null` 不受影响、不被回填）

- **审计冻结**：`origin.presetRefs` 连同 `presetVersion` 一并写入版本的审计字段（§1.5 · 裁定 Q5），**不进 `definition` / 不影响指纹**
- **写库**：内部调用**既有** `StrategyService.save({ document })`（等价于 `strategyDomain.strategy.save`），**不新增第二条写路径、不裸写 SQL**。
- **provenance**：**不写**（§1.6）。
- **幂等**：同 `strategyId` + 同内容 ⇒ 版本不可变闸门生效（`saveVersion` 的 conflict 判定）；同 `strategyId` + 内容变了 ⇒ 明确报"请用 `createVersion`"（与既有语义一致）。
- **受限**：非 admin ⇒ tRPC `FORBIDDEN`。

#### A6 · `diffAgainstVersion`（**纯函数**，验收 / 调试用）

> ✅ **裁定 Q3**：**不注册 tRPC 端点**。落为纯函数 `server/research/strategyAuthoring/diff.ts#diffAgainstVersion`，只在 `tests/**` 与（可选）dev-only 页使用；生产策略页不引用。

```ts
// 纯函数签名（无 IO、无 DB）
diffAgainstVersion(input: {
  document: StrategyDocument;
  target: StrategyDocument;
}): {
  equal: boolean;
  differences: readonly { path: string; left: unknown; right: unknown; kind: "MISSING" | "EXTRA" | "VALUE" }[];
}
```
- **语义**：对两份文档做**字段级 diff**，用于 §0.1 DoD 的机器判定与开发期回归。
- **调用方**：测试直接构造 `target`（由 S0 golden 导出）调用；**不经过 tRPC**。
- **注意**：diff 比较 `definition` + `recipe`，身份字段（`strategyId` / `version` / `name` / `description`）走白名单忽略；不比较 `fingerprint` 本身。

### 2.4 错误码表

| code | 触发 | 前端处置 |
|---|---|---|
| `AUTHORING_PRESET_NOT_FOUND` | `presetId` 不在注册表 | 刷新词表并提示重选 |
| `AUTHORING_SLOT_MISMATCH` | 用 A 槽参数调 B 槽预设 | 提示（前端 bug / 词表过期） |
| `AUTHORING_PARAMETER_UNKNOWN` | 传了未声明的参数 code | 响亮提示，不静默忽略 |
| `AUTHORING_PARAMETER_INVALID` | 类型 / min / max / allowedValues 不符 | 字段级错误 |
| `AUTHORING_POINTER_MISSING` | JSON Pointer 指向的路径在 payload 中不存在 | 预设定义错误 ⇒ 报缺陷 |
| `AUTHORING_PAYLOAD_INVALID` | 物化后过不了对应校验器 | 显示 issues（含 path） |
| `AUTHORING_RECIPE_UNREGISTERED` | recipe 未注册 | 刷新词表 |
| `AUTHORING_RUNNER_STATE_NOT_REGISTERED` | `stateCondition.stateId` 未注册 | 刷新词表 |
| `AUTHORING_DEFINITION_MISSING` | 保存时无 canonical definition | 阻止保存 + 指出缺失段 |
| `AUTHORING_DATASET_NOT_READY` | dataset version 非 READY | 换版本 |
| `AUTHORING_DRAFT_ORIGIN_INVALID` | `origin` 非 `BLANK_CANONICAL` | 报缺陷 |
| `AUTHORING_STRATEGY_TYPE_REQUIRED` | `document.strategyType` 缺失（✅ Q4） | 段内提示「请选择策略类型」 |

### 2.5 与既有端点的分工（防重复造）

```text
创作阶段（草稿）
  getVocabulary ──┐
  getBlankDraft ──┤ 前端「策略创作工作台」
  materializePreset ┘
  previewDocument ── 预检
  saveDraft ─────── 落 Draft（复用 StrategyService.save）

运行阶段
  researchRun.loopRun ─ 既有闭环（请求已含 strategyId/strategyVersion/dateRange/datasetVersion）

正式化阶段（不在本设计）
  strategyCandidate.promote ─ 唯一入口（证据 + provenance）
```

### 2.6 契约变更登记（实现时必须做）

本设计**落地时**（不是现在）需同步：

1. `shared/researchContracts.ts` — 新增 `strategyAuthoringVocabularySchema` / `materializePresetInputSchema` 等传输 schema（`z.custom` 透传领域对象，沿用 `strategyDomainRouter.ts` 既有风格）。
2. `docs/architecture/CONTRACT-MAP.md` — 新增 `strategyDomain.authoring.*` 条目。
3. `docs/architecture/SYSTEM-BASELINE.md` + `system-manifest.yaml` — 新增 entry point ⇒ minor 跃迁。
4. `docs/architecture/CHANGE-AUDIT.md` — 本次实现记录。

---

## 3. 前端功能与交互设计

### 3.1 信息架构

**入口**：

| 入口 | 路由 | 现状 | 目标 |
|---|---|---|---|
| 策略列表「新建策略」 | `/strategies/new` | 已有按钮，但落到 legacy 模板（无 `definition`） | 落到**空白 canonical 工作台** |
| 策略详情 | `/strategies/:strategyId` | 已有编辑器 | 升级为同一工作台（编辑模式） |
| 研究候选转正 | `/candidates/:candidateId` | 已有 | 保持不变（仍是有证据路径） |
| 模式族配置 | 策略详情内 `StrategyFamilyPanel` | 已有 | 保留，作为"起点生成器"之一 |

**工作台骨架**（左右两栏：左为段导航，右为当前段编辑 + 校验）：

```text
┌── 顶部：身份条 ────────────────────────────────────────────────┐
│ strategyId | version | name | strategyType* | DatasetVersion(#id) | Draft │
│ [无证据开发草稿] 徽标 · [校验] [保存草稿] [运行回测]            │
└────────────────────────────────────────────────────────────────┘
┌── 左：段导航（带缺口徽标）──┐ ┌── 右：当前段 ──────────────────┐
│ ① 身份与坐标        齐      │ │  该段字段表单                   │
│ ② 买什么            齐      │ │  + 段级校验提示                 │
│ ③ 什么条件买        可选    │ │                                │
│ ④ 什么时候买        还差 1  │ │                                │
│ ⑤ 信号配方 ★        未选    │ │                                │
│ ⑥ 怎么卖 ★          未选    │ │                                │
│ ⑦ 买多少·最多持几只  齐      │ │                                │
│ ⑧ 成本与资金        齐      │ │                                │
│ ⑨ 参数搜索空间      可选    │ │                                │
└────────────────────────────┘ └────────────────────────────────┘
```

> 段顺序与既有 `DEFINITION_SEGMENTS`（`client/src/components/strategy/definitionDraft.ts`）**同源**，只在其中插入 ⑤ 信号配方、把 ⑥ 怎么卖升级为可编辑 ExitPolicy；**不重排既有段**（`tests/client/src/components/strategy/definitionDraft.test.ts` 已有顺序断言）。

### 3.2 角色 / 权限态

| 角色 | 可见 | 可编辑 | 可保存 |
|---|---|---|---|
| 匿名 / 普通（`publicProcedure`） | 词表、空白草稿、物化预览、校验 | 可编辑本地草稿 | ❌ 保存按钮 disabled + 「需要管理员权限」提示 |
| admin（`adminProcedure`） | 全部 | 全部 | ✅ |

🔴 **不得**用 disabled 按钮的 `title` 藏住"为什么不能保存"——权限态必须在页面上直接写明（仓库既有约定，见 `StrategyCandidateDetail.tsx` 的转正资格区）。

### 3.3 主流程（含失败路径）

```text
[新建] → getBlankDraft → 本地草稿
   │
   ├─ 选 Dataset Version（datasetRegistry.listVersions）
   │     └─ 非 READY ⇒ 置灰 + 原因
   │
   ├─ ⑤ 信号配方：选 Recipe 预设
   │     └─ materializePreset(slot=RECIPE)
   │           ├─ issues 非空 ⇒ 段内红字 + 不允许保存
   │           └─ ok ⇒ 把 payload 写进 document.recipe
   │
   ├─ ⑥ 怎么卖：选 ExitPolicy 组合预设 + 调参数
   │     ├─ 改参数 ⇒ 重新 materializePreset(slot=EXIT_POLICY)
   │     ├─ 展开"高级"⇒ 可单独替换 6 个原子槽（每个也是一次 materialize）
   │     └─ ok ⇒ 把 payload 写进 definition.exit.rules[0].policy
   │
   ├─ 保存：previewDocument
   │     ├─ invalid ⇒ 段徽标 + 缺口清单（锚点跳段），不提交
   │     └─ valid ⇒ saveDraft
   │           ├─ 成功 ⇒ 显示 fingerprint，跳 /strategies/:id?version=…
   │           └─ AUTHORING_DEFINITION_MISSING ⇒ 明确指出缺哪段
   │
   └─ 运行：researchRun.loopRun（既有）
```

### 3.4 「预设 + 参数」交互规范（本次核心）

**单选预设**：

```text
┌ 退出政策 ──────────────────────────────────────────────┐
│ 预设  [SL-18.1 + MA5×MA10 + 5日 + 强持 + NH3 5→20  ▼]  │
│       来源：策略 1.62.1 / exitPolicyExperiments SL-18.1 │
│       状态：REGISTERED                                  │
├ 参数 ──────────────────────────────────────────────────┤
│ 初始止损        [0.06  ] (0.01–0.20)                    │
│ 回撤止盈升级    [0.08  ] (0.01–0.30)                    │
│ Runner 状态     [NEW_HIGH_3 ▼]                          │
│ 判定持有日      [5     ]                                │
│ 延长至持有日    [20    ]                                │
├────────────────────────────────────────────────────────┤
│ [重置为预设默认]  [查看生成的 policy JSON（只读）]      │
└────────────────────────────────────────────────────────┘
```

**规则**：

| # | 规则 |
|---|---|
| R1 | 预设下拉的选项**全部来自 A1 词表**；前端不硬编码任何 presetId |
| R2 | 参数控件由 `StrategyPresetParameter[]` **动态生成**（`valueType` 决定控件，`allowedValues` 决定下拉，`min/max/step` 决定数值约束） |
| R3 | 参数变更 ⇒ **防抖调用 `materializePreset`**（≥300ms）；结果显示为该段的"预览指纹 + 只读 JSON" |
| R4 | **"高级模式"才允许逐原子槽替换**；默认视图只给组合预设 + 参数（降低误配概率，符合裁定 ②） |
| R5 | 若用户手改过参数后切预设 ⇒ 弹确认（避免静默丢改动） |
| R6 | `status=DEPRECATED` 的预设可选但显示警示（不隐藏，避免"历史版本打开变成未选"） |
| R7 | 预设不可用时（`issues` 非空）显示 issues 的 `path` + `message`，并**禁止**进入下一步 |

### 3.5 校验与反馈分层

| 层 | 时机 | 来源 | 行为 |
|---|---|---|---|
| L1 段内即时 | 输入时 | 前端草稿类型判断（仅"填没填 / 是不是数"） | 字段红框；**不判定业务口径** |
| L2 物化校验 | 参数变更防抖后 | A3 的 `issues` | 段内红字 + 阻止保存 |
| L3 保存前预检 | 点保存 | A4 `previewDocument` | 缺口清单 + 锚点跳段 |
| L4 权威闸门 | 提交 | A5 内部 `validateStrategyDocument` | 服务端 issue 原样展示 |

🔴 **L1 不得复制 L2/L3/L4 的业务规则**（例如"run 状态必须已注册""recipe 必须已注册"）——只能来自服务端。

### 3.6 组件规划（复用优先）

| 区块 | 复用现有 | 新增 | 说明 |
|---|---|---|---|
| 身份与坐标 | `client/src/components/strategy/StrategyBasicInfo.tsx` | — | Dataset 选择器已在（`datasetRegistry.listVersions`） |
| ②③④⑦⑧⑨ 各段表单 | `client/src/components/strategy/DefinitionFields.tsx` + `definitionDraft.ts` | 空态支持（新建时 `definitionDraft` 目前对缺 `definition` 返回 `raw`） | 需给"空白 canonical"补 `structured` 分支 |
| ⑤ 信号配方 | — | `RecipePresetEditor.tsx` | 预设下拉 + 参数表单 + 只读 JSON |
| ⑥ 退出政策 | — | `ExitPolicyPresetEditor.tsx`（内含 `RunnerBridgeEditor`） | 组合预设 + 参数 + 高级原子槽 |
| 段导航 | `StrategyDetail.tsx` 的分段 UI | — | 复用它现有的段徽标/缺口锚点机制 |
| 溯源 / 草稿标识 | `client/src/components/common/ProvenanceLink.tsx` | `DraftEvidenceBadge.tsx` | 「无证据开发草稿」 |
| 验收 diff（开发用） | — | `DefinitionDiffPanel.tsx`（可选） | 直调**纯函数** `diffAgainstVersion`（Q3：不经 tRPC），只在 dev/测试页暴露 |

**共享层约束**：预设/参数的**运行时值**必须在服务端；前端只持有 `presetId + parameters + payload(不透明)`。类型可从 `shared/researchContracts.ts` 以 `import type` 引用（`client/**` 禁 import 服务端运行时值）。

### 3.7 状态管理

```ts
interface AuthoringScreenState {
  vocabulary: StrategyAuthoringVocabulary | null;   // A1，缓存
  blank: StrategyAuthoringBlank | null;             // A2
  document: StrategyDocument;                       // 唯一编辑对象（P1）
  slots: {
    recipe: { presetId: string; parameters: Record<string, StrategyPresetParameterValue> } | null;
    exitPolicy: { presetId: string; parameters: Record<string, ...> } | null;
  };
  materialized: { recipe?: MaterializePresetResult; exitPolicy?: MaterializePresetResult };
  dirty: boolean;
  preview: PreviewDocumentResult | null;
}
```

- **单一事实**：`document` 是唯一可提交对象；`slots` 只是"怎么产生 payload"的记录（供 `origin.presetRefs` 审计）。
- **不缓存 payload 到 localStorage**（避免"打开旧草稿用的是过期预设"）。

### 3.8 结构锁与测试（前端侧）

| 项 | 测试 |
|---|---|
| 段顺序 / 段集合 | 扩展既有 `tests/client/src/components/strategy/definitionDraft.test.ts` |
| 词表不漂移 | 新增 `tests/client/src/components/strategy/authoringVocabulary.test.ts`：前端**不含**任何 presetId / runner state 字面量（只允许来自 A1） |
| 起草幂等 | 「打开 → 不改 → 保存」必须不产新版本（沿用既有"往返幂等"约定） |
| 权限态 | 非 admin 时保存按钮 disabled 且**页面有可见原因**（无头 DOM 断言文案） |
| 预设→payload | 预设物化后与 3570001 的 `policy` / `recipe` **逐字段相等** |
| 端到端 | 纯前端构建 → `diffAgainstVersion` 返回 `equal: true` |

---

## 4. 代码开发计划（最后一步，本文档不执行）

> 前置：✅ §6 六项已裁定（2026-10-03）。开发顺序 = 后端只读层 → 后端物化层 → 前端组件 → 工作台接线 → 端到端验收。
> 每期都必须满足 `AGENTS.md` §9 DoD：`pnpm run check` 0 错 · 受影响测试通过 · EOL drift 0。

### 4.1 分期总览

| 期 | 目标 | 依赖 | 预估 | 产出可判定结果 |
|---|---|---|---|---|
| **S0** | 基线冻结 | 本文档评审通过 | 0.5d | 3570001 的 `definition` + `recipe` 固化为测试 golden |
| **S1** | 后端词表与预设注册表（只读） | S0 | 2d | `getVocabulary` 返回 SL-18.1 等预设 + recipe 清单 |
| **S2** | 后端物化（`materializePreset` / `getBlankDraft` / `previewDocument`） | S1 | 2–3d | 物化 `exit:...nh3-5-20` 得到与 3570001 逐字段相等的 policy |
| **S3** | 保存门槛（`saveDraft`） | S2 | 1d | 无 `definition` 的文档被响亮拒绝 |
| **S4** | 前端预设编辑器组件 | S2 | 3d | `RecipePresetEditor` / `ExitPolicyPresetEditor` 可物化并回填 |
| **S5** | 工作台接线（新建走 canonical） | S4 | 2–3d | `/strategies/new` 产出含 `definition` 的 Draft |
| **S6** | 端到端验收 | S3+S5 | 1–2d | `diffAgainstVersion`（纯函数）⇒ `equal: true` |
| **S7**（可选） | 专项页收敛 | S6 已完成；**R6 已修**（2026-10-03，见 §5.1） | 3–5d | 评估/模拟盘按 strategyVersionId 参数化 |

**关键路径**：S0 → S1 → S2 → S3 → S4 → S5 → S6（约 11–14 个工作日）。

### 4.2 各期文件清单（写集）

#### S0 · 基线冻结

| 动作 | 文件 |
|---|---|
| 新增测试 golden（只读探针导出，不含业务逻辑） | `tests/server/research/strategyAuthoring/golden3570001.ts` |
| 新增回归测试 | `tests/server/research/strategyAuthoring/golden3570001.test.ts` |

#### S1 · 后端词表与预设注册表

| 动作 | 文件 | 说明 |
|---|---|---|
| 新增预设注册表（纯声明 + 纯函数） | `server/research/strategyAuthoring/presetRegistry.ts` | 原子预设 + 组合预设；**复用** `exitPolicyExperiments` / `trailingPolicy` / `stateFactorRegistry` |
| 新增 JSON Pointer 工具 | `server/research/strategyAuthoring/jsonPointer.ts` | `getByPointer` / `setByPointer`；路径缺失 ⇒ 抛错 |
| 新增词表组装 | `server/research/strategyAuthoring/vocabulary.ts` | 汇总预设摘要 / recipe / runner 状态 / 生命周期 |
| **提取** recipe 投影为共享纯函数 | `server/research/recipeRegistry.ts#projectStrategyRecipe` | 消除 `threeFactorTopNStrategy.ts` 内联复制（唯一实现） |
| 新增 tRPC 子 router | `server/research/strategyAuthoring/router.ts` + `server/strategyDomainRouter.ts` 挂载 | 只读端点 |
| 传输 schema | `shared/researchContracts.ts` | `strategyAuthoringVocabularySchema` 等 |

#### S2 · 物化

| 动作 | 文件 |
|---|---|
| 物化纯函数（组合 + 原子） | `server/research/strategyAuthoring/materialize.ts` |
| 空白 canonical 骨架 | `server/research/strategyAuthoring/blankDraft.ts`（复用 `strategySchema` 纯函数） |
| 端点 | `server/research/strategyAuthoring/router.ts` |
| 测试 | `tests/server/research/strategyAuthoring/materialize.test.ts` · `blankDraft.test.ts` |

#### S3 · 保存门槛

| 动作 | 文件 |
|---|---|
| `saveDraft`（薄封装 `StrategyService.save`） | `server/research/strategyAuthoring/router.ts` |
| 测试 | `tests/server/research/strategyAuthoring/saveDraft.test.ts`（含无 definition 拒绝、非 admin 拒绝） |

#### S4–S5 · 前端

| 动作 | 文件 |
|---|---|
| 预设编辑器 | `client/src/components/strategy/RecipePresetEditor.tsx` · `ExitPolicyPresetEditor.tsx` |
| 空白定义支持 | `client/src/components/strategy/definitionDraft.ts`（补 `structured` 空态分支） |
| 工作台页面改造 | `client/src/pages/StrategyDetail.tsx` |
| 草稿徽标 | `client/src/components/strategy/DraftEvidenceBadge.tsx` |
| 词表 hook | `client/src/lib/useAuthoringVocabulary.ts`（复用 tRPC 缓存） |
| 测试 | `tests/client/src/components/strategy/*` · `tests/client/src/pages/pageFlowContracts.test.ts` |

#### S6 · 验收

| 动作 | 文件 |
|---|---|
| `diffAgainstVersion`（纯函数，非端点 · Q3） | `server/research/strategyAuthoring/diff.ts` |
| 端到端测试（纯函数级 + 真实 DB 只读） | `tests/server/research/strategyAuthoring/equivalence3570001.test.ts` |

### 4.3 测试计划

| 层 | 覆盖 |
|---|---|
| 纯函数单测 | JSON Pointer 边界（数组下标 / 缺失路径 / 类型不符）；组合预设递归物化；参数默认值回填 |
| 契约测试 | 词表 ↔ 注册表逐项对表（防"注册了但词表没出"）；`RUNNER_HOLDING_BRIDGE_STATES` ↔ 词表 `allowedValues` |
| 物化等价测试 | `materializePreset(exit:…)` 的 payload 与 `strategy_versions#3570001` 的 `definition.exit.rules[0].policy` 深度相等 |
| 权限测试 | 非 admin 保存 ⇒ `FORBIDDEN`；只读端点对匿名开放 |
| 前端结构锁 | 段顺序不变；前端源码不含 presetId 字面量；非 admin 页面有可见原因 |
| 端到端 | 空白 → 物化 → 保存 → `diffAgainstVersion(3570001)` ⇒ `equal: true` |

### 4.4 验收清单（对齐 §0.1 DoD）

- [ ] 全新会话仅 UI 可产出含 canonical `definition` + `recipe` 的 Draft
- [ ] 该 Draft 与 `3570001` 的 `definition` + `recipe` 逐字段相等（`diffAgainstVersion` ⇒ `equal: true`）
- [ ] `strategyType` 已选择（Q4 门槛生效）；`origin.presetRefs` 已冻结 `presetVersion`（Q5）
- [ ] `fingerprint` 由服务端重算（前端不得提供）
- [ ] 无 `definition` 的 legacy 文档被 `saveDraft` 响亮拒绝
- [ ] 非 admin 无法保存；页面可见原因
- [ ] `pnpm run check` 0 错；受影响测试全绿；`node scripts/checkEolDrift.mjs --strict` = 0
- [ ] `CONTRACT-MAP` / `SYSTEM-BASELINE` / `system-manifest` / `CHANGE-AUDIT` 按 §2.6 同步

---

## 5. 风险与非目标

### 5.1 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 预设注册表变成"第二套策略语义" | 预设 payload **必须**引用 §1.1 既有类型；物化后**必须**跑既有校验器；对表测试 |
| R2 | 前端复制 payload 时被误改 | 前端把 payload 当**不透明对象**；保存时服务端重新校验；`diffAgainstVersion` 纯函数兜底 |
| R3 | 词表与注册表漂移 | A1 的 `vocabularyVersion` 内容 hash + 对表测试 |
| R4 | 预设粒度太细导致用户配出不稳健组合 | 默认只给组合预设 + 少量参数（裁定 ②）；高级模式才开原子槽 |
| R5 | 与并发会话的 `client/src/pages/StrategyDetail.tsx` 改动冲突 | S5 开工前重跑 `git status --porcelain`；仅在工作区干净时开写 |
| R6 | 前向推进存在账户续跑缺陷（`server/paperTrading3fTop3Runner/forward.ts#advanceForwardOnce` 的 `buildIncrement` 只跑新窗口 ⇒ 组合从 100k 平仓起步，`mergeForwardDays` 又把账户覆盖成该次独立回测末日值） | ✅ **已修**（2026-10-03）：`buildIncrement` 改为**从基线起点重放整段**再切增量（`resolveForwardRunWindow` + `partitionForwardIncrement`）；`PaperForwardState` 增 `baselineStartDate`，老载荷回落到 `PAPER_FORWARD_3570001_DEFAULT_BASELINE_START`。证据：`forward.test.ts` **10/10**（含 4 条 R6 回归）；既有持久化状态（6090001）只读复核仍为 `WAITING_FOR_NEW_DATA` / equity **199,036.53** 不变 |

### 5.2 非目标（重申）

- ❌ 不改 schema / 不加表 / 不加 migration
- ❌ 不新增引擎
- ❌ 不打开绕过证据的正式化通道（`strategyCandidate.promote` 仍是唯一入口）
- ❌ 不重排既有段顺序、不删 legacy 兼容视图

---

## 6. 裁定结果（六项 · DECIDED · 2026-10-03）

> 裁定人：用户。**六项全部按设计建议通过** ⇒ 设计冻结，可进入 §4 的 S0。
> 计数说明：Q1–Q5 为开放问题，**R6** 为上一轮识别的前置缺陷；合计六项。

| # | 事项 | 裁定 | 落点（本文件） |
|---|---|---|---|
| **Q1** | 预设注册表物理位置 | ✅ **新建集中注册表** `server/research/strategyAuthoring/presetRegistry.ts`；`exitPolicyExperiments.ts` / `trailingPolicy.ts` / `stateFactorRegistry.ts` / `recipeRegistry.ts` 保持原样；集中表只做「引用 payload + 声明新预设 + 暴露参数点」 | §1.3.2 · §4.2 S1 |
| **Q2** | `TIME_EXIT` / `STRONG_HOLD` / `CAPITAL_RECYCLE` 无命名注册表 | ✅ **新建预设常量表**（与原子预设同文件）；payload 仍用 §1.1 既有类型 | §1.3.2 · §4.2 S1 |
| **Q3** | `diffAgainstVersion` 是否进生产 tRPC 面 | ✅ **不进**。落为纯函数 `server/research/strategyAuthoring/diff.ts`，仅 `tests/**` 与（可选）dev-only 页使用 | §2.2 A6 · §2.3 A6 · §4.2 S6 |
| **Q4** | `strategyType` 是否必填 | ✅ **`saveDraft` 路径必填**（须属 `STRATEGY_TYPES`，否则 `AUTHORING_STRATEGY_TYPE_REQUIRED`）；既有 `strategy.save` / `saveVersion` 可空语义**不变**，存量 3570001 的 `null` **不回填** | §2.3 A5 · §2.4 错误码 |
| **Q5** | 预设是否版本锁定 | ✅ **轻量冻结**：`presetId + presetVersion + parameters` 冻结进 `origin.presetRefs` 审计字段；**不进 `definition`、不影响策略指纹** | §1.5 · §2.3 A5 |
| **R6** | 前向推进账户续跑缺陷 | ✅ **已修**（2026-10-03，见 §5.1 R6） | §5.1 R6 · §4.1 S7 依赖 |

### 6.1 裁定后的连锁确认（无需再决策，仅登记）

1. **S1 的写集** 因 Q1/Q2 确定为「新建集中注册表 + 三张新常量表」，不再需要改动既有注册表文件 ⇒ 降低与并发会话的冲突面。
2. **S6 的验收工具** 因 Q3 变成纯函数，测试可直接 import，**不需要起 tRPC 服务** ⇒ 验收更快、更稳。
3. **Q4 的门槛** 只在创作路径生效 ⇒ 不触发 `SYSTEM-BASELINE` 中「既有 save 语义变化」的告警（无 drift）。
4. **Q5 的冻结位置** 在审计字段而非 `definition` ⇒ S0 golden 与 S6 等价判定**只比 `definition` + `recipe`**，与预设版本解耦。

---

## 7. 附：3570001 验收锚点（golden 摘要）

以下为真实库只读探针结果（`strategy_versions#3570001`），作为 S0 golden 与 S6 等价的判定依据：

| 字段 | 值 |
|---|---|
| `strategyId@version` | `first-limit-pullback-3f-top3-runner-hold20@1.0.0` |
| `datasetVersionId` / label | `750001` / `v7` |
| `definition.entry.event` | `{ "type": "FIRST_LIMIT_UP", "params": { "limitUpRatio": 0.1 } }` |
| `definition.entry.observationWindow` | `{ "start": 5, "end": 15, "unit": "TRADING_DAY" }` |
| `definition.entry.trigger` | `{ "type": "FIRST_VALID_DAY" }` |
| `definition.entry.conditions` | `[]` |
| `definition.exit.rules[0]` | `{ "id": "exit-unified-policy", "type": "STOP_LOSS", "trigger": "ON_CLOSE", "policy": {...}, "priority": 0, "enabled": true }` |
| `policy.stop` | `{ "anchor": { "kind": "FIXED_PERCENT", "stopRatio": 0.06 }, "confirmation": "INTRADAY", "escalation": { "kind": "PEAK_DRAWDOWN", "activationRatio": 0.03, "drawdownRatio": 0.08 } }` |
| `policy.takeProfit` | `{ "kind": "MA_CROSS", "fastWindow": 5, "slowWindow": 10, "activationRatio": 0 }` |
| `policy.timeExit` | `{ "kind": "FIXED_HOLDING_DAYS", "holdingDays": 5 }` |
| `policy.strongHold` | `{ "atHoldingDays": 5, "minReturnRatio": 0.03, "requireAboveMa5": true, "requireAboveMa10": true, "extendToHoldingDays": 10, "afterExtendedHold": "TIME_EXIT" }` |
| `policy.capitalRecycle` | `null` |
| `policy.runnerBridge` | `{ "kind": "PIT_RUNNER_HOLDING_BRIDGE", "state": "NEW_HIGH_3", "decisionHoldingDays": 5, "extendToHoldingDays": 20 }` |
| `definition.position` | `{ "sizingMethod": "FIXED_RATIO", "positionRatio": 0.2, "maxPositions": 5, "maxSinglePosition": 0.3, "maxExposure": 0.8 }` |
| `definition.risk` | `{ "stopLoss": 0.08, "maxDrawdown": 0.25, "maxExposure": 0.8 }` |
| `definition.execution` | `{ "signalTiming": "T_CLOSE", "executionTiming": "T_PLUS_1_OPEN", "priceType": "OPEN", "quantityMethod": "TARGET_WEIGHT", "lotSize": 100, "commissionModel": "BPS", "slippageModel": "BPS", "executionConstraints": ["一字板（开盘即涨停）不成交", "停牌顺延至下一交易日"] }` |
| `definition.parameters` | `[]` |
| `definition.datasets` | `[{ "role": "PRIMARY", "datasetId": "first_limit_pullback", "datasetVersion": "v7", "datasetVersionId": 750001 }]` |
| `document.recipe` | `{ "kind": "signalEngine", "recipeId": "first-limit-pullback-3f-top3", "point": "close", "signalFrequency": "daily", "featureVersions": [...], "rankingConfig": { "higherIsBetter": ... }, "selectionConfig": { "method": { "kind": "topN", "n": 3 } }, "requiredData": ["OHLCV"] }` |
| `document.executionAssumptions` | `{ "backtestConfig": { "initialCapital": 1000000, "maxPositions": 5 }, "costModel": { ... 20.2bp 口径 ... }, "executionModel": "NEXT_OPEN" }` |
| `fingerprint` | `58e16bbd827349e802a2789a469fa9c195d4a23e2b2cbae3f643231a5b1b2199` |

> ⚠️ `document.recipe` 的 `point` / `signalFrequency` / `rankingConfig.higherIsBetter` 等具体值以实测为准；S0 golden 由只读探针导出，**不得手抄**。

---

## 8. 本文档的效力

- **状态 = DESIGN**：不改变任何代码、契约、DB、Baseline。
- **不改基线**：`SYSTEM-BASELINE.md` / `system-manifest.yaml` / `CONTRACT-MAP.md` 在**实现落地时**才更新（见 §2.6）。
- **引用即生效**：后续开发若与本设计冲突，以本文档评审通过后的版本为准，并在此登记变更。

---

## 9. 实现进度（IMPLEMENTATION STATUS）

> 本节由实现方维护；**代码是权威**，本节只登记「已落地 / 与设计的偏差 / 证据」。

### 9.1 已完成

| 期 | 状态 | 交付物 | 证据 |
|---|---|---|---|
| **S0** 基线冻结 | ✅ DONE | `server/research/strategyAuthoring/diff.ts`（纯函数）· `tests/server/research/strategyAuthoring/golden3570001.ts`（真实库只读导出，非手抄） | `golden3570001.test.ts`(7) + `diff.test.ts`(8) 全绿 |
| **S1** 词表与预设注册表 | ✅ DONE | `presetRegistry.ts` · `jsonPointer.ts` · `vocabulary.ts` · `recipeRegistry.ts#projectStrategyRecipe`（投影收敛为唯一实现） | `vocabulary.test.ts`(8) + `jsonPointer.test.ts`(10) 全绿；`recipeRegistryParameters` + patternLibrary + runWorkbenchAssembly **326/326** |
| **S2** 物化与空白草稿 | ✅ DONE | `materialize.ts` · `blankDraft.ts` · `datasetBinding.ts` · `router.ts`（`strategyDomain.authoring.*`） | `materialize.test.ts`(15) + `blankDraft.test.ts`(5) + `router.test.ts`(8) 全绿 |
| **S3** 保存门槛 | ✅ DONE | `router.ts#saveDraft`（复用 `StrategyService.save`，无第二条写路径） | router 测试覆盖两条**写库前**分支：非 admin ⇒ FORBIDDEN；无 definition ⇒ `AUTHORING_DEFINITION_MISSING` |
| **S4** 前端预设编辑器 | ✅ DONE | `client/src/components/strategy/PresetEditor.tsx`（通用槽位编辑器 + 参数控件 + issues + 只读 JSON） | `pnpm run check` 0 错；`tests/client/src/components/strategy` **115/115**（含 `definitionDraft` 46 + `pageFlowContracts` 40） |
| **S5** 工作台接线 | ✅ DONE | `StrategyDetail.tsx`：新建走 `authoring.getBlankDraft` → 结构化定义模式；RECIPE / EXIT_POLICY 预设接入并写进文档；`saveDraft` 承接新建保存。`StrategyBasicInfo.tsx` 增加 `strategyType` 选择器（Q4） | 同上 |
| **S6** 等价验收（纯函数级） | ✅ DONE | `diffAgainstVersion` 纯函数 + 3570001 golden + `equivalence3570001.test.ts` | 预设覆盖路径（`/recipe`、`/definition/exit`）**零差异**；整份文档 `equal: true`；`previewDocument` ⇒ `valid:true` + 真实 fingerprint |
| **S7** 专项页收敛 | ✅ DONE | 后端：`server/closedLoopBacktestRun/{rawPayload,strategyVersionArtifacts}.ts` 增**按坐标直读** + 通用端点 `researchRun.getStrategyVersionEvaluation` / `getStrategyVersionPaperTrading`；两个专项端点**收敛为薄封装**。前端：`StrategyVersionArtifactsTabs.tsx` + 策略详情新增「最终评估 / 模拟盘」两个 Tab；两个专项页也改用通用端点 | 真实库只读比对：通用端点与专项端点 `promoted/baseline runId`、`evaluationDetail`（129.6860%）、407 日 / equity 199,036.53 / forward WAITING_FOR_NEW_DATA **逐字段一致**；缺坐标 ⇒ `null`（不伪造）；浏览器实测两个 Tab 均渲染（网络 200、无 console 错误）；`strategyVersionArtifacts.test.ts` 7/7 |
| **S6** 真实保存（写库） | ✅ DONE（自清理） | `scripts/verifyStrategyAuthoringE2E.mts`（`pnpm strategy:verify-authoring`）：`saveDraft` → `loadVersion` **读回真实落库文档** → `diffAgainstVersion` vs golden → `delete` 清理 | `equal=true / differences=0 / comparedPaths=67`；清理后实查 `strategies`/`strategy_versions` 各 **0 行**，`3570001` 完好 |

**核心断言（DoD 的机器判定）**：预设法（`exitBase:SL-18.1` + `runnerBridge:NH3_DECIDE5_EXTEND20`）**能复现 3570001 的退出政策**，且 RECIPE 预设**能复现其 recipe** —— 即"选预设 + 调参数"确实能产出该策略，而不是近似。

### 9.2 与设计文档的偏差（实现方如实登记）

| # | 设计原文 | 实现 | 原因 |
|---|---|---|---|
| D-1 | §1.2 槽位 8 个（无 `EXIT_BASE`） | 增加 `EXIT_BASE`（`advancedOnly: true`） | 实查发现 `STOP_POLICY_EXPERIMENTS` 的条目是**完整 `ExitPolicyDefinition`**（含 stop/takeProfit/timeExit/strongHold/capitalRecycle），不是"只有 stop 段"。把它建模为"完整基座 + runnerBridge 增量"才与既有注册表一致；`EXIT_POLICY` 组合预设引用基座 + runnerBridge |
| D-2 | §1.4 `vocabulary.slots` | 改名 `presetSlots` | 避免与前端既有的 `DEFINITION_SEGMENTS`（7 个定义段）混淆 —— 两者是不同轴 |
| D-3 | §1.5 `StrategyAuthoringBlank.document: StrategyDocument` | 改为 `{ parts, requiredSections, notes }` | 一份"完全空"的定义**必然**过不了 `validateCanonicalStrategyDefinition`（必填项存在）。返回"结构齐全、取值待填"的零件更诚实；闸门交给 A4/A5 |
| D-4 | §2.3 A5「强制 `status = Draft`」 | **新建 ⇒ Draft；既有 ⇒ 不改状态** | 强制 Draft 会把既有 `Validated/Paper` 降级 —— 那是危险的状态回退，不是本设计的目的 |
| D-5 | §2.3 A4 输出含 `gaps: {segment,label}[]` | 只返回 `issues[{code,path,message}]` | 段映射（path → 段）是纯前端关注点（`definitionGapAnchors` 已在客户端）；服务端再算一份 = 第二套口径 |
| D-6 | §1.3.4 组合预设 `composition` 六槽 | `{ base, runnerBridge, overrides? }` | 同 D-1；同时保留"高级模式只换 strongHold"的能力（`overrides`） |
| D-7 | §3.6 两个编辑器组件（`RecipePresetEditor` / `ExitPolicyPresetEditor`） | **一个通用 `PresetEditor`**，按 slot 复用 | 两者只差预设清单与标题 ⇒ 两份近重复组件没有价值；槽位差异由词表驱动 |
| D-8 | §2.3 A6 diff 忽略身份字段 | 额外**默认忽略 `description` / `note`** 两类审计文案 | 语义相同的两份定义，其来源不同（创作 vs 候选转正），文案不可能逐字一致；判据取语义字段。可传 `ignoreFieldNames: []` 关闭 |

### 9.3 未完成（如实登记，均为**验证便利性**而非能力缺失）

| 项 | 状态 | 说明 |
|---|---|---|
| 浏览器里跑通「填齐自由段 → 点保存 → 成功落库」的完整点击流 | ⏳ 未做 | 自由段（事件 / 窗口 / 触发 / 仓位 / 风控 / 成本）分散在**折叠面板**里，逐字段 DOM 输入成本高。**已证明的等价事实**：① 浏览器里选中 RECIPE + EXIT_POLICY 后，点「保存」发出的 `saveDraft` 请求体已包含正确的 `recipe` 与 `definition.exit.rules[0].policy`；② 同一 tRPC 写入口能把该文档**真实落库**并读回与 3570001 `equal:true`（`pnpm strategy:verify-authoring`）；③ 自由段的草稿↔定义往返由既有 `definitionDraft.test.ts`（46 例）覆盖 |

### 9.4 验证快照（2026-10-03）

| 检查 | 结果 |
|---|---|
| `pnpm run check` | **0 错** |
| `tests/server/research/strategyAuthoring` | **66 / 66 passed**（8 文件，含 S6 等价验收） |
| `tests/client/src/components/strategy` + `pageFlowContracts` | **115 / 115 passed**（7 文件） |
| 定向回归（recipeRegistry · patternLibrary · strategySchema · runWorkbenchAssembly · strategyCandidate） | **326 / 326 passed**（20 文件） |
| `pnpm run test:changed` | 8 失败文件 / 19 用例 —— **全部为既有失败集**（7 个环境依赖 + `threeFactorTopNStrategyDocument` 的 `recoveryPath` 差异，均早于本次改动并被文档登记）⇒ 零新增失败文件 |
| `node scripts/checkEolDrift.mjs --strict` | **0** |
| `tests/server/closedLoopBacktestRun`（含 S7 选择器 7 例） | **52 / 52 passed**（9 文件） |
| S7 通用端点 vs 专项端点（真实库只读） | `promoted/baseline runId` · `evaluationDetail`（Full **129.6860%**）· 407 日 · equity **199,036.53** · forward **WAITING_FOR_NEW_DATA** **逐字段一致**；缺坐标 ⇒ `null`（不伪造） |
| S7 浏览器实测（headless Edge + CDP） | 策略详情 6 个 Tab 渲染；「最终评估」网络 200、面板含 129.686% 与 1.62.1 对照；「模拟盘」渲染 `#3570001 / NEW_HIGH_3 5→20 / #750001`；无 console 错误 |

**浏览器实测（真实 headless Edge + CDP，只读）**：

| 检查 | 结果 |
|---|---|
| `/strategies/new` 渲染 | `legacyNoticeShown=false`（**不再是 legacy 模式**）· 定义编辑器 / RECIPE / EXIT_POLICY 三块均在 |
| 下拉内容 | RECIPE **12** 项（含 `first-limit-pullback-3f-top3`）· EXIT_POLICY **7** 项（含 `SL-18.1 + NEW_HIGH_3 5 → 20`）· `strategyType` **9** 项 |
| 选 EXIT_POLICY 预设 | 真实 tRPC `materializePreset` 调用 → 响应 `issues: []`、`payload.runnerBridge = {NEW_HIGH_3, 5, 20}`；DOM 展示完整 policy |
| 选 RECIPE + EXIT_POLICY（300ms / 2500ms 两种节奏） | 点「保存」发出的 `saveDraft` 请求体中：`recipe.recipeId=first-limit-pullback-3f-top3`、`definition.exit.rules[0].policy.runnerBridge.state=NEW_HIGH_3`、`origin.kind=BLANK_CANONICAL`、`presetRefs=[RECIPE, EXIT_POLICY]`（含 `presetVersion`） |
| `/strategies` 列表页 | 正常渲染（无回归） |

> ⚠️ 未做（如实登记）：**完整的"填齐自由段 → 点保存 → 成功落库"** 未在浏览器里跑通 —— 自由段（事件 / 窗口 / 触发 / 仓位 / 风控 / 成本）分散在折叠面板里，逐字段 DOM 输入成本高。但"UI 组出的文档能否落库并与 3570001 等价"已由 `_verify_authoring_e2e.mts` 用**同一 tRPC 写入口**证明。
