# DATASET_SPECIFICATION — Research Dataset 正式规范

> 版本：v1.0 | 日期：2026-09-09 | 状态：**VALIDATED**（真实 E2E 跑通，见 RESEARCH_DATASET_V2_IMPLEMENTATION_REPORT.md）
> 权威实现：`server/researchDataset/`（builder / version / policy / universe / assemble / validate / persist / certify / capability / preview）

---

## 1. 定位

Research Dataset（研究数据集）是「**研究环境定义**」，不是数据副本。它把 `(tradeDate, securityId)` 的逐日 PIT 面板固化为一组
**内容寻址、不可变、可复现**的产物，供信号引擎（C-13.2）、模拟器（C-14.1）、指标层（C-16.x）消费。

**边界（铁律）**：
- Dataset **不含**任何交易信号 / 买卖逻辑（策略在 `signalEngine` 层）。
- Dataset **不产** Order / Fill / Portfolio（成交持仓在 `simulator` 层）。
- Dataset **不复制**明细数据表（无 `dataset_bars` 复制表），只承载「哪一天、哪些证券、以何口径」的投影。

## 2. 核心产物

| 产物 | 含义 | 性质 |
|---|---|---|
| `ResearchDatasetRow` | `(tradeDate, securityId)` 的扁平 PIT 投影行 | **按 `(tradeDate, securityId)` 升序确定性排序**（builder 强制） |
| `datasetVersion` | 内容指纹版本 `rd-<builder>-<rowSchema>-<16hex>` | content-addressed，不可变 |
| `datasetId` | `DS-<datasetVersion>` | 唯一、确定性 |
| `policySet` | 9 类冻结 policy 声明 | 见 §3 |
| `dataSnapshot` | 逐域加载事实 + 请求快照 + 覆盖率缺口 | gate 判定输入 |
| `gate` | `FAIL / PASS / INCONCLUSIVE` 三态 | 构建期事实判定 |

## 3. 9 类冻结 Policy（顺序固定）

| policyId | 语义 | 当前口径 |
|---|---|---|
| `pit` | 逐日 PIT（asOf=tradeDate）或固定快照 | `asOfPerTradeDate=true`（逐日） |
| `survivorship` | anti-survivorship | B Master 全表含退市 + 逐日生命周期决议 |
| `corporate-action` | 公司行为 effective/known 双层 | PIT / FULL_KNOWLEDGE |
| `adjustment` | 行价基准 | **raw 未复权**（不宣称 adjusted） |
| `industry` | 行业归属 + PIT 过滤 | **CONDITIONAL**（effectiveFrom 单点，见 §6） |
| `liquidity` | tradeDate 日级流动性事实 | CONDITIONAL（覆盖未与 OHLCV 尾端对齐） |
| `universe-membership` | 成员决议口径 | 逐日 PIT（默认拒绝语义） |
| `calendar-trading-days` | 交易日历 | index_daily 4 核心指数并集 |
| `knowledge` | 知识可得性标记 | `retrievedAt <= asOf` 过滤 |

## 4. 版本与指纹（见 DATASET_VERSIONING.md）

- `datasetVersion = rd-${builderVersion}-${rowSchemaVersion}-${sha256(rows).slice(0,16)}`
  - 当前 `builderVersion = "1.0.0"`、`rowSchemaVersion = "1"`。
- 三级指纹：`rowsFingerprint`（sha256 前 32）、`policySetFingerprint`（前 16）、`versionSnapshotFingerprint`（前 16）。

## 5. 构建 Gate（三态，与 C-12.5.2 同构）

| gate | 条件 |
|---|---|
| `PASS` | `dataReady=true` 且无覆盖缺口、rows > 0 |
| `FAIL` | `dataReady=true` 但存在覆盖缺口/限制命中 |
| `INCONCLUSIVE` | 其余（`dataReady=false` 冒烟 / DB 不可用 / 部分覆盖） |

**铁律**：`dataReady=false` 时绝不 `PASS`；DB 不可用 → 空 rows + `INCONCLUSIVE`（不伪造空数据集为成功）。

## 6. 能力三态（见 DATASET_CERTIFICATION_SPEC.md）

`AVAILABLE / CONDITIONAL / UNAVAILABLE`，由 `capability.ts` 基于真实元数据派生。

**当前诚实状态（2026-09-09 实查）**：
- **Industry = CONDITIONAL**（`industry_assignments` effectiveFrom 单点 2026-08-31，无历史 PIT 序列）。
- **Liquidity = CONDITIONAL**（`liquidity_daily` 覆盖 1992-03-31 ~ 2026-09-04，尾端未与 OHLCV 最新 2026-09-09 对齐）。
- **Corporate Action = AVAILABLE**（announcementDate 齐备）。

## 7. 正式研究链（FORMAL，权威路径）

```
buildResearchDataset (C-12.6)
  → certifyResearchDataset (C-12.6.3)
  → persistResearchDataset (C-12.6)
  → bindResearchDataset (C-13.1)          [PIT 不变量 + 行排序断言]
  → runCandidateEngine (C-13.2 signal)    [记录 datasetVersion]
  → runTradeSimulation (C-14.1 simulator) [记录 datasetVersion]
  → evaluatePerformance/RiskAdjusted/TradeQuality (C-16.x)
  → persist ResearchRun (dataset binding)
```

**路径收敛（见 §8）**：FORMAL 为唯一可产出正式研究结论的路径；LEGACY 与 TECHNICAL PREVIEW 路径已明确分类。

## 8. 三条回测路径分类（STEP 6 审计结论）

| 路径 | 入口 | 数据集绑定 | 结论口径 |
|---|---|---|---|
| **FORMAL** | `bindResearchDataset → signalEngine → simulator` | 强绑定（datasetId/datasetVersion/datasetFingerprint） | 正式研究 |
| **TECHNICAL PREVIEW（R7）** | `paramSearchRouter` / `walkForwardRouter`（`getLeaderCandidateBacktest`） | 无 | 技术预览·非 RESEARCH_READY |
| **LEGACY** | `engineAdapter.runResearchBacktest → runStrategyEngineBacktest` | 仅 `ResearchDatasetSpec{startDate,endDate}`，绕 C-12.6 | legacy（Run 三列可空） |

## 9. 禁止事项（继承 §0 铁律）

- 禁止 mock 冒充真实数据；禁止 fake PASS；禁止未来泄漏；禁止 survivorship bias；禁止当前快照冒充历史。
- UI 不实现任何 quant 语义（PIT/universe/复权/手续费全部后端权威）。
- `CODE_READY ≠ CERTIFIED`；`TEST PASS ≠ CERTIFIED`。
