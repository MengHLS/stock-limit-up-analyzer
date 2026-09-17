# STEP 6.3 IMPLEMENTATION REPORT — Parameter Sweep

> 状态：**PASS**
> 日期：2026-09-06
> 范围：`server/research/` 参数扫描基础设施（在 STEP 6.1 Research Contract 与 STEP 6.2 Experiment / Persistence / Research Run 之上）

---

## 1. Implementation

- **Parameter Space**：`server/research/parameterSpace.ts`
  - `SweepParameterDefinition` 判别联合：`number` / `integer` / `boolean` / `enum`（各带 `name` + 取值约束）。
  - `ParameterSpace { parameters: SweepParameterDefinition[] }`。
  - `validateParameterSpace`（纯函数，返回结构化 `ResearchValidationResult`）+ `assertValidParameterSpace`。

- **Combination Generator**：`server/research/combinationGenerator.ts`
  - `calculateCombinationCount`（各参数取值数量之积，空空间=1）。
  - `generateParameterCombinations`（纯函数、笛卡尔积、确定性）。
  - `DEFAULT_MAX_COMBINATIONS = 10_000`；生成前强制上限，超出即抛错（不截断）。
  - 浮点稳定化（index 生成 + `toFixed` 按 min/max/step 最大小数位），整数精确。

- **Experiment Batch**：`server/research/sweep.ts`
  - `ExperimentBatch`（batchId + strategyId/version + 冻结 parameterSpace + fingerprint + experimentIds + status）。
  - `SweepBatchStatus = created | running | completed | failed | cancelled`。
  - `computeParameterSpaceFingerprint`（canonical SHA-256）。
  - `serializeParameterSpace` / `deserializeParameterSpace`（持久化用）。
  - `sortSweepResults`（仅排序，**不提供 selectBestParameters**）。

- **Sweep Runner**：`server/research/sweepService.ts`
  - `createSweep`：校验策略身份 → 生成确定性组合 → **预校验每个组合**（复用 `resolveParameterSet`，FAIL FAST 不产生孤儿实验）→ 每个组合走 STEP 6.2 标准 `createExperiment` → 组装并持久化 Batch。
  - `runSweep`：Batch → 逐个 Experiment → `runService.runExperiment`（复用生产 Backtest Core）→ 汇总 total/succeeded/failed/cancelled。
  - `getSweepResults`：从已持久化 Experiment + Run 重构可追溯结果。

- **Result Summary**：`SweepSummary`（total/succeeded/failed/cancelled）+ `SweepResult`（experimentId/runId/parameterSet/status/metrics/error）。

## 2. Architecture

```
Research Strategy → Parameter Space → Combinations → Experiment Batch
      → Experiment A/B/C → Research Run → Existing Backtest Core → Sweep Summary
```

- **生产边界**：`server/strategy` / `server/engine` / `server/risk` 无反向 import `server/research/*`（测试断言通过）。
- **不复制 Backtest**：SweepRunner 是纯编排，signal/position/risk/execution/commission/slippage/portfolio 全部由既有 `runStrategyEngineBacktest` 生产链路负责。
- **不吞异常**：执行期失败由 `runService.runExperiment` 记录 FAILED Run（error + finishedAt）；前置条件错误 throw 响亮暴露。

## 3. Persistence

- **新表**：`research_experiment_batches`（batchId UNIQUE / strategyId / strategyVersion / parameterSpaceJson / parameterSpaceFingerprint / experimentIdsJson / status / createdAt / updatedAt）。迁移 `drizzle/0015_chunky_namora.sql`（drizzle-kit generate 生成）。
- **复用既有**：`ExperimentRepository` / `ResearchRunRepository`（内存 + DB 双实现）；新增 `SweepBatchRepository`（契约 + `InMemorySweepBatchRepository` + `DbSweepBatchRepository`）。
- 未引入新 ORM / Redis / 消息队列 / 新数据库。

## 4. Safety

