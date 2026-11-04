# RESEARCH GATE SPECIFICATION — 研究认证 Gate 规范

> 版本：v1.0 | 日期：2026-09-09 | 状态：ACTIVE
> 目的：取代 `scripts/step12_certify_gate.mjs` 的单一 `RESEARCH_READY` 判定，落地 6 级分层 Gate。
> 铁律：任何 Gate 变更必须先提交 Gate Change Proposal（§5）。

---

## 1. Gate 分层总览

```
G0 DATA_FOUNDATION_READY      数据地基就绪
G1 HISTORICAL_STATE_READY     历史状态就绪（PIT / listing / industry）
G2 RESEARCH_DATASET_READY     研究数据集就绪（可复现 + policy 冻结）
G3 RESEARCH_ENGINE_READY      研究引擎就绪（完整生命周期 + 去 legacy）
G4 RESEARCH_READY             正式研究就绪（真实 E2E + OOS + overfitting）
G5 PRODUCTION_READY           生产级就绪（持久化 + 前端 + 安全 + 监控）
```

**核心修正**：`RESEARCH_READY` 从现在起**只**指 G4 通过。原脚本 `researchReady = dataChecks.every(status===PASS)` 只对应 G0，不再直接产出 `RESEARCH_READY`。

---

## 2. 各 Gate 定义

### G0 — DATA_FOUNDATION_READY

**验证项**（沿用现有 dataScope 15 项，但独立判定，不映射为研究就绪）：

| # | 检查项 | 阈值 | 当前（09-09 实查） |
|---|--------|------|-------------------|
| 1 | Migration PASS | ≥24 台账 + journal tag23 一致 | 待重跑 |
| 2 | Trading Calendar FULL | ≥1800 交易日，4 核心指数一致 | PASS |
| 3 | OHLCV FULL | 覆盖全交易日、重复 0 | 8.89M/1863 日/重复 0 → PASS |
| 4 | Security Master FULL | ≥5500 | 5552 → PASS |
| 5 | Identifier History FULL | ≥5500 且一一对应 | 5552 → PASS |
| 6 | Historical Status | SUSPENDED+ST 齐备 + ≥1500 覆盖 | 10373 行/1830 → PASS |
| 7 | Industry | ≥5000 股 | 5212 → PASS（**但 PIT 属 G1，不在此**） |
| 8 | Index | 4 核心指数 + ≥1800 日 | PASS |
| 9 | Liquidity | ≥5000 股 | 9.01M/5131 → PASS |
| 10 | Corporate Actions | CA 覆盖 ≥ AF − 容差 | 31641 vs 31337 → PASS |
| 11 | Adjustment Factors | ≥5000 股 | 31337/5025 → PASS |
| 12 | Historical Universe 可重建 | 三表齐备 | PASS |
| 13 | PIT validation | 区间重叠 0 | PASS |
| 14 | Survivorship validation | 退市 ≥1 | 337 → PASS |
| 15 | Data quality | 重复 0 / null 0 / 周末 0 | PASS |

**出口**：15 项全 PASS → `G0 = PASS`。注意：G0 PASS **不等于** `RESEARCH_READY`。

### G1 — HISTORICAL_STATE_READY

**验证项**：
- Listing / Delisting 边界（securities 承载）
- Suspension / ST 历史（status history）
- Name Change / Identifier（identifier history）
- **Industry 历史 PIT**：`securityId` 非 NULL + `effectiveFrom/effectiveTo` 历史区间（当前**单点 2026-08-31**，`GAP`）
- asOf(T) 查询 PIT 审计（`historicalState/audit` 12 checker）

**出口**：Industry PIT 修复 + Historical Coverage 报告（明确可用区间 / PIT 成立性 / 允许与禁止的研究）。

### G2 — RESEARCH_DATASET_READY

**验证项**：
- `research_datasets` 表持久化（datasetId / datasetVersion / fingerprint / snapshot / policy）
- 同输入两次构建一致（version A = B，rows/universe/policy/snapshot 全一致）
- 9 项 policy 冻结（universe / PIT / survivorship / CA / adjustment / industry / liquidity / calendar / knowledge）
- 数据 lineage + missing/duplicate/temporal/corporate-action 一致性

**出口**：≥1 真实 dataset 落库 + hash 可复现 + 9 policy 冻结。

### G3 — RESEARCH_ENGINE_READY

**验证项**（真实数据，非 synthetic fixture）：
```
Dataset → DatasetAccess → Feature → Signal → PositionIntent
→ Order → Execution → Fill → Portfolio → PnL → Metrics
```
- 生产引擎 BUY+SELL 完整生命周期（当前只 BUY，`GAP`）
- Research→Legacy 耦合拆除（paramSearch/walkForward/marketRegime/paper 不调 `getLeaderCandidateBacktest`）
- 回测边界条件（T+1 / 涨停不可成交 / 跌停不可成交 / 停牌 / 滑点 / 手续费 / 印花税 / Lot Size / 资金冻结 / 现金 / 持仓 / 退出 / 最大持有天数 / 止损 / 止盈 / 公司行为）

**出口**：真实数据 E2E smoke 跑通 + 边界条件逐项断言。

### G4 — RESEARCH_READY

