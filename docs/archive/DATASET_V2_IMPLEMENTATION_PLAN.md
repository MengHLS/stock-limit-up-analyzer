# DATASET_V2_IMPLEMENTATION_PLAN — Dataset V2 实施计划

> 版本：v1.0 | 日期：2026-09-09 | 性质：**第一步交付物（待确认，未进入代码修改）**
> 前置：`DATASET_CURRENT_STATE_AUDIT.md`（现状）+ `DATASET_CAPABILITY_MATRIX.md`（能力矩阵）
> 执行顺序严格按 §24：AUDIT → CONTRACT → DATA MODEL → BACKEND → VALIDATION → CERTIFICATION → DATASET ACCESS → FRONTEND → INTEGRATION → REAL DATA → AUDIT

---

## 0. 设计决策（关键取舍，需用户确认）

| # | 决策点 | 方案 | 理由 |
|---|--------|------|------|
| D1 | **双 Dataset 概念收敛** | 让 legacy `ResearchRun` / `ResearchDatasetSpec` 强绑定 C-12.6 `datasetVersion`，**不重写** C-12.6 | 保留已验证的后端；消除「页面 V1、实际别处数据」风险 |
| D2 | **语义版本** | 在 content-addressed 版本之上叠加「语义版本」`DS-<name>-V<n>`，内容变化 → 新 V（V1→V2），同 V 内容指纹必同 | 满足 §7；不破坏既有确定性指纹 |
| D3 | **Dataset 不物化** | 沿用 Manifest + Deterministic Query +（必要时）Materialized Cache；**不复制 8.89M OHLCV 到 dataset_bars** | §20 铁律 |
| D4 | **Execution/Cost/Slippage** | 归属 Strategy/Backtest 层（§10），Dataset 仅声明「实验环境边界」字段，不实现成交逻辑 | 边界铁律 |
| D5 | **Industry** | 保持 CONDITIONAL，FE-3 展示「Historical industry sequence unavailable / incomplete」；用 Industry 的 Dataset 产 `RESEARCH_SAFE=false` | §19 铁律 |
| D6 | **Validation 分级** | 新增 PASS/WARN/FAIL 三层（保留现有 FAIL/PASS/INCONCLUSIVE gate 兼容） | §10 要求 |
| D7 | **不做 Mock / 不伪造 PASS** | 全程真实 DB；DB 不可用 → INCONCLUSIVE | 铁律 |

---

## 1. 阶段划分与任务（DS-01 ~ DS-24）

### 阶段 1：AUDIT（已完成）

| Task | 说明 | 状态 | 依赖 | 证据 |
|------|------|------|------|------|
| DS-01 | 完整现状审计 | ✅ **COMPLETE** | — | `DATASET_CURRENT_STATE_AUDIT.md` |

### 阶段 2：CONTRACT

| Task | 说明 | 状态 | 依赖 | 证据 | Test | Risk |
|------|------|------|------|------|------|------|
| DS-02 | Dataset V2 Contract（概念模型/边界/字段） | PLANNED | DS-01 | `docs/researchDataset/DATASET_SPECIFICATION.md` | 契约单测 | 字段照抄 §4 反而破坏现有 schema → 以现有 schema 为基础扩展 |

**范围**：明确 `Dataset` 概念模型（Identity/Scope/Universe/HistoricalState/Market/Liquidity/DataPolicy/CAPolicy/PIT/Survivorship/ExecutionBoundary/Cost/Slippage/Quality/FeatureAvailability/MarketContext/Version/Fingerprint/Lineage/Certification）与 §3 现有字段的映射；明确 Dataset vs Strategy vs Backtest 边界；明确「不物化」原则。

### 阶段 3：DATA MODEL

| Task | 说明 | 状态 | 依赖 | 证据 | Test | Risk |
|------|------|------|------|------|------|------|
| DS-03 | Schema 扩展（语义版本 V<n> / lineage / certification / 新请求字段） | PLANNED | DS-02 | migration 0025 | schema 单测 + 迁移一致性 | 破坏 0024 表 → 用 ALTER 增量，不重建 |

**范围**：`research_datasets` 增列 `semanticVersion`、`lineageJson`、`certificationStatus`、`certificationJson`；请求层新增 Universe/HistoricalState/Liquidity/MarketCap/DataQuality 可选字段（默认值与现有语义一致，向后兼容）。

### 阶段 4：BACKEND

