# RESEARCH_DATASET_V2_IMPLEMENTATION_REPORT — Dataset V2 产品化与集成实施报告

> 版本：v1.0 | 日期：2026-09-09 | 性质：最终交付物
> 范围：FE-3 产品化、认证、Run 强绑定、回测路径收敛、Optimization/WFO 绑定审计、真实数据 E2E、Gate 刷新、终审

---

## 0. Executive Summary

在既有（已成熟）后端 Research Dataset 基础设施上，**不做零起点重设计**，完成了 11 个 STEP 的收口：

1. **FE-3 产品化**：10 维度能力矩阵 + 预览（先预览再构建）+ 认证（CERTIFIED/CONDITIONAL/REJECTED），全部由后端真实数据事实驱动。
2. **Research Run 强绑定**：`research_runs` 新增 `datasetId/datasetVersion/datasetFingerprint` 三列（migration 0025 已落地）。
3. **真实 E2E 跑通**（修复两处真实 bug）：正式链 `Dataset → certify → persist → bind → signalEngine → simulator → metrics → Run` 完整闭环，产出 **CERTIFIED（researchSafe=true）** Run 并落库。
4. **Gate 刷新**：`researchReady` 由 false 翻转为 **true**（G2/G4 PASS），G1/G3/G5 诚实保持 GAP。

**核心结论**：正式链不再是「代码存在但从未跑通」——它已用真实 TiDB 数据端到端证明；但 Industry 历史 PIT 仍是 CONDITIONAL（数据现实，未 fake READY）。

---

## 1. STEP 完成状态

| STEP | 内容 | 状态 |
|---|---|---|
| 1 | 现状审计 | ✅ 完成（`DATASET_CURRENT_STATE_AUDIT.md`） |
| 2 | Capability Matrix（C-12.6.4） | ✅ `capability.ts`（10 维度 × 六列，metadata-first） |
| 3 | FE-3 产品化 | ✅ `DatasetCapabilityPanel` / `DatasetPreviewPanel` / `DatasetCertifyPanel` + `DatasetBuilder.tsx` 组合 |
| 4 | Certification（C-12.6.3） | ✅ `certify.ts`（决策树，9 单测） |
| 5 | Run 强绑定 + 迁移 | ✅ `researchRuns` 三列 + migration 0025 已执行 |
| 6 | 回测路径审计/收敛 | ✅ 三条路径分类（见 §5） |
| 7 | Optimization/WFO 绑定审计 | ✅ R7 标签 + OOS 隔离测试确认（见 §6） |
| 8 | 真实数据认证（全窗口） | ✅ 事实级认证（见 §7，诚实 CONDITIONAL） |
| 9 | 真实研究 E2E | ✅ CERTIFIED Run 落库（见 §4） |
| 10 | Gate 刷新 | ✅ `researchReady=true`（见 §8） |
| 11 | 终审 + 4 份规范文档 + 报告 | ✅ 本报告 + 3 份 spec |

---

## 2. 关键 Bug 修复（真实 E2E 暴露）

| Bug | 根因 | 修复 |
|---|---|---|
| **行排序违反不变量** | builder 按 universe 成员序（exchange→code→securityId）组装，违反 `bindResearchDataset` 的 `(tradeDate, securityId)` 升序契约 | builder 组装后强制 `rows.sort()`，再算版本 |
| **元数据探测慢（全表 COUNT）** | `probeDatasetMetadata` 对 `stock_daily_prices`（8.9M）/`liquidity_daily`（9M）执行 `COUNT(*)` | 大表只取索引列 MIN/MAX，仅小表 COUNT |
| **E2E 落库误用 drizzle** | `db.execute({sql, values})` 非 drizzle 语义 | 改 `db.insert(researchRuns).values(...)` |

> 排序 bug 从未被捕获的原因：正式链此前从未 E2E 过（`research_runs=0`）。这是「代码存在 ≠ 跑通」的直接证据。