**验证项**（G0~G3 全 PASS 后）：
- 真实研究 E2E：`research_runs ≥ 1`，Experiment→Run→Dataset→Strategy→Params→Results→Validation→Verdict
- OOS 隔离冻结（OOS 不参与优化/排序/选择）
- Overfitting 指标（PBO / Deflated Sharpe / factor ablation / OOS degradation）
- Strategy Verdict（ROBUST/PROMISING/CONDITIONAL/INCONCLUSIVE/OVERFIT/REJECTED）

**出口**：第一条真实研究记录 + verdict + 无 OOS 污染。

### G5 — PRODUCTION_READY

**验证项**（G4 后）：
- 持久化（strategy_versions / paper_trades / trade_journal_entries / experiment_artifacts）
- Security / Performance / Monitoring / Error Recovery / Reproducibility
- Frontend（四类标注：真实 / 预览 / legacy / 空壳）
- Operational Documentation（SOP + User Manual）

**出口**：§51 Q1-Q20 全 YES 或明确 NOT READY。

---

## 3. 认证脚本改造要求

- 现有 `scripts/step12_certify_gate.mjs` 改名为 `scripts/certify_g0.mjs`（只产出 G0 判定）。
- 新增 `scripts/certify_gate.mjs`：依次调 G0~G5 各判定，输出分层 JSON。
- 输出结构：
```json
{
  "capturedAt": "ISO8601",
  "gates": {
    "G0": { "status": "PASS", "checks": [...] },
    "G1": { "status": "GAP", "reason": "industry PIT single-point" },
    "G2": { "status": "GAP" }, "G3": { "status": "GAP" },
    "G4": { "status": "GAP" }, "G5": { "status": "GAP" }
  },
  "researchReady": false,
  "productionReady": false
}
```

---

## 4. 证据目录约定

```
docs/quantRoadmap/evidence/<Gate>/<TaskID>/
├── evidence.json    # 状态/输入hash/输出hash/capturedAt/realData/reproducible
├── smoke.log        # 真实数据 smoke 日志
├── acceptance.md    # 验收逐项判定
└── raw/             # 原始输出
```

---

## 5. Gate Change Proposal 规则（§45，硬性）

任何修改 Gate / Certification / Research Ready / Production Ready 的代码，**必须先**提交 Gate Change Proposal，含：

```text
Why      — 为什么改
Before   — 改前判定逻辑
After    — 改后判定逻辑
Impact   — 影响哪些 Gate / 哪些已认证结论失效
Risk     — 引入的风险
Evidence — 支撑变更的证据
```

**禁止**为让测试通过而直接改 Gate；禁止放宽验证条件换取 PASS。

---

## 6. 更新记录（append-only）

| 时间 | 变更 | 说明 |
|------|------|------|
| 2026-09-09 13:43 | 建立 | 6 级 Gate 落地，修正 RESEARCH_READY 语义膨胀 |

---

## 7. Gate Change Proposal 记录（§45 硬性）

### GCP-001 — 废除 `researchReady = dataScope.every(PASS)` 语义（P1-T1）

| 项 | 内容 |
|----|------|
| **Why** | AUDIT-003 判定：认证脚本最终判定 `researchReady = dataChecks.every(PASS)` 只认证了「数据地基」，却对外声称「研究就绪」，属语义膨胀。数据域 PASS 只是 G0，不等于 Research Engine / Backtest / OOS / Optimization 已验证。 |
| **Before** | `researchReady` = 15 项 dataScope 检查全 PASS（当前产出 `researchReady: true`） |
| **After** | 分层 Gate：`dataFoundationReady`(G0) = 15 项 dataScope 全 PASS；`researchReady`(G4) = 真实研究 E2E + OOS + overfitting 通过；`productionReady`(G5) = 持久化 + 前端 + 安全监控全满足。当前 G1~G5 均 GAP，故 `researchReady: false`。 |
| **Impact** | 前端 DataHealth / researchRun readiness 将诚实显示 `RESEARCH_READY=FALSE`；研究运行链路 readiness 返回 `DATASET_NOT_READY`（诚实阻塞）。已认证的 G0 数据地基结论不受影响。 |
| **Risk** | 前端文案可能误导（仍提示「运行脚本即解锁」），需同步修正 reason 文案，避免用户误以为跑脚本就能让 researchReady 变 true。 |
| **Evidence** | AUDIT-003 第 3/5/6 节 + 本次实查：industry securityId 全 NULL、research_datasets/strategy_versions/paper_trades 表缺失、research_runs=0、baseline 仅 BUY 无 SELL。 |

### GCP-002 — 单脚本改造而非「改名+新增」（实现决策）

| 项 | 内容 |
|----|------|
| **Why** | §3 建议 `step12_certify_gate.mjs` 改名 `certify_g0.mjs` + 新增 `certify_gate.mjs`。但 15 项 dataScope 检查是单一逻辑体，拆成两个脚本会重复或引入跨文件调用复杂度。 |
| **Before** | `step12_certify_gate.mjs` 单一脚本产单一判定 |
| **After** | 保持单脚本 `step12_certify_gate.mjs`，内部改为分层判定（G0~G5），输出到同一路径 `research_ready_gate.json`（保持 dataHealth.ts 读取路径稳定） |
| **Impact** | 输出 JSON 结构新增 `gates`/`dataFoundationReady`/`productionReady` 字段，`researchReady` 语义改为 G4 |
| **Risk** | 消费方 schema（dataHealthContracts）需同步扩展，否则新字段被 strip（向后兼容但前端拿不到分层数据） |
| **Evidence** | 无 |