| Task | 说明 | 状态 | 依赖 | 证据 | Test | Risk |
|------|------|------|------|------|------|------|
| DS-04 | Dataset Version（语义 V1/V2/V3 不可变） | PLANNED | DS-03 | version.ts 扩展 | immutability 单测 | 语义版本与内容指纹双轨不一致 |
| DS-05 | Fingerprint（扩展覆盖 spec/universe/PIT/CA/source/quality） | PLANNED | DS-04 | versionSnapshot 扩展 | determinism + 变化即变指纹 | 纳入瞬时字段破坏确定性 |
| DS-06 | Universe（市场/板块/指数/自定义 + Universe Mode） | PLANNED | DS-03 | universe.ts 扩展 | PIT/survivorship 单测 | 指数成分无历史 → 标 CONDITIONAL |
| DS-07 | PIT（STRICT/固定 asOf + Lookahead 守卫） | PLANNED | DS-06 | 复用 + 强化泄漏守卫 | Future Leakage Test | legacy 路径泄漏 |
| DS-08 | Historical State（ST/停牌/退市/IPO/上市天数/风险警示） | PLANNED | DS-06 | reconstruct 扩展 | PIT 状态单测 | listing age 语义需定义 |
| DS-09 | Market/Board/Industry（诚实标注 Industry CONDITIONAL） | PLANNED | DS-08 | policy.industry 扩展 | industry 一致性单测 | 误标 READY |
| DS-10 | Liquidity/Market Cap（含 5/10/20/60D 窗口） | PLANNED | DS-03 | liquidity 聚合 | 窗口 PIT 单测 | 窗口聚合未来函数 → 用 PIT 窗口 |
| DS-11 | Corporate Action（分红/送转/配股/拆合策略） | PLANNED | DS-03 | policy.ca 扩展 | CA 一致性单测 | announcementDate=exDate 假设 |
| DS-12 | Execution/Cost（仅「实验环境声明」，不实现成交） | PLANNED | DS-02 | 声明字段 | 契约单测 | 越界实现成交逻辑 |
| DS-13 | Market Context（Trend/Volatility 可标，Breadth/Sentiment 诚实标注） | PLANNED | DS-02 | marketRegime 接入 | 可用性单测 | 无数据冒充 |

### 阶段 5：VALIDATION

| Task | 说明 | 状态 | 依赖 | 证据 | Test | Risk |
|------|------|------|------|------|------|------|
| DS-14 | Validation 升级为 PASS/WARN/FAIL（14 项检查） | PLANNED | DS-05 | validate 扩展 | validation 分级单测 | 只给 true/false 混入 |

**范围**：14 项检查（日期/日历/universe/身份/历史状态/重复 bar/缺失 bar/CA 一致性/复权因子一致性/PIT 一致性/survivorship/源版本/必需数据/指纹确定性），产出 PASS/WARN/FAIL + 明细。

### 阶段 6：CERTIFICATION

| Task | 说明 | 状态 | 依赖 | 证据 | Test | Risk |
|------|------|------|------|------|------|------|
| DS-15 | Certification（CERTIFIED/CONDITIONAL/REJECTED） | PLANNED | DS-14 | `DATASET_CERTIFICATION_SPEC.md` | certification 单测 | CODE_READY 冒充 CERTIFIED |

**范围**：Data Foundation Gate + Validation + PIT + Universe + Reproducibility 全过才 CERTIFIED；否则 CONDITIONAL/REJECTED。

### 阶段 7：DATASET ACCESS

| Task | 说明 | 状态 | 依赖 | 证据 | Test | Risk |
|------|------|------|------|------|------|------|
| DS-16 | DatasetAccess（Manifest + Deterministic Query + 缓存） | PLANNED | DS-05 | datasetAccess 扩展 | access 单测 | 每次全表扫描 |

### 阶段 8：FRONTEND

| Task | 说明 | 状态 | 依赖 | 证据 | Test | Risk |
|------|------|------|------|------|------|------|
| DS-17 | FE-3 Builder 8+ 维度（01 Basic~11 Market Context） | PLANNED | DS-06~DS-13 | 页面重构 | E2E 单测 | 前端自造量化语义 |
| DS-18 | FE-3 Preview（Universe/日期/证券数/bar 数/覆盖/PIT/Survivorship/Industry/Liquidity/CA/Quality）+ Validation + 动态按钮 | PLANNED | DS-17 | 预览组件 | E2E 单测 | Preview 全表扫描 |
| DS-19 | FE-3 能力三态标注（AVAILABLE/CONDITIONAL/UNAVAILABLE） | PLANNED | DS-18 | 能力矩阵驱动 | 契约单测 | 硬编码矩阵 vs 后端权威 |

### 阶段 9：INTEGRATION（关键）

