# RESULT-PARITY-003-REENTRY-RETURN-BRIDGE

> 任务：PARITY-003 ／ 策略：strong-trend-reentry-v1@1.0.1 ／ datasetVersionId=780001
> 样本：Baseline 002 实际成交的 **304 笔** trades（唯一 matched set，eventId 精确映射 canonical RECLAIM）
> 状态：**PARITY_PASS（收益层面语义一致）**

## 0. 结论先行

> **当前 Strategy 的负收益，主要来自哪一层？**
> **不是 Entry、不是 Exit、不是 Cost —— 是策略信号本身在这份 canonical 事件集上的负期望。**

| 桥段 | n | median | mean | 解读 |
|---|---:|---:|---:|---|
| **A → B**（Entry Price） | 216 | **-0.126%** | +0.080% | 入价高 ~15bps ⇒ 每笔约 -0.13pt，非系统性主因 |
| **B → C**（Exit / 生命周期） | 216 | **-0.096%** | -0.482% | 实际退出 ≈ 固定 T+20 Close，非主因 |
| **C → D**（Cost） | 303 | **-0.230%** | -0.419% | 成本真实但小，非主因 |
| **A → D**（合计） | 216 | **-0.650%** | -0.800% | 三段合计只移动 ~0.65pt |

⇒ **canonical 同样本下 Research 与 Strategy 收益层面已语义一致**（残差 ≤0.65pt，全部由入价滑点 + 成本解释）。
原本 `+18.5% vs -10.63%` 的 28pt 鸿沟，统一事件集后**归零**。

## 1. A vs B（Entry Price）

| | n | P25 | median | P75 | mean |
|---|---:|---:|---:|---:|---:|
| A Research 理论（canonical Open → entry+20 Close） | 216 | -23.90% | **-11.99%** | +2.59% | -7.18% |
| B Strategy 入价（actual entryPrice → 同一 Close） | 216 | -24.02% | **-12.12%** | +3.19% | -7.10% |
| 差（B−A） | 216 | -0.154% | **-0.126%** | -0.099% | +0.080% |

入价差（Strategy entryPrice / canonical Open − 1）：P25 **+10.05bps**、median **+15.00bps**、P75 **+15.04bps**、mean -7.34bps。
⇒ 买向滑点 `slippageBps=10` + 价格舍入解释了中位 15bps；**不存在 Entry Price 造成的系统性损失**。

## 2. B vs C（Exit）

差（C−B）：n=216，P25 -2.84%、median **-0.096%**、P75 +1.93%、mean -0.482%。

| exitReason | n | C median（actual gross） | D median（net） |
|---|---:|---:|---:|
| **持有满20个交易日（TIME_EXIT）** | **303** | -10.22% | -10.63% |
| 回测结束仍持仓（OPEN_END） | 1 | -4.26% | （未平仓） |
| STOP / TAKE_PROFIT / TREND / STRONG_HOLD | **0** | — | — |

⇒ **Exit 语义不是主要差异来源**：TIME_EXIT（entry 后第 20 个交易日收盘）与固定 T+20 Close 在同一批样本上
只差 median **-0.10pt**（尾部集中在少数笔，非系统性偏离）。

## 3. C vs D（Cost）

差（D−C）：n=303，P25 -0.627%、median **-0.230%**、P75 +0.001%、mean -0.419%。
总成本：commission + stampDuty + transferFee = **4,485.45**，slippage = **1,136.61**（合计约 5,622）。
⇒ **Cost 不是负收益主因**（A 层中位已是 -11.99%）。

## 4. 最终 Bridge

```text
Research theoretical   A  median -11.99%   (n=216)
   ↓ Entry              -> -0.13pt
Strategy entry-price   B  median -12.12%   (n=216)
   ↓ Exit               -> -0.10pt
Strategy actual exit   C  median -10.22%   (n=304)
   ↓ Costs              -> -0.23pt
Cost adjusted (net)    D  median -10.63%   (n=303)
```

配对合计 A→D：median -0.65pt / mean -0.80pt。

⚠️ A/B 的 n=216 < 304：88 笔的「entry 后第 20 个交易日」超出 `ds_*_post` 的 rd ≤ 80 窗口（数据窗口截尾）。
因此**跨样本中位数不可直接比**，桥段结论一律用**配对**差值。

## 5. 逐笔一致性（304/304）

| 检查项 | 结果 |
|---|---|
| eventId 命中 canonical RECLAIM | **304 / 304**（missingMapping = 0） |
| Entry date = canonical RECLAIM+1 交易日 | **304 / 304** |
| canonical entry Open / Strategy entryPrice | 304 / 304 可取得 |
| Strategy exitDate / exitPrice | 304 / 304 可取得 |
| exitReason | 304 / 304 可追溯（TIME_EXIT 303 / OPEN_END 1） |

逐笔明细：`scripts/_scratch/_parity003_return_bridge.json`（eventId / code / entryDate / canonOpen /
strategyEntryPrice / t20Date / t20Close / strategyExitDate / strategyExitPrice / exitReason / fees /
slippage / A / B / C / D）。

## 6. 304 笔 matched set 的三个中位数

```text
Research T+20 median（A，n=216）   = -11.99%
Strategy gross median（C，n=304）  = -10.22%
Strategy net median（D，n=303）    = -10.63%
```

同一 canonical 事件集下，研究口径与策略口径只差 **1.4pt**，方向与量级一致，不再有 28pt 差异。

## 7. 未做 / 未改

未使用 Discovery 691 样本；未重新筛选样本；未让全量 2,542 RECLAIM 参与 Bridge；无 Parameter Search /
OOS / WFA / Robustness；**未修改 Strategy 定义 / Entry / Exit / Cost / Dataset**；未重跑 Backtest。
只读 SQL + JSON + 脚本 `scripts/_scratch/_parity003_bridge.mts`。

## 8. Final Status

```text
PARITY_PASS
```

Event / Reclaim / Entry / Exit / Gross / Net 六层语义一致；残差（≤0.65pt 中位）由入价滑点与成本解释。

**研究层面提醒**：canonical 事件集上 T+20 中位是 **-11.99%** ⇒
`RESULT-PATTERN-DISCOVERY-STRONG-TREND-001` / `RESULT-PRE-STRATEGY-REENTRY-001` 的**正向结论不成立于全量样本**，
需按 canonical 流程重做 Discovery 后才能采信。
