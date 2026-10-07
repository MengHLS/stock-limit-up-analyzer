# RESEARCH-TEMPLATE-CASE-TO-STRATEGY-001

> 从 Strong Trend Re-entry V1 案例提炼的**通用研究模板**
> 来源：STRATEGY-CLOSEOUT-REENTRY-001（`strong-trend-reentry-v1 = TERMINATED / NO_EDGE_FOUND`）
> 生效范围：**所有新案例**（Case Discovery → 是否可创建正式 Strategy Candidate）

---

## 0. 铁律（本案例的直接教训）

```text
1. 样本集必须来自【单一数据源 + 明确口径】的 canonical event set，
   禁止把上一阶段的 JSON 产物当作下一阶段的样本来源。
2. 任何"发现"必须在【全量 canonical 样本】上复现，才允许进入策略定义。
3. Research 与 Strategy 必须先做 Parity（Event/Reclaim/Entry/Exit/Cost），
   再做收益比较；否则会把"样本不同"误判成"执行不同"。
4. 只有 Gate = PASS_TO_STRATEGY_DEFINITION 才允许创建 Strategy Candidate。
```

本案例的失败模式：`_analyze_pattern_reentry.mjs` 继承 DISCOVERY 阶段 `observations` 并集（691），
后续 5 份报告全部沿用该子集 ⇒ 得出 +18.5% 的正向结论；canonical 全量（3,910 S / 2,542 RECLAIM /
2,499 fillable）复核后 T+20 中位为 **-13.22%**，**无 edge**。

## 1. 标准流程（六段，逐段有 Gate）

```text
① Case Discovery
      ↓
② Canonical Event Set
      ↓
③ Full-Sample Discovery
      ↓
④ Research / Strategy Parity
      ↓
⑤ Return Bridge
      ↓
⑥ Gate
```

### ① Case Discovery（探索，允许宽松，但不许污染下游样本）

- 目的：**找线索**，不是下结论。
- 允许：小样本、直觉筛选、可视化、极端案例观察。
- 强制：**所有"筛选步骤"必须逐条写出**（SQL / 文件 / filter），并落盘成交互记录。
- 交付：`RESULT-PATTERN-*-001.md`，状态只能是 `EXPLORATORY`。
- 🔴 **禁止**：把该阶段的 JSON 产物作为后续任何阶段的样本来源。

### ② Canonical Event Set（把样本钉死）

- 单一数据源：**一个 `datasetVersionId`**。
- 口径必须**显式、可复现**：事件定义、观察窗口、相对日、字段完整性条件
  （如 `barPresent=1 AND close IS NOT NULL`）、去重键（如 `eventId`）。
- **禁止**在 sample construction 层混入：未来收益、outcome 可得性、path 完整性、
  suspension 之外的过滤（每一条都要显式声明并登记理由）。
- 交付：canonical 产物 JSON + 计数漏斗
  `FIRST_LIMIT → S → RECLAIM → RECLAIM+1 fillable → distinct eventId`，
  每个计数附 **event count 与 stock count**。

### ③ Full-Sample Discovery（在全量 canonical 上做发现）

- 只用 ② 的样本；**不得重新筛选**。
- 每因子先做**单因子分桶 / TopN**，不做组合、不做加权。
- 必须输出：
  - 全样本 / 股票去重 / 非重叠（**三口径的真实实现**，并验证口径确实生效）
  - T+5 / T+10 / T+20 的 median / mean / P25 / P75 / 胜率
  - MAE / MFE（并写明相对哪个锚点价）
  - **逐年**切片
- 五项必查：**单调关系 / TopN 优势 / 是否仅少数年份有效 / 是否少数极端值贡献 / 小样本假优势**。
- Gate ③：若全量样本上**无任何桶**给出正的中位收益或 >50% 胜率 ⇒ 直接 `NO_EDGE_FOUND`，**终止**。

### ④ Research / Strategy Parity