| Task | 说明 | 状态 | 依赖 | 证据 | Test | Risk |
|------|------|------|------|------|------|------|
| DS-20 | Research Run 强绑定 datasetVersion/datasetFingerprint | PLANNED | DS-16 | run 身份扩展 | Run 引用版本单测 | 改 Run 破坏 legacy |
| DS-21 | 打通真实 E2E（Dataset→Access→Feature→Signal→Intent→Order→Fill→Portfolio→PnL→Metrics） | PLANNED | DS-20 | research_runs ≥1 | E2E + 泄漏测试 | 数据量性能 |

**范围**：把 `ResearchRun` 身份扩展为 `Dataset + Strategy + Code + Parameters` 四要素；`ResearchDatasetSpec.datasetVersion` 改必填；`engineAdapter` 数据加载改走 C-12.6 Dataset（或显式标记 legacy 路径为 `TECHNICAL PREVIEW`，不得冒充 RESEARCH EVIDENCE）。

### 阶段 10：REAL DATA

| Task | 说明 | 状态 | 依赖 | 证据 | Test | Risk |
|------|------|------|------|------|------|------|
| DS-22 | 真实数据验证（2019-01-02~2026-09-04，记录真实 universe/bars/覆盖/warnings/PIT/fingerprint） | PLANNED | DS-15 | 真实 report | 真实断言 | 全历史性能 |

### 阶段 11：AUDIT

| Task | 说明 | 状态 | 依赖 | 证据 | Test | Risk |
|------|------|------|------|------|------|------|
| DS-23 | Gate 集成（Dataset Certified 成为 Research Ready 必要条件，不粗暴改总 Gate） | PLANNED | DS-22 | gate 报告 | gate 单测 | 直接改总 gate |
| DS-24 | Final Audit（§28 二十问复答 + 最终报告 `RESEARCH_DATASET_V2_IMPLEMENTATION_REPORT.md`） | PLANNED | DS-23 | 最终报告 | 全链验证 | 假 PASS |

---

## 2. 依赖图（关键路径）

```
DS-01(✓) → DS-02 → DS-03 → DS-04 → DS-05 ─┬→ DS-06/07/08/09/10/11/12/13（可并行）
                                            ├→ DS-14 → DS-15 → DS-16
                                            └→ DS-17/18/19（前端，依赖 06~13）
DS-16 → DS-20 → DS-21（真实 E2E）
DS-15 → DS-22（真实数据）
DS-21/22 → DS-23（gate）→ DS-24（final audit）
```

---

## 3. 每个阶段的退出检查（§24）

| 阶段 | 检查项 |
|------|--------|
| CONTRACT | 契约文档落盘 + 契约单测过 + 与 quant-system-contract.md 无冲突 |
| DATA MODEL | migration 落库 + schema=migration=DB + tsc 过 |
| BACKEND | 单测过 + 无 Mock + tsc 过 |
| VALIDATION | 14 项检查 + PASS/WARN/FAIL 产出 |
| CERTIFICATION | CERTIFIED 判定链 + 证据落盘 |
| DATASET ACCESS | Manifest/Query/Cache + 性能不退化 |
| FRONTEND | Builder/Preview/三态标注 + 前端不重算量化语义 |
| INTEGRATION | Research Run 强绑定 + research_runs ≥1 |
| REAL DATA | 真实 dataset 验证 + fingerprint 可复现 |
| AUDIT | §28 二十问全 YES 或明确 NOT READY |

---

## 4. 风险登记（Top 5）

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| R1 | 双 Dataset 概念收敛时破坏 legacy Research Run | 高 | 增量绑定，不改 C-12.6；legacy 路径先标 `TECHNICAL PREVIEW` |
| R2 | Industry 历史 PIT 无法获得免费源 | 高 | 诚实 CONDITIONAL，不伪造；长期找历史源 |
| R3 | 全历史 8.89M 行真实构建性能 | 中 | metadata first + indexed validation + cached statistics；异步详细验证 |
| R4 | 语义版本与内容指纹双轨不一致 | 中 | 单测守护：同 V 必同指纹，内容变必新 V |
| R5 | 前端越权实现量化语义 | 中 | FE 只调 API；矩阵由后端 authority 驱动 |

---

## 5. 待用户确认的 3 个决策点

1. **D1（双概念收敛）**：确认采用「legacy Run 强绑定 C-12.6 datasetVersion + 逐步替换 engineAdapter 数据加载」，还是「保持 legacy 路径为 TECHNICAL PREVIEW、另建 C-13/C-14 正式链」？（推荐前者）
2. **D2（语义版本）**：确认叠加 `DS-<name>-V<n>` 语义版本（content-addressed 仍保留为底层指纹）？
3. **D6（Validation 分级）**：确认新增 PASS/WARN/FAIL，与现有 FAIL/PASS/INCONCLUSIVE gate 并存（gate 保留为构建闸，validation 为分级诊断）？

> 确认后进入代码修改。当前**未修改任何代码/数据**。