- **maxCombinations**：默认 10_000，生成前强制，超出 FAIL FAST（不先膨胀再截断）。
- **校验**：min≤max、step>0、finite（禁 NaN/Infinity）、integer 整数、enum 非空无重复、参数名非空唯一。
- **Determinism**：同一 ParameterSpace 恒定产出相同数量/顺序/值的组合（纯函数，无 Math.random/shuffle/Date.now/对象不稳定遍历）。
- **Mutation Isolation**：组合之间、组合与原始 ParameterSpace 之间不共享可变对象（结构化克隆 + 原始值）。

## 5. Tests

| 命令 | 结果 |
| --- | --- |
| `vitest run server/research` | **115 passed**（含 STEP 6.3 新增 40：parameterSpace 25 + sweep 15） |
| `npm run check`（tsc --noEmit） | **exit 0** |
| `npm run build`（vite build + esbuild） | **exit 0** |

新增测试覆盖验收 §38 的 1–19 全部项：单/多参数组合、稳定顺序、mutation isolation、非法 step/range、重复参数名/枚举值、maxCombinations、浮点稳定、空参数空间、边界（min=max、step>range）、整数精度、布尔/枚举顺序、Batch 持久化、Experiment 创建、Snapshot 隔离、Run 成功/失败/部分失败、结果追溯、生产/legacy 边界。

## 6. Regression

| 项 | 结果 |
| --- | --- |
| Feature → Strategy | PASS |
| Future Leakage | PASS |
| Decision-time Leakage | PASS |
| Risk | PASS |
| T+1 Execution | PASS |
| Determinism | PASS |
| Legacy Simulator Boundary | PASS |

全量 `vitest run`：**637 passed / 15 failed**。15 个失败**精确命中历史环境基线**（customSector=1、watchStatus=4、marketData=4、sync page=2、tushare token=1、tushare calendar=3），**无新增回归**。

> 备注：测试期间曾观测到一次 `experimentPersistence.test.ts`（STEP 6.2 成本模型快照相关）瞬时失败，后确认是并行的 STEP 6.2-FIX-1（costModel 冻结）改动进行中被截获所致；该改动落定后此测试已稳定通过（17/17）。与本 STEP 6.3 无关。

## 7. Scope（未实现，明确留待后续）

WFO ✗ / OOS ✗ / PBO/CSCV ✗ / Overfitting ✗ / Bayesian/GA ✗ / Portfolio ✗ / Paper/Live Trading ✗ / 新策略 ✗ / 新 Backtest/Execution/Risk Engine ✗ / 修改 STEP 6.1/6.2 契约 ✗ / 自动选最优参数 ✗

## 8. Git Diff

- **新增**：`parameterSpace.ts`、`combinationGenerator.ts`、`sweep.ts`、`sweepService.ts`、`parameterSpace.test.ts`、`sweep.test.ts`、`drizzle/0015_chunky_namora.sql`、`drizzle/meta/0015_snapshot.json`。
- **修改**：`persistence/contract.ts`（+SweepBatchRepository）、`persistence/inMemory.ts`、`persistence/db.ts`、`status.ts`（+Batch 状态机）、`index.ts`（+导出）、`drizzle/schema.ts`（+research_experiment_batches）、`drizzle/meta/_journal.json`。
- **无无关/临时/debug/构建产物/.env/数据库临时文件**。
- 注：整个 `server/research/` 目前整体尚未 git 提交（STEP 6.1/6.2 亦如此），属项目既有提交策略，本步骤未擅自 commit。

## 9. Final Status

- P0: **0**
- P1: **0**
- P2: **0**
- P3: 无 integer/enum 在 STEP 6.1 参数契约中的独立类型（sweep 层用 `integer`/`enum` 覆盖，映射到策略 schema 的 `number`/`string`）；无独立「离散数值列表」参数类型（用 min/max/step 或 enum 表达）。

---

**STEP 6.3 STATUS: PASS**

**NEXT: STEP 6.4（Train / Validation / OOS）**