- 必须逐层对齐：**Event Set → Reclaim Set → Entry（日期+价格）→ Exit（日期+原因）→ Cost**。
- 每层输出：`Research count / Strategy count / intersection / Research-only / Strategy-only`。
- 匹配键优先用 **event identity**（如 `eventId`），不得只用 `股票+日期`。
- 🔴 只有 Event / Reclaim / Entry 三层一致后，才允许做收益比较。

### ⑤ Return Bridge（逐笔收益归因）

固定四层，配对样本计算：

```text
A 研究理论（canonical 入价 → 固定 T+N Close）
B 策略入价（actual entryPrice → 同一 Close）
C 策略实际退出（actual entryPrice → actual exitPrice）
D 扣成本（net）
```

- 输出各段对中位/均值的贡献（A→B / B→C / C→D / 合计）。
- 结论必须回答：负收益来自 **Entry / Exit / Cost / 信号本身** 哪一层。

### ⑥ Gate

```text
PASS_TO_STRATEGY_DEFINITION   仅当 ③ 在全量样本上存在正向且可解释的条件
NO_EDGE_FOUND                 全量样本无正向条件（本案例）
BLOCKED                       数据/口径无法支撑判断
```

🔴 **只有 `PASS_TO_STRATEGY_DEFINITION` 才允许创建正式 Strategy Candidate**；
且在此之前**不得**进入 Parameter Search / OOS / WFA / Paper Trading。

## 2. 交付物清单（每案例必须齐全）

| 阶段 | 交付物 | 必备内容 |
|---|---|---|
| ① | `RESULT-PATTERN-*-001.md` | 探索口径 + **完整筛选步骤** + 状态 `EXPLORATORY` |
| ② | canonical 产物 JSON | 单一数据源 + 口径 + 计数漏斗（event/stock） |
| ③ | `RESULT-DISCOVERY-*-CANONICAL-*.md` | 三口径 + 年份 + 因子分桶 + 五项检查 + Gate |
| ④ | `RESULT-PARITY-*-*.md` | 逐层 count / intersection / only |
| ⑤ | `RESULT-PARITY-*-RETURN-BRIDGE.md` | A/B/C/D 分段贡献（配对） |
| ⑥ | `RESULT-STRATEGY-CLOSEOUT-*.md` | 关闭或放行决定 + 证据链状态标记 |

## 3. 状态词表（统一）

```text
EXPLORATORY
SUPERSEDED / SUPERSEDED_BY_CANONICAL
INVALIDATED
BASELINE_VALID
PARITY_PASS
NO_EDGE_FOUND
PASS_TO_STRATEGY_DEFINITION
RESEARCH_TERMINATED
BLOCKED
```

## 4. 明确禁止（沿用既有纪律）

```text
✗ 用上一阶段 JSON 作为下一阶段样本来源
✗ 在 sample construction 层混入 outcome / 未来收益过滤
✗ Event/Reclaim/Entry Parity 未过就比收益
✗ 全量样本上无 edge 仍进入 Parameter Search / OOS / WFA
✗ 为得到正收益而筛选样本
✗ 修改已验证策略语义而不走 applyDefinitionChange()
✗ 删除历史报告 / Run / Dataset 以掩盖失败结论
```

## 5. 本案例的正向沉淀（可复用资产）

- **样本层**：canonical event set 构建 + 计数漏斗 + 集合差集模板；
- **执行层**：`candidateExitPolicy=DISABLED` 的退出语义验证；
  Execution Overlay（`loadPositionExecutionOverlay` + `DbBarStore.barsForSecuritiesDateRange`）
  把「信号成员裁剪」与「持仓生命周期数据」解耦；
- **验证层**：`holdingPeriod` 含头计数（21 ⇔ entry 后第 20 日）等口径澄清；
  SUSPENDED 根因定位模板（按 side×status 拆 audit，识别「每日重复 SELL」）。
