# STEP 13 — Research Engine 实现规划

> 状态：规划完成（只读调研，未写任何代码）。生成日期 2026-09-06。
> 结论一句话：**STEP 13 不是写 Research Engine，而是补 3 个缺失的「真实数据源」实现 + 把 engineKeyBridge 落库**；代码零重写，卡点仍是 8 域表数据。

## 一、目标（可观测交付物）

1. `runResearchPipeline` 用**真实 DB 数据**跑通端到端链路（Universe→Feature→Signal→Ranking→Selection→PositionIntent），而非测试 fixture。
2. `engineKeyBridge` 从「纯函数」变为「已接真实 identifier_history」的可用查询路径。
3. `HistoricalUniverseProvider` 落地，回测/研究 Universe 不再是 Static/Map mock。
4. `RESEARCH_READY` 门禁检查器产出 DB 实算结论（当前必为 FALSE + 缺失域清单），**不产出正式策略结论**。

## 二、现状盘点（三分类）

### A. 已就绪（代码级，无需新写）
- Research Framework 全链：`server/research/framework/pipeline.ts`（`runResearchPipeline`）、`leakage.ts`（LookAheadError 守卫）、`universe.ts`、`featureProvider.ts`、`signal/ranking/selection/positionIntentAdapter.ts`
- 评估/过拟合体系：`server/research/{walkForward,pbo,overfittingAssessment,parameterStability,sweep,evaluationService}.ts`
- 桥接纯函数：`server/security/engineKeyBridge.ts`、`server/security/historicalUniverse.ts`、`server/security/identifierHistory.ts`
- 持久化：`server/research/persistence/db.ts`、`server/security/repository.ts`（`upsertSecurityMaster` / `getIdentifierHistoryFromDb`）

### B. 空壳/待接线（STEP 13 核心 gap）
1. `ResearchDataSource` 接口（`server/research/framework/contract.ts` L222）**无 DB 实现**，仅测试 fixture。
2. `UniverseProvider` 仅 Static/Map 参考实现，**无** `HistoricalUniverseProvider` adapter。
3. `ResearchDataLoader`（`server/research/engineAdapter.ts` L79）生产实现缺失，`createDefaultExecutor` 只接测试 fixture。
4. `DbBarStore.securities()`/`seriesFor()`（`server/backtest/dbBarStore.ts` L88/L129）仍以自然键 `stockCode` 为键，未过 engineKeyBridge。
5. `routers.ts` 无 research 引擎 tRPC 端点。

### C. 等数据（DATA-PENDING）
`research_securities`=0、`research_security_identifier_history`=0、`research_security_status_history`=0、`industry_assignments`=0、`index_*`=0、`liquidity_daily`=0、`corporate_actions/adjustment_factors`=0；`stock_daily_prices` 回填中（WORK A 进行中）。

## 三、前置依赖（可量化阈值）

| 表 | 最小阈值 | 用途 |
|---|---|---|
| `stock_daily_prices` | 研究区间 ≥80% 交易日 × ≥80% 股票 | OHLCV（smoke test 仅需 1 切片日） |
| `research_securities` | ≥5,000 行（含退市，覆盖 2019 distinct 3,830） | Historical Universe 身份界 |
| `research_security_identifier_history` | ≥securities 行数 | engineKey 桥接 + 代码解析 |
| `research_security_status_history` | 停牌样本 ≥ 若干 | 停牌阻断 |
| `corporate_actions`/`adjustment_factors` | >0 | PIT 价格（raw 可降级跳过） |

## 四、分阶段实施

- **Phase 1（可立即，仅依赖 OHLCV）**：新建 `server/research/dataSource/pitResearchDataSource.ts` 实现 `ResearchDataSource`；新建 `engineKeyAwareBarStore`。验收：真实 2019 切片日跑通 `runResearchPipeline`。
- **Phase 2（依赖 securities + identifier_history）**：新建 `historicalUniverseProvider.ts` 实现 `UniverseProvider`；新建 `server/security/engineKeyRepository.ts`。验收：`getUniverse(tradeDate)` 返回无 survivorship 的 `sec_<uuid>` 列表，engineKey round-trip 通过。
- **Phase 3（收口）**：新建 `productionDataLoader.ts`；新建 `researchReadyGate.ts`。验收：smoke test 全链路 + 门禁输出「FALSE + 缺失域」。

## 五、接线点清单

| 接线点 | 文件 | 依赖数据 |
|---|---|---|
| PIT 查询层 | `server/research/dataSource/pitResearchDataSource.ts` | stock_daily_prices |
| Historical Universe 重建 | `server/research/dataSource/historicalUniverseProvider.ts` | securities + identifier_history + status_history |
| engineKeyBridge 落库 | `server/security/engineKeyRepository.ts` | identifier_history |
| 生产 DataLoader | `server/research/dataSource/productionDataLoader.ts` | 上述全部 |
| Research 门禁 | `server/research/researchReadyGate.ts` | 8 域表 |

## 六、风险与 blocker（降级策略）

- **Survivorship**：securities 0 行时禁止用 `DbBarStore.securities()` 当前列表当 Universe → 显式报错 DATA-PENDING，不 fallback。
- **Look-ahead**：CA/adjustment 未回填时禁止复权价进 signal → 降级 `adjustment="raw"`。
- **engineKey 未接线**：identifier_history 0 行时桥接返回 `NO_IDENTIFIER` → pipeline 报错而非静默降级。
- **FAIL FAST**：任何域缺数据时 `runResearchPipeline` 抛错，保证不产假结论。

## 七、验证方式（无泄漏证明）

1. Look-ahead：`LeakageGuard.assertNoLookAhead` 全 feature 通过。
2. Survivorship：含退市样本 fixture 断言 `getUniverse` 剔除 DELISTED/NOT_YET_LISTED。
3. Determinism：同输入两次 pipeline 输出全等。
4. 门禁实算：`researchReadyGate` 读 DB 计数，与 `scripts/step12_certify.mjs` 口径一致。

## 八、文件级改动清单

**新建**：`server/research/dataSource/{pitResearchDataSource,historicalUniverseProvider,productionDataLoader,index}.ts`、`server/research/researchReadyGate.ts`、`server/security/engineKeyRepository.ts`

**修改（仅接线）**：`server/backtest/dbBarStore.ts`（加 canonical securityId wrapper）、`server/research/index.ts`（导出 dataSource + gate）、`server/routers.ts`（可选，暴露 tRPC 端点）

**无需改动**：`engineKeyBridge.ts`、`historicalUniverse.ts`、`identifierHistory.ts`、`framework/*`、`persistence/*`、`repository.ts`

## 九、启动条件

Phase 1 可在 WORK A（OHLCV）完成后立即启动；Phase 2 需 WORK B（Security Master 全量）先完成。在 securities + identifier_history 有数据前，全链路只能跑降级 smoke test，不能产正式策略结论。