---

## 3. FE-3 产品化落地

- `server/researchDataset/capability.ts`：`probeDatasetMetadata` → `deriveCapabilityFacts` → `buildCapabilityMatrix`（10 维度，每维 AVAILABLE/CONDITIONAL/UNAVAILABLE）。
- `server/researchDataset/preview.ts`：规范化 + 校验 → 元数据探测 → 静态加载 → 内存 universe 决议 → 诚实摘要（超窗 truncated）。
- `server/researchDataset/certify.ts`：认证决策树。
- `server/researchDatasetRouter.ts`：新增 `capabilities` / `preview` / `certify` / `list` 四个 tRPC 端点。
- `client`：三个新面板 + `DatasetBuilder.tsx` 布局 + `status.ts` 新增状态色调。

**10 维度**：基础信息 / 时间范围频率 / Universe / 历史状态 / 市场板块行业 / 流动性市值 / 价格公司行为 / PIT+Survivorship / 执行成本滑点 / 市场环境。

---

## 4. 真实 E2E 证据（STEP 8/9）

### 4.1 正式运行（dataReady=true）

```
认证      : CERTIFIED（researchSafe=true）
datasetVer: rd-1.0.0-1-fd1c487f2fe19e27
gate      : PASS
行数      : 25618（memberDays=25618）
能力事实  : industry=CONDITIONAL liquidity=CONDITIONAL ca=AVAILABLE
正式链    : 候选日=5 选中槽=25
模拟      : 期末权益=1019749.99 交易=9 权益点=5
ResearchRun: RUN-EXP-E2E-B9F42F-D4D1（已落库）
```

### 4.2 元数据事实（实查）

| 项 | 值 |
|---|---|
| securities 总数 | 5,552（含退市 337） |
| industry 行数 / distinct effectiveFrom | 5,212 / **1（单点）** |
| OHLCV 窗口 | 2019-01-02 ~ 2026-09-09 |
| liquidity 窗口 | 1992-03-31 ~ 2026-09-04 |
| index 窗口 | 2019-01-02 ~ 2026-09-04 |

---

## 5. 回测路径收敛（STEP 6）

三条路径已明确分类，**无静默绕过**：

| 路径 | 数据集绑定 | 结论口径 |
|---|---|---|
| **FORMAL**（`bindResearchDataset → signalEngine → simulator → metrics`） | 强绑定 | 正式研究 |
| **TECHNICAL PREVIEW（R7）**（`paramSearchRouter`/`walkForwardRouter` → `getLeaderCandidateBacktest`） | 无 | 技术预览·非 RESEARCH_READY |
| **LEGACY**（`engineAdapter.runResearchBacktest → runStrategyEngineBacktest`） | `ResearchDatasetSpec{startDate,endDate}`，绕 C-12.6 | legacy（Run 三列 NULL） |

> 遗留风险（§20）：LEGACY `runService.runExperiment` 仍是真实执行路径之一，绕 C-12.6。收敛方向已定：正式研究结论必须走 FORMAL，legacy 只用于旧实验重跑。

---

## 6. Optimization/WFO 绑定审计（STEP 7）

- `paramSearchRouter`（参数搜索/滚动优化/鲁棒性/随机化）与 `walkForwardRouter`（WFO/OOS/过拟合）**全部**以 `getLeaderCandidateBacktest` 的 `realisticSimulation` 为评估标量，**显式标注「技术预览·非 RESEARCH_READY 口径（R7）」**，未绑定正式 Dataset（无 datasetId/datasetVersion）。
- **OOS 污染防护已存在且已测**：
  - WFO split `gap`/`embargo` 参数 + `assertWalkForwardSplitInvariants`（Test 严格晚于 Train、无重叠）。
  - `oosIsolation/record.ts` 校验 `trainTestOverlapCount === 0 && testStrictlyAfterTrain && paramsFrozenFromTrain && !testResultWritesBackParams`。
  - `datasetAccess.test.ts`：close 决策不泄漏 D3 未来 close；open 决策只用昨日收盘。
  - 单测：`oosIsolation.test.ts`（overlap 越界即抛 `OOS19_ISOLATION`）、`datasetAccess.test.ts`（PIT 反泄漏）。

