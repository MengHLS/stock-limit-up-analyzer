# 单因子研究通用基础（`shared/singleFactor/`）

> 模板编号 **`SINGLE_FACTOR_EXPERIMENT_V1`**，实验契约 **`SF-V1-001`**。
> 实例：`research-experiments/first-board-pullback/single-factor-v1/`。

这一层是**因子无关**的：它不认识「换手率」或「守涨停 streak」，
只认识「一个因子目录项」。新增因子不需要改这里的任何一行。

## 单元与文件

| 通用基础单元 | 文件 | 关键点 |
| --- | --- | --- |
| Dataset / Universe Resolver | `universe.ts` | 复用 `deriveTwelveFactorSamples()`（样本口径**唯一**实现） |
| PIT Data Access | `pitAccess.ts` | 相对日 → 真实交易日；`factorBarAt()` 结构级拒绝 `rd > 5` |
| Factor Resolver | `factorResolver.ts` | 12 个冻结因子的**适配器**（零改动）+ 新因子注册口 |
| Cross-sectional Ranker | `ranker.ts` | 按决策日切横截面；HIGH=降序 / LOW=升序；tie-break 确定性 |
| TopN Selector | `ranker.ts#selectTopN` | 池不足 N ⇒ **整天不纳入**（不「凑合」） |
| Entry / Exit Engine | `entryExit.ts` | `T+6` 开盘 / `T+10` 收盘（顺延 ≤ `T+20`），与公共底座**逐笔对拍** |
| Position / Cost Engine | `positionCost.ts` | 全仓等权；往返 20 bps（复用公共成本模型） |
| Benchmark Calculator | `benchmark.ts` | 当日候选池等权（**不是指数**） |
| Metrics Calculator | `metrics.ts` | 11 个核心指标 + Moving-Block Bootstrap + 三态判定 |
| Time-slice Analyzer | `timeSlice.ts` | 决策日自然年切片，每片重算同一套口径 |
| Structured Result Writer | `resultWriter.ts` | 10 张表 + statistics + charts + 全量逐笔 CSV 产物 + zod schema |

`coordinate.ts` 是**冻结坐标的唯一引入点**（`ENTRY_DAY/EXIT_RELATIVE_DAY/ROUND_TRIP_COST_BPS`
全部来自 `twelve-factor-composite-study/result.ts`），并提供 `assertTemplateCoordinate()`：
入场必须紧接信息截止日、退出必须由持有日推出、公共成本模型的往返值必须等于冻结值。

## 冻结口径

```
experimentType = SINGLE_FACTOR      Universe = 首板回踩候选池（= 12F 入池池）
T              = 首板日（rd = 0）    Observation = T+1 ~ T+5（观察窗，不是买入窗）
Signal         = T+5 收盘（信息截止） Entry = T+6 开盘（canBuyAtOpen）
Exit           = T+10 收盘（canSellAtClose；不可卖顺延到其后第一个可卖日，≤ T+20）
Position       = 全仓等权            Cost = 往返 20 bps
Ranking        = HIGH / LOW          TopN = 3 / 5 / 10 / 20
Benchmark      = 当日全部符合条件的候选股票（等权）
```

8 个组合（2 方向 × 4 档）在 `types.ts` 里**静态枚举**，一次 Run 全部输出 ——
「跑完再挑最优组合」在结构上做不到。

## 三条不要踩的坑

1. **观察窗不是买入窗**：`T+1..T+5` 只提供信息，最早合法成交点是 `T+6` 开盘。
   写「窗口内首次触及某价就买入」会用到当日收盘才知道的信息（look-ahead）。
2. **不要用桶位分排序**：本模板用因子的**原始值**排序。
   桶位分是「分桶研究」的口径，用它做 Top-N 会让「Top-3」失去可解释性。
   桶词表仍然进结果留档（可审计因子契约指纹）。
3. **不要在这里再加一套入场/退出**：规则只有一套，`entryExit.ts` 与
   `derive.ts` **逐笔对拍**，不一致即 Run 失败。要改就改 `coordinate.ts` 引用的冻结契约。

## 池子口径（必须一起披露）

池子 = **12F 的入池池**（要求 12 个因子全部可评估），不是「只要求目标因子可评估」：

- 好处：12 个单因子实验跑在**同一份样本**上，「哪个因子更能挑」这个问题才成立；
- 代价：目标因子之外的因子缺失也会减少样本（`MISSING_FACTOR` / `FACTOR_VALUE_MISSING`）。

## 本 barrel 只供服务端使用

`resultWriter.ts` 依赖 `node:zlib`（写 gzip CSV 产物）。前端页面一律 `import type`
取类型 —— 运行时引本目录会把服务端代码拖进浏览器 bundle。
