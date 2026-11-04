# 组合因子等权模板 · 12 冻结因子参照实例（第一版）

> **实验 id**：`first-board-pullback/composite-factor-equal-weight-study`
> **模板**：`COMPOSITE_FACTOR_EXPERIMENT_V1`（`research-experiments/shared/compositeFactor/**`）
> **契约**：`docs/research/FROZEN-BUCKET-CONTRACT-001.md`（FROZEN，桶边界 / 方向表 / 权重）
> **复用引擎**：`SINGLE_FACTOR_EXPERIMENT_V1`（`research-experiments/shared/singleFactor/**`）
> **结果**：`docs/research/RESULT-COMPOSITE-FACTOR-V1-001.md`
> **Dataset**：`first_limit_pullback` / **`v5`**（由公共底座强制）

## 这个实验做什么

把 **12 个已冻结的首板因子**按各自**冻结方向**做桶位分标准化（`(idx+0.5)/k`，方向表 `§3.2`），
**等权**（各 `1/12`）合成为一个排序键 `composite ∈ (0,1)`；然后**逐决策日**按 `composite`
降序取前 **3 / 5 / 10 / 20** 名，T+6 开盘等权买入、T+10 收盘卖出（往返 20 bps），
与**当日全部候选**的等权均值做**配对**比较。

```
Factor Value → Direction Adjustment → Normalization → Weight → Composite Score
             → Cross-sectional Rank → TopN → 统一交易引擎（复用单因子引擎）
```

## 坐标（与 SINGLE_FACTOR_EXPERIMENT_V1 完全一致）

| 项 | 取值 |
|---|---|
| 事件 | `v5` 全部事件；严格收盘涨停；沪深主板；`T+1..T+5` 与 `T+6..T+10` 路径完整 |
| 决策时点 | `T+5` 收盘（信息截止；`rd > 5` 的数据结构上取不到） |
| **入场** | **`T+6` 开盘**（要求 `canBuyAtOpen`） |
| **退出** | **`T+10` 收盘**；不可卖 ⇒ `T+11..T+20` 内第一个可卖收盘；20 日内无 ⇒ 剔除 |
| 成本 | 往返 **20 bps**（`netReturn = grossReturn − 0.002`，与公共底座逐字一致） |
| 候选集 | 12 因子**完备用例**（缺任一 ⇒ 不入样本；`limitGap` 的 `UNKNOWN` 是**合法桶**） |
| 排名 | 合成分降序（方向已进入成员的贡献 ⇒ 档位只有 TopN 一维） |
| TopN | `3 / 5 / 10 / 20`（四档全部跑，静态枚举） |
| 日集 | `OWN` = 当日可用样本 ≥ 该档 N；`FIXED` = 当日可用样本 ≥ 20（跨 N 可比） |
| 基准 | 当日全部候选等权（随机 N 的期望） |
| Bootstrap | 日期聚类 Moving Block，1000 次 / block 20 / **稳定哈希种子** |
| 判定 | 决策日 `< 100` ⇒ 强制 `INSUFFICIENT` |

## 与既有实验的**逐位对拍**（模板正确性的判据）

本实例的合成分 `= Σ (1/12)·oriented_f`，与 `twelve-factor-composite-study` 的
`compositeScoreOf` **是同一个式子**（同一份冻结桶表、同一份方向表、同一份 `limitGap` 例外规则）。
因此：

- `Top-3 / Top-5 / Top-10`（OWN 日集）的**点估计**——组合日均、基准日均、超额、选出笔数、
  日胜率、选中胜率——必须与 `first-board-pullback/twelve-factor-topn-ranking-study`
  的同档位**逐位相同**（那个实验是**独立实现**，两者一致即证明本模板没把样本/交易口径写歪）。
- ⚠️ **CI 端点不会逐位相同**：本模板用稳定哈希种子（`hash.ts`），既有实验用游标式种子
  （`BOOTSTRAP_SEED + 10 × 组合序号`）。CI 是区间估计，点估计与种子无关。

## 输出六段

`Overall`（全样本等权）· `TopN`（4 档 × 2 日集）· `Benchmark`（当日池 + 随机 N 分位）·
`Excess`（配对日度超额，**主判据**）· `TimeSlice`（按年）· `TradeDetails`（表内有界预览 +
全量 CSV 产物）。

## 刻意不做

- ❌ 不修改 12 个因子的定义（边界 / 方向 / 取值口径一律 import 自契约唯一落地处）；
- ❌ 不新增复杂组合算法（合成三步：方向 → 标准化 → 加权；标准化只有两种单调映射）；
- ❌ 不做权重优化（等权 `1/12`；`CUSTOM` 已预留但本实例不启用）；
- ❌ 不做归因、不做 OOS、不宣称最优。

## 已知限制

1. 合成分是加权和 ⇒ 存在因子互相掩蔽 / 区间压缩 / 不可归因三条已知缺陷（见契约 §6.1）；
2. `3/12` 成员的方向属「先验未验证」（`holdStreak` / `limitGap` / `preReturn10`）；
3. `T+1..T+5` 类因子要求决策晚于 `T+5` ⇒ 入场固定 `T+6`，与部分原实验入场点不同；
4. `OWN` 日集下各档日集不同 ⇒ 跨 N 比较必须读 `FIXED`；
5. 多重比较：逐表判定行数合计见 `customPayload.verdictRowCount`。

## 复现

```bash
# 静态检查
node node_modules/typescript/bin/tsc --noEmit --incremental false
# 运行：在「独立实验」页面选 Dataset v5 后点「运行」（或走 tRPC researchExperiments.startRun）
```