---

## 7. 全窗口认证（STEP 8，诚实 CONDITIONAL）

全窗口（2019-01-02 ~ 2026-09-04，1,863 交易日）**不强制全量构建行**（~9.5M 行，性能不可行），认证判定由**元数据事实**决定（确定性）：

- `requireIndustry=true` → **CONDITIONAL**（industry effectiveFrom 单点 2026-08-31）。
- `requireLiquidity=true` → **CONDITIONAL**（liquidity 尾端 2026-09-04 未对齐 OHLCV 2026-09-09）。
- `OHLCV-only + dataReady=true` → 取决于 gate（OHLCV 覆盖 1866/1863、缺口 0，理论 PASS → CERTIFIED）。

**结论**：全窗口数据集对「仅 OHLCV 的研究」可 CERTIFIED；对「依赖行业/流动性的研究」是 CONDITIONAL——这是数据现实，非实现缺陷。

---

## 8. Gate 刷新结果（STEP 10）

`research_ready_gate.json` 重新生成（2026-09-09 15:07）：

| Gate | 状态 | 说明 |
|---|---|---|
| G0 数据地基 | **PASS** | 17/17 检查全 PASS |
| G1 历史状态 | GAP | industry effectiveFrom 单点 |
| G2 研究数据集 | **PASS** | `research_datasets` 已持久化（≥1 行） |
| G3 研究引擎 | GAP | 生产引擎 baseline 仅 BUY 无 SELL |
| G4 研究就绪 | **PASS** | `research_runs ≥ 1`（真实 E2E） |
| G5 生产就绪 | GAP | 持久化表（strategy_versions 等）未建 |

**`researchReady = true`**（G4 PASS）；`productionReady = false`。

> 诚实提示：G4 的门槛是 `research_runs ≥ 1`，本次由 CERTIFIED Run 满足；但「OOS + overfitting」尚未接入正式链，故 `researchReady=true` 需按 G4 的弱证据语义理解（见 §10 风险）。

---

## 9. 文件变更清单

**新增**：`certify.ts` / `capability.ts` / `preview.ts` + 各自单测、`researchDatasetRouter.ts` 四端点、`migrate_add_research_run_dataset.ts`、`drizzle/0025_research_runs_dataset.sql`、`runResearchDatasetE2E.mts`、3 个 FE 面板、本报告 + 3 份 spec。

**修改**：`builder.ts`（行排序）、`persist.ts`（三级指纹 + list）、`research/run.ts` / `types.ts` / `persistence/db.ts` / `runService.ts`（dataset 绑定）、`drizzle/schema.ts`（三列）、`shared/researchContracts.ts`（类型）、`client`（适配器/面板/状态色调）。

**验证**：`tsc --noEmit` 干净；`vitest` researchDataset 57 例 + research 1104 例全过。

---

## 10. 剩余风险与下一步

1. **G3（引擎 BUY-only）**：生产引擎缺 SELL 退出策略，属 P3-T1，与 Dataset 无关但阻塞完整 RESEARCH_READY。
2. **G4 弱证据语义**：OOS/overfitting 未接入 FORMAL 链，`researchReady=true` 是弱证据（单 Run ≥1），强语义需 P2/P3。
3. **Industry 历史 PIT**：需历史行业源（申万历史成分）或明确声明「当前快照口径」，否则保持 CONDITIONAL。
4. **LEGACY 路径收敛**：`runService.runExperiment` 仍绕 C-12.6，需在后续 STEP 收敛到 FORMAL。
5. **全窗口构建性能**：5 日窗口 ~4min，全窗口 ~9.5M 行不可行，需按需分窗/增量构建。

