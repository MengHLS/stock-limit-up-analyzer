---
name: strategy-agent
description: Strategy Core / RuleGraph / 参数角色 / 版本化与指纹的演进规范。新能力优先进 Strategy Core，不继续扩张 legacy execution path。
---

# Strategy Agent Skill

> 先读仓库根 `AGENTS.md` §2（不变量）。
> 🔴 **本仓库策略语义的唯一权威是 `server/strategyCore/**`。**

## 1. 必须理解的词表

```text
Strategy             策略（逻辑实体）
StrategyVersion      不可变版本（semver + 行为指纹）
RuleGraph            规则图（节点 + 求值），策略判断的结构化表达
Feature Registry     特征注册表（内置指标 + 数据需求声明）
PIT                  Point-In-Time：只看决策日及之前的信息
FIXED                固定参数（不可被搜索）
TUNABLE              可调参数（搜索空间成员）
DERIVED              派生参数（由其它参数/表达式求值）
Snapshot             运行快照（构建 / 校验 / 复现）
Fingerprint          指纹（文档级 = strategy_versions.fingerprint；行为级 = 运行/证据指纹）
Parameter Search     参数空间搜索 + 稳定区判定
Backtest             历史执行模拟（server/backtest/**）
OOS                  样本外验证（隔离 + 冻结候选 + 真实重跑）
WFA                  Walk-Forward 分析（逐 Fold 搜索 → 冻结 → 邻窗重跑）
Paper Trading        模拟账户 + 前向纸面
```

## 2. 核心原则

1. **新策略能力优先进入 Strategy Core**，**不继续扩张 legacy execution path**。
2. `StrategyRuntime.evaluate(version, parameterSet, context) → StrategyDecision` 是**统一执行入口**。
   - `WINDOW` 只考虑「当前决策日及之前」的窗口日 ⇒ `evaluate` **必须逐决策日调用**。
   - `StrategyRuntime` 需要外部注入事件判定器（它不认识 Dataset）。
3. `updateVersionDefinition()` **恒抛** `VERSION_IMMUTABLE`；改内容只能 `applyDefinitionChange()` → 新版本。
4. `server/strategyCore/**` 是**纯域层**：不 import DB / router / 执行引擎；无 `Date.now` / `Math.random`。
5. legacy `StrategyDefinition` 只是**存储编码**，通过 `strategyCore/adapters/legacyDefinition.ts` 双向翻译；**不是**语义权威。
6. `datasetVersionId` 与 `decisionOffsetDays` 是**研究运行的真实坐标**；Strategy 只落引用，**不负责**数据集物理数据。
7. Strategy 不负责真实成交撮合（属 Backtest）；`Definition` 内**禁止**出现 Dataset / 引擎坐标（`DATASET_BINDING_IN_DEFINITION_FORBIDDEN`）。

## 3. 重点识别：三条路径

| 名称 | 实际位置 | 处置 |
|---|---|---|
| **recipeRegistry** | `server/research/recipeRegistry.ts` + `recipeRegistryAtoms.ts`（在产：被 `conditionSignal/compile`、`patternLibrary`、`runWorkbenchAssembly/assemble`、`strategySchema/definition`、`strategyCandidate/definitionBuild` 消费） | 是当前配方注册表，**不是** legacy；改动需评估下游 5 处 |
| **signalEngine** | `server/research/signalEngine/**`（cursorEngine / engine / evaluate / validate） | 研究侧信号求值；注意与 `strategyCore` 的语义边界 |
| **legacy runner** | `server/engine/**`（`engine.ts#runBacktestWithRisk`，**生产可达**：`sentiment.getLeaderCandidateBacktest`）、`server/strategy/**`（legacy 引擎策略）、`server/research/legacyTransactionSimulator.ts`（research-only 合法出口） | **在产 legacy 语义**；不得扩写，不得当作新策略的落点 |

🔴 **发现新代码绕过 Strategy Core**（例如直接 new 一套规则求值 / 直接拼 legacy `StrategyContract` / 自建第二套指纹）**必须报告**，不要默默接受。

## 4. 参数角色

- `server/strategyCore/parameterResolver.ts`：`FIXED` / `TUNABLE` / `DERIVED` 的解析与校验。
- `listSearchableParameters` 是「谁能被搜索」的判据；搜索域派生**不得**让 `server/research/**` 反向依赖 `server/strategyCore/**`（当前由投影层 + 等价性测试实现）。
- ⚠️ 已知缺口：`derivedFrom` 无求值器（`R-05`）；`parameterRole` 门槛未在生产完全生效。**遇到时报告，不要顺手改语义。**

## 5. 版本化与指纹

- 文档级指纹 `strategy_versions.fingerprint` **只**表示**策略文档**；证据指纹形如 `evi-sha256:…`（**独立**，不得混用）。
- `strategyPersistence/contract.ts`：唯一允许 UPDATE 的列 = `status`。
- `assertStoredVersionConsistency()` 做三方指纹断言；破坏它会静默产生「同版本不同内容」。
- `requireRecipe` 的四种来源：`strategy-document` / `strategy-declarative-conditions` / `explicit-request` / `default-fallback`（兜底**必打 `console.warn`**，且 zod 闭集在 `shared/researchContracts.ts`，不同步会导致 tRPC `.output()` 拒值）。

## 6. 禁止

- ❌ 修改核心业务口径 / 策略逻辑（未获明确授权）
- ❌ 在 `server/strategyCore/**` 里引入 DB / IO / 时间 / 随机
- ❌ 新建第二套 `canonicalMetrics` / 第二套 Strategy Core / 第二套 RuleGraph 求值
- ❌ 把新策略写进 legacy execution path
- ❌ 修改历史 `strategy_versions` 行 / 回填 Run

## 7. 输出模板

```text
Task
Strategy Core Version / Baseline
契约影响            StrategyVersion / RuleGraph / 参数角色 / 指纹 是否变化
Dataset 坐标         datasetVersionId / decisionOffsetDays 使用方式
Legacy 触碰          是否触碰 server/engine / server/strategy / legacyTransactionSimulator
绕过检测            是否存在绕过 Strategy Core 的新路径（有则必须报告）
Tests
Remaining Risks
Next Step
```