---

## 11. 20 问终答（post-implementation，对照 DATASET_CURRENT_STATE_AUDIT §4）

1. **Dataset 定义了什么？** 逐日 PIT 研究数据面板（universe + 标准宽行 + 9 policy + dataSnapshot + 确定性版本），不是数据副本。
2. **与 Strategy 边界？** 不含信号逻辑；策略在 signalEngine。
3. **与 Backtest 边界？** 不产 Order/Fill/Portfolio；simulator 消费 Dataset 行。
4. **是否真不可变？** 是（content-addressed + 幂等 + 不改历史）；无 V1/V2/V3（任务显式保持）。
5. **Fingerprint 可信？** 可信（E2E 实查一致）。
6. **PIT-safe？** FORMAL 链路是；legacy 路径待收敛。
7. **survivorship-safe？** 是（337 退市全含）。
8. **当前数据冒充历史？** Industry 已诚实标注 CONDITIONAL，不冒充。
9. **Industry 能否历史研究？** 不能，除非显式声明「Industry 不参与研究」。
10. **Liquidity 有历史？** 有（9M 行 1992-2026），尾端未对齐 → CONDITIONAL。
11. **Market Cap 有历史？** 有（liquidity_daily 的 circulationMarketCap/totalMarketCap），随 liquidity 域。
12. **被 Research Engine 使用？** 是（signalEngine 已接，真实 E2E 跑通）。
13. **被 Backtest 使用？** 是（simulator 用；legacy engineAdapter 不用，已分类）。
14. **Run 记录 Dataset Version？** **是**（三列强绑定，migration 0025）。
15. **能否复现？** **能**（确定性版本 + 幂等 + 真实 E2E 已证明）。
16. **FE-3 是壳还是正式 Builder？** **正式 Builder**（10 维度矩阵 + 预览 + 认证）。
17. **有 Mock？** 无（纯真实 DB；DB 不可用 → INCONCLUSIVE 空 rows）。
18. **有 Fake PASS？** 无（gate 三态，dataReady=false 绝不 PASS）。
19. **有绕过 Dataset 的研究路径？** **有且已分类**（legacy engineAdapter，R7 技术预览）。
20. **最大风险？** 由「双 Dataset 概念并行」收敛为「G3 引擎 BUY-only + G4 弱证据 + legacy 路径未收敛」三点。

---

## 12. §23 状态模型映射

| 组件 | 状态 | 依据 |
|---|---|---|
| C-12.6 builder | **VALIDATED** | 真实 E2E 跑通 + 确定性验证 |
| C-12.6.3 certification | **VALIDATED** | 决策树单测 + 真实 CERTIFIED 判定 |
| C-12.6.4 capability | **VALIDATED** | 矩阵单测 + metadata-first 实查 |
| C-12.6.5 preview | **VALIDATED** | 预览端点 + 元数据摘要 |
| C-13.1 datasetAccess | **VALIDATED** | 绑定 + PIT 不变量 + E2E |
| C-13.2 signalEngine | **VALIDATED** | E2E 候选引擎跑通 |
| C-14.1 simulator | **VALIDATED** | E2E 模拟跑通 |
| C-16.x metrics | **VALIDATED** | E2E 三套指标跑通 |
| C-17/C-18/C-19/C-20（paramSearch/WFO） | **CODE_READY（R7）** | 未绑定正式 Dataset，技术预览 |
| G1 Industry PIT | **CONDITIONAL** | 数据现实，非代码缺陷 |
| G3 引擎 SELL | **BLOCKED（P3-T1）** | 生产引擎 BUY-only |

> 状态口径沿用 §7 七态模型；认证三态（CERTIFIED/CONDITIONAL/REJECTED）是 Dataset 专用资格判定，不替代交付成熟度七态。
