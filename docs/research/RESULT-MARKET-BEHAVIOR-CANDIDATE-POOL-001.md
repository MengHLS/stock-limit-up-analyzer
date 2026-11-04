# RESULT-MARKET-BEHAVIOR-CANDIDATE-POOL-001

> **Gate：BEHAVIOR_POOLS_READY**
> 生成日期：2026-10-06（Asia/Shanghai）
> Base Universe：RCP-P0-v1（复用 RESULT-REALTIME-CANDIDATE-POOL-001 工件，未修改）
> 行情基准：datasetVersionId = 780001（只读坐标，未修改，未读取 ds_* 作为池输入）
> 信号时点：T 日收盘；Entry：T+1 Open（仅作可执行性审计，不参与入池）
> 复算脚本：scripts/_scratch/_behavior_pools_002.mjs（全程只读 SELECT；date-ordered + 61-bar rolling buffer）

## 0. 结论速览

| # | Behavior | Version | 候选行数 | 日频 P25/Median/P75 | T+1 可执行率* | 泄漏 | 重复 | Gate |
|---|---|---|---:|---|---:|---|---|---|
| 1 | BREAKOUT-CONTINUATION | BC-P0-v1 | 261,271 | 64 / 106 / 169 | 99.877% | 4/4 通过 | 0 | READY |
| 2 | PULLBACK-RESTART | PR-P0-v1 | 215,789 | 53 / 90 / 147 | 99.957% | 4/4 通过 | 0 | READY |
| 3 | VOLATILITY-CONTRACTION-BREAKOUT | VCB-P0-v1 | 35,666 | 4 / 10 / 20 | 99.905% | 4/4 通过 | 0 | READY |
| 4 | BASE-BREAKOUT | BB-P0-v1 | 42,802 | 6 / 15 / 26.5 | 99.904% | 4/4 通过 | 0 | READY |
| 5 | RELATIVE-STRENGTH-CONFLUENCE | RS-MKT-P0-v1 | 1,899,670 | 664 / 952 / 1,323 | 99.950% | 4/4 通过 | 0 | READY |

\* 可执行率 = 可执行 T+1 Open / 已核验候选；窗口最后一天（2026-09-04）的 T+1=2026-09-07 源覆盖不完整，其候选单列为 executabilityUnverified，不计入分母。

**关键结论：**

1. 5 个行为全部可严格定义、可实时（T 日收盘）计算；无 PIT 阻塞、无未来信息泄漏、无重复。
2. **板块数据不足**：industry_assignments 全表仅 2026-08-31 单时点快照（5,212 只、每只 1 行、effectiveFrom 全为 2026-08-31），不存在历史 PIT 板块归属；因此行为 5 按任务规则只实现「个股相对市场强势」（000300.SH），不输出任何板块字段（不伪造）。
3. 行为 4（BASE-BREAKOUT）的 60 日回看窗口内有 **23.40%** 候选含公司行为（除权/分红等）；因使用未复权价，平台高低点可能被 ex-date 扭曲。这是本轮最重要的残余风险（见第 7 节）。
4. 窗口起点存在 warm-up：stock_daily_prices 自 2019-01-02 起，无更早历史，因此 BC/PR/VCB 从 **2019-01-30** 起可产生信号（20 根 prior bar），BB 从 **2019-04-03** 起（60 根 prior bar），RS 从 **2019-01-03** 起。

## 1. Task / Baseline / Relevant Domains

**Task**：在 RCP-P0-v1 之上建立 5 个独立、可实时计算的市场行为候选池，作为后续 Research 统一入口；本轮只定义候选池，不做收益研究、不创建 Strategy、不做因子评分/TopN/Composite/Parameter Search/OOS/WFA、不修改 RCP-P0-v1、不修改 dataset v8。

**Baseline**：docs/architecture/SYSTEM-BASELINE.md v2.7.0（working tree；开工 git status --porcelain 显示并发会话未提交改动，本次未改任何已跟踪源码/契约/schema）。

**Relevant Domains**：

- Data：stock_daily_prices（T 及以前 OHLCV/amount）、index_daily（000300.SH 基准）。
- Base Universe：scripts/_scratch/_realtime_candidate_pool_001.json（RCP-P0-v1，只读复用）。
- 透明度审计：corporate_actions（ex-date 暴露统计，不参与筛选）。
- 未使用：ds_first_limit_pullback_*、limit_up_records、industry_assignments（数据不足）、任何 outcome / 未来收益 / 未来新高 / 未来成交量字段。

## 2. 统一基础与 PIT 口径

| 项 | 固定值 |
|---|---|
| Base Universe | RCP-P0-v1（4,859,017 条 security×tradeDate） |
| 窗口 | 2019-01-02 ～ 2026-09-04（1,863 个交易日） |
| 信号时点 | T 日收盘（所有条件只读 tradeDate <= T 的 bar） |
| Entry | T+1 Open（只做可执行性审计，不参与 T 日入池） |
| 价格 | stock_daily_prices 未复权 raw（与 RCP-P0-v1、仓库回测 RAW 口径一致） |
| 时间窗口 | 一律按该证券自身成交 bar 计（停牌日无 bar，不计入窗口） |
| 突破窗口 | 一律排除 T 日本身（用 T-1 及以前形成边界） |
| 基准 | index_daily.indexCode = 000300.SH（仅行为 5 使用） |

**字段与 PIT 时点（通用）**：所有派生字段（prior20High / prior60High / platformHigh / consolidationHigh / swingLow / swingHigh / 各类收益率 / 波动率 / 成交量均值）都只由 tradeDate <= T 的 bar 计算；T 日 bar 仅贡献自己的 O/H/L/C/V。每个行为 JSON 内都带 rowFields、behaviorDefinition、candidatePoolDefinition、boundaryRules、audits.pitProvenance。

## 3. 板块数据可用性结论（决定行为 5 的范围）

只读探针（industry_assignments）：

| 检查 | 实测 |
|---|---|
| 总行数 / 证券数 / 行业数 | 5,212 / 5,212 / 83 |
| effectiveFrom 取值范围 | 仅 2026-08-31 |
| effectiveTo | 全部 NULL（open-ended） |
| 每只证券行数 | 全部 = 1 |
| source | 全部 baostock |
| 2019-01-02 生效的行业归属 | 0 条 |
| 2026-09-04 生效的行业归属 | 5,212 条 |

**结论**：这是当前时点快照，不是历史时间序列，无法回填 2019-2026 的 PIT 板块归属；index_daily 也没有行业/板块指数（仅 000001.SH / 000300.SH / 000905.SH / 399001.SZ）。因此行为 5 只实现「个股相对市场强势」（RS-MKT-P0-v1），候选池不输出任何板块字段；这是任务允许并明确要求的 fallback，不构成 BLOCKED。

## 4. 各行为候选池

### 4.1 BREAKOUT-CONTINUATION — BC-P0-v1

**Behavior**：股票在 T 日向上突破近期关键高点，可能进入趋势延续阶段。

**Candidate Pool Definition**

- 属于 RCP-P0-v1；
- 结构窗口 = [T-20, T-1]（20 根 prior bar，排除 T 日）；
- prior20High = max(H over [T-20, T-1])；
- C_T > prior20High（收盘确认突破；因 H_T >= C_T，high 突破自动成立）；
- C_T > C_{T-1}；
- 不加入成交量、涨停、行业等任何额外条件。

**字段（PIT）**：close(T)、prevClose(T-1)、prior20High(<=T-1)、prior20CloseHigh(<=T-1)、prior60High(<=T-1，仅观察字段，缺失 null)、breakoutLevel(=prior20High)、breakoutDistance = C_T/prior20High - 1。

**边界规则**：严格 >（等于不算）；不足 20 根 prior bar 时不产生信号（warm-up）；prior60High 不参与入池；窗口按自身成交 bar 计。

| 统计 | 值 |
|---|---|
| 候选行 | 261,271 |
| 首候选日 / 首个可判定日 | 2019-01-30 / 2019-01-30 |
| 日频分布（全 1,863 日） | min 0 / P25 64 / Med 106 / P75 169 / max 2,928（2024-09-30）/ mean 140.24 |
| 日频分布（可判定 1,843 日） | min 7 / P25 65 / Med 107 / P75 169 / max 2,928 / mean 141.76 |
| 分年候选 | 2019: 32,967 / 2020: 34,007 / 2021: 34,107 / 2022: 29,386 / 2023: 29,718 / 2024: 37,121 / 2025: 38,492 / 2026: 25,473 |
| 泄漏 / 重复 | 4/4 采样日一致（62/110/182/104，对称差 0）/ 0 |
| T+1 可执行 | 260,846 可执行；321 无下一日 bar；0 Open 缺失；104 窗口边界不可核验，99.8771% |
| 公司行为暴露（20 日窗口） | 15,648 / 261,271 = 5.99% |

### 4.2 PULLBACK-RESTART — PR-P0-v1

**Behavior**：前期形成上涨结构，经历正常回撤后，T 日重新转强。

**Candidate Pool Definition**

- 属于 RCP-P0-v1；
- 结构窗口 W = [T-20, T-1]（20 根 prior bar）：swingLow = W 内最早最低 L；swingHigh = swingLow 之后最早最高 H；
- 上涨段：impulseReturn = swingHigh/swingLow - 1 >= 10%；
- 回撤：pullbackLow = min(L over (swingHigh, T-1])，pullbackDepth = 1 - pullbackLow/swingHigh >= 3%；
- 回撤不破结构：pullbackLow > swingLow；
- 关键价位：reclaimLevel = (swingHigh + pullbackLow)/2；
- T 日重新站回（一次性穿越）：C_{T-1} < reclaimLevel <= C_T、C_T > C_{T-1}、C_T <= swingHigh（仍属回撤后重启，不是创新高突破）；
- 不使用「未来会不会继续上涨」作为任何条件。

**字段（PIT）**：close(T)、prevClose(T-1)、impulseLow/impulseHigh(<=T-1)、impulseReturn、pullbackLow(<=T-1)、pullbackDepth、retraceRatio、reclaimLevel、reclaimDistance = C_T/reclaimLevel - 1、swingLowDaysAgo、swingHighDaysAgo。

**边界规则**：swingLow/swingHigh 取最早出现（严格比较）；swingHigh 落在 T-1 时无回撤空间，跳过；C_{T-1} 已在 reclaimLevel 之上时不是「重新站回」，跳过；C_T 直接越过 swingHigh 时归 BREAKOUT，PR 不收录；不足 20 根 prior bar 时不产生信号。

| 统计 | 值 |
|---|---|
| 候选行 | 215,789 |
| 首候选日 / 首个可判定日 | 2019-01-30 / 2019-01-30 |
| 日频分布（全 1,863 日） | min 0 / P25 53 / Med 90 / P75 147 / max 736（2019-03-11）/ mean 115.83 |
| 日频分布（可判定 1,843 日） | min 0 / P25 54 / Med 91 / P75 148 / max 736 / mean 117.09 |
| 分年候选 | 2019: 25,805 / 2020: 28,656 / 2021: 28,805 / 2022: 32,338 / 2023: 19,702 / 2024: 29,385 / 2025: 29,635 / 2026: 21,463 |
| 泄漏 / 重复 | 4/4 采样日一致（50/109/128/126）/ 0 |
| T+1 可执行 | 215,570；93 无下一日 bar；0 Open 缺失；126 边界不可核验，99.9569% |
| 公司行为暴露（20 日窗口） | 12,842 / 215,789 = 5.95% |

### 4.3 VOLATILITY-CONTRACTION-BREAKOUT — VCB-P0-v1

**Behavior**：上涨后出现缩量、波动收窄的整理，随后 T 日重新向上突破。

**Candidate Pool Definition**

- 属于 RCP-P0-v1；
- 前 20 日上涨阶段：stageReturn = C_{T-1}/C_{T-20} - 1 >= 5%；
- 整理窗口 recent = [T-5, T-1]，对比窗口 prior = [T-15, T-6]（均排除 T 日）；
- 波动收缩：volRecent/volPrior < 0.8（std of 日收益，volPrior > 0）；
- 缩量：mean(V, recent)/mean(V, prior) < 0.8（mean(V, prior) > 0）；
- 整理区上沿 consolidationHigh = max(H over recent)；
- T 日突破：C_T > consolidationHigh 且 C_T > C_{T-1}；
- 阈值（5% / 0.8 / 0.8 / 5 日 / 10 日）为先验固定，未按收益调整。

**字段（PIT）**：close(T)、prevClose(T-1)、stageReturn(<=T-1)、volRecent/volPrior/volRatio(<=T-1)、volumeMeanRecent/volumeMeanPrior/volumeRatio(<=T-1)、consolidationHigh(<=T-1)、breakoutDistance。

**边界规则**：volPrior == 0（完全无波动）时跳过；突破严格大于整理区上沿；不足 20 根 prior bar 时不产生信号。

| 统计 | 值 |
|---|---|
| 候选行 | 35,666 |
| 首候选日 / 首个可判定日 | 2019-01-30 / 2019-01-30 |
| 日频分布（全 1,863 日） | min 0 / P25 4 / Med 10 / P75 20 / max 1,087（2024-10-28）/ mean 19.14 |
| 日频分布（可判定 1,843 日） | min 0 / P25 4 / Med 10 / P75 21 / max 1,087 / mean 19.35 |
| 分年候选 | 2019: 3,586 / 2020: 3,675 / 2021: 3,795 / 2022: 3,822 / 2023: 3,546 / 2024: 9,298 / 2025: 4,866 / 2026: 3,078 |
| 泄漏 / 重复 | 4/4 采样日一致（3/11/19/6）/ 0 |
| T+1 可执行 | 35,626；34 无下一日 bar；0 Open 缺失；6 边界不可核验，99.9047% |
| 公司行为暴露（20 日窗口） | 1,807 / 35,666 = 5.07% |

### 4.4 BASE-BREAKOUT — BB-P0-v1

**Behavior**：长期横盘或弱势整理后，股票第一次脱离平台并形成向上突破。

**Candidate Pool Definition**

- 属于 RCP-P0-v1；
- 平台窗口 = [T-60, T-1]（60 根 prior bar，排除 T 日）：platformHigh = max(H)，platformLow = min(L)；
- 平台相对稳定：platformRange = platformHigh/platformLow - 1 <= 30%；
- 避免大涨后：platformReturn = C_{T-1}/C_{T-60} - 1 <= 20%；
- T 日向上突破此前平台高点：C_T > platformHigh 且 C_T > C_{T-1}；
- P0 只用价格结构，不加入市值/行业/成交量条件。

**字段（PIT）**：close(T)、prevClose(T-1)、platformHigh/platformLow/platformRange/platformReturn(<=T-1)、breakoutDistance = C_T/platformHigh - 1。

**边界规则**：平台边界全部由 T-1 及以前形成，T 日不参与平台计算；platformHigh 是窗口内最高 high，窗口内不可能已有 close 在其上，因此 T 日为 60 日窗口内首次 close 突破；platformRange > 30% 或 platformReturn > 20% 时跳过；不足 60 根 prior bar 时不产生信号。

**已知口径局限（P0 边界）**：本定义用 60 日区间 <=30% + 平台期漂移 <=20% 作为「稳定平台 / 非大涨后」的代理，不含 120 日等更长上下文；更长的「前期已大涨」排除逻辑留待后续版本（见第 7 节 R3）。

| 统计 | 值 |
|---|---|
| 候选行 | 42,802 |
| 首候选日 / 首个可判定日 | 2019-04-03 / 2019-04-03 |
| 日频分布（全 1,863 日） | min 0 / P25 6 / Med 15 / P75 26.5 / max 1,398（2024-09-30）/ mean 22.97 |
| 日频分布（可判定 1,803 日） | min 0 / P25 7 / Med 16 / P75 27 / max 1,398 / mean 23.74 |
| 分年候选 | 2019: 2,607 / 2020: 5,903 / 2021: 5,656 / 2022: 3,708 / 2023: 7,564 / 2024: 6,089 / 2025: 7,781 / 2026: 3,494 |
| 泄漏 / 重复 | 4/4 采样日一致（3/17/35/20）/ 0 |
| T+1 可执行 | 42,741；41 无下一日 bar；0 Open 缺失；20 边界不可核验，99.9042% |
| 公司行为暴露（60 日窗口） | 10,016 / 42,802 = 23.40%（最高，见第 7 节 R1） |

### 4.5 RELATIVE-STRENGTH-CONFLUENCE — RS-MKT-P0-v1

**Behavior**：个股自身走强，同时相对市场基准也走强，可能存在更强的延续性。

**Candidate Pool Definition**

- 属于 RCP-P0-v1；
- 市场基准：000300.SH（index_daily.close）；
- stockRet1 = C_T/C_{T-1} - 1 > 0（个股自身走强）；
- benchRet1 = bench_T/bench_{T-1} - 1；
- rs1 = stockRet1 - benchRet1 > 0（相对市场走强）；
- 观察字段 rs5 / rs20 = 个股 5/20 bar 收益减去同起止日期基准收益（不参与 P0 入池）；
- 板块条件：数据不足，未实现（见第 3 节），不输出板块字段。

**字段（PIT）**：close(T)、prevClose(T-1)、stockRet1(T)、benchRet1(T)、rs1(T)、rs5(<=T)、rs20(<=T)、benchClose(T)。

**边界规则**：基准缺失时跳过，不伪造；严格 >（stockRet1 == benchRet1 不算相对强势）；不足 1 根 prior bar 时不产生信号。

| 统计 | 值 |
|---|---|
| 候选行 | 1,899,670 |
| 首候选日 / 首个可判定日 | 2019-01-03 / 2019-01-03 |
| 日频分布（全 1,863 日） | min 0 / P25 664 / Med 952 / P75 1,323 / max 2,659（2024-04-17）/ mean 1,019.68 |
| 日频分布（可判定 1,862 日） | min 60 / P25 664.5 / Med 953 / P75 1,323 / max 2,659 / mean 1,020.23 |
| 分年候选 | 2019: 199,770 / 2020: 209,414 / 2021: 226,559 / 2022: 252,048 / 2023: 253,001 / 2024: 275,542 / 2025: 291,681 / 2026: 191,655 |
| 泄漏 / 重复 | 4/4 采样日一致（410/866/1774/1450）/ 0 |
| T+1 可执行 | 1,897,269；951 无下一日 bar；0 Open 缺失；1,450 边界不可核验，99.9499% |
| 公司行为暴露（1 日窗口） | 9,678 / 1,899,670 = 0.51% |

## 5. 汇总统计与工件清单

| Behavior | 文件 | 行数 | 字节 | sha256 | definitionHash |
|---|---|---:|---:|---|---|
| BC | scripts/_scratch/_behavior_breakout_continuation_001.json | 261,271 | 13,883,837 | 74d326d158707c40115e32ba95340a29f48921830e7418187687457cec594dd8 | sha256:3eb1645890a71b9c96ae301414bcb6f968bbe2cd446c74345d2d8967065363c8 |
| PR | scripts/_scratch/_behavior_pullback_restart_001.json | 215,789 | 18,339,268 | c382c0b4cdcba838853cadee1c2e0b73a335f5afd798c4d025d7398d040ce304 | sha256:c485086c13b5cba2abf05e87479e4071cf117cf32e576abc50f36ffd04fa2456 |
| VCB | scripts/_scratch/_behavior_contraction_breakout_001.json | 35,666 | 3,855,348 | e3792ae80408c019deb3e49e160f0c201e5b29a7a1286abaf452543f65dd8212 | sha256:f988d8879c1992888ab5ce55c1b60e57e982cdbe3dc434c148db4ee4159d0fa7 |
| BB | scripts/_scratch/_behavior_base_breakout_001.json | 42,802 | 2,762,982 | 98eaeac9ddaa6a90aeb3860dbc6882e5d950c7716c99deaa3afa2604d02d482d | sha256:a0c59dbda231736f0ad3bc223b32ef3519e7676b2b31a3cb6ed8e7525e15ccbb |
| RS | scripts/_scratch/_behavior_relative_strength_001.json | 1,899,670 | 146,970,443 | 69aff6488385f3f1657d0a30510d0e67e3c6ee76bf11049816a88e14747f52e9 | sha256:1c7203a59faef449e35bf9f6e3484ed4e40e1c020479c7540daa1b08ec153479 |

**编码**：每个 JSON 含 dates[]（1,863 日）、securities[]（3,486 个主板证券，[securityId, code]）、rowFields[]、rows[]（数组，按 rowFields 顺序）、dailyCounts[]（长度 1,863，与 dates 对齐）、distribution、yearlyStats、audits、gate。候选行可直接用 dates[dateIdx]、securities[securityIdIdx] 解码。

**跨行为关系**：5 个池相互独立，允许同日同一股票同时命中多个行为（这是设计语义，不是重复）；各池内 (tradeDate, securityId) 唯一。

## 6. 未来信息泄漏检查

**方法（truncated as-of replay）**：对 4 个采样日（2019-06-28 / 2021-06-30 / 2023-06-30 / 2026-09-04），只用 tradeDate <= T 的行情（窗口 = T-120 自然日 ～ T）重跑同一判定逻辑，与主流水线（全窗口 2019-01-02 ～ 2026-09-04）逐 securityId 对比；对称差必须为 0。

| Behavior | 2019-06-28 | 2021-06-30 | 2023-06-30 | 2026-09-04 | 结论 |
|---|---|---|---|---|---|
| BC | 62/62 | 110/110 | 182/182 | 104/104 | 通过 |
| PR | 50/50 | 109/109 | 128/128 | 126/126 | 通过 |
| VCB | 3/3 | 11/11 | 19/19 | 6/6 | 通过 |
| BB | 3/3 | 17/17 | 35/35 | 20/20 | 通过 |
| RS | 410/410 | 866/866 | 1,774/1,774 | 1,450/1,450 | 通过 |

**静态 PIT 声明**：所有条件只使用 stock_daily_prices（tradeDate <= T）、index_daily 000300.SH（tradeDate <= T）、RCP-P0-v1 的 T 日成员资格；未读取任何 outcome / 未来收益 / 未来新高 / 未来成交量 / limit_up_records / ds_* outcome / 首板 S RECLAIM 字段。T+1 Open 只出现在审计字段，不参与 T 日判定。

**结论**：未发现未来信息泄漏。

## 7. (tradeDate, securityId) 重复检查

| Behavior | 行数 | dailyCounts 合计 | 对账 | 采样日重复 | 结论 |
|---|---:|---:|---|---:|---|
| BC | 261,271 | 261,271 | 一致 | 0 | 无重复 |
| PR | 215,789 | 215,789 | 一致 | 0 | 无重复 |
| VCB | 35,666 | 35,666 | 一致 | 0 | 无重复 |
| BB | 42,802 | 42,802 | 一致 | 0 | 无重复 |
| RS | 1,899,670 | 1,899,670 | 一致 | 0 | 无重复 |

说明：采样日（2019-06-28 / 2021-06-30 / 2023-06-30 / 2026-09-04）逐日构建 securityId 集合，集合大小等于当日候选数；同一股票跨日重复出现是日频横截面设计语义。跨行为同日重复命中是设计允许的独立池关系。

## 8. T -> T+1 Open 可执行性

| Behavior | 候选行 | 可执行 T+1 Open | 不可执行 | 其中无下一日 bar | Open 缺失/非正 | 已核验可执行率 | 边界不可核验 |
|---|---:|---:|---:|---:|---:|---:|---:|
| BC | 261,271 | 260,846 | 321 | 321 | 0 | 99.8771% | 104 |
| PR | 215,789 | 215,570 | 93 | 93 | 0 | 99.9569% | 126 |
| VCB | 35,666 | 35,626 | 34 | 34 | 0 | 99.9047% | 6 |
| BB | 42,802 | 42,741 | 41 | 41 | 0 | 99.9042% | 20 |
| RS | 1,899,670 | 1,897,269 | 951 | 951 | 0 | 99.9499% | 1,450 |

**边界不可核验**指 2026-09-04 当日候选：其 T+1=2026-09-07，而 stock_daily_prices 在该日起源覆盖骤降至约 490 行/日（2026-09-04 为 5,548 行），因此无法核验，单列不计入分母。除此之外，所有候选都检查了「下一交易日同标的 bar + Open > 0」。

**不可执行的处理语义**：无下一日 bar（停牌/退市）是执行端的真实不可成交分支，应在回测/模拟器里显式处理，不能通过在 T 日池里用未来信息提前剔除。

## 9. 边界案例与极值日处理

**极值日（候选数最高，均为真实制度/行情事件，不是数据异常）：**

| Behavior | Top-1 | Top-2 | Top-3 |
|---|---|---|---|
| BC | 2024-09-30: 2,928 | 2024-10-08: 2,657 | 2024-09-27: 2,345 |
| PR | 2019-03-11: 736 | 2019-03-04: 678 | 2020-02-17: 672 |
| VCB | 2024-10-28: 1,087 | 2024-03-12: 639 | 2024-10-25: 625 |
| BB | 2024-09-30: 1,398 | 2024-09-27: 825 | 2024-10-08: 735 |
| RS | 2024-04-17: 2,659 | 2024-02-08: 2,626 | 2026-03-24: 2,557 |

**处理规则**：极值日代表「全市场同步突破/反转」，是本定义的真实行为结果；不做截尾、不做 TopN、不设上限，原始候选全部保留（由使用者自行决定是否做后续排序）。

**各行为边界规则摘要：**

- BC：严格大于；等于关键高点不算；不足 20 根 prior bar 不发信号；prior60High 仅观察。
- PR：swingLow/swingHigh 取最早出现；swingHigh 在 T-1 时无回撤空间；已站上 reclaimLevel 不算「重新站回」；T 日直接越过 swingHigh 归 BC。
- VCB：volPrior == 0 或无对比成交量时跳过；阈值先验固定（5% / 0.8 / 0.8 / 5 日 / 10 日）；突破严格大于整理区上沿。
- BB：平台边界只用 T-1 及以前；platformRange <= 30% 且 platformReturn <= 20%；首次 close 突破由窗口定义自动保证；不足 60 根 prior bar 不发信号。
- RS：基准缺失跳过；严格大于；板块字段缺省（数据不足），不伪造。

## 10. Impact

### 10.1 Contract Impact
无：不新增/修改 shared 契约、tRPC 路由、前端入口；不创建第二套 SoT；这些候选池是研究输入工件，不是 Strategy / Candidate / Run / Dataset Version，不占用 datasetVersionId。

### 10.2 DB Impact
零 DDL / 零 DML / 零 migration；全部只读 SELECT。未修改 RCP-P0-v1 工件；未修改 dataset v8（780001）或任何 ds_* / dataset_* 表；未导出凭据。

### 10.3 Execution Impact
无：不进入 Strategy Core / backtestCore / simulator / Parameter Search / OOS / WFA / Paper Trading 任何执行路径；T+1 Open 只做可用性审计，不新增撮合实现。

## 11. Tests / Verification

| 检查 | 命令 / 方式 | 结果 |
|---|---|---|
| 类型检查 | pnpm run check | 0 error（exit 0） |
| 行尾漂移 | node scripts/checkEolDrift.mjs --strict | 0 |
| 数据自检 | 脚本内建（as-of replay / 对账 / 采样去重 / T+1 可执行） | 全部通过 |
| JSON 有效性 | 独立解析 5 个工件 | 全部 JSON.parse 成功 |
| 交叉验证 | 同一窗口分别用 per-code 与 date-ordered 两套实现复算 | 5 个行为计数逐一完全一致（BC 4979 / PR 4770 / VCB 1140 / BB 375 / RS 32598） |
| 顶层对账 | 5 池合计 | 2,455,198 行 |

## 12. Baseline Update

无 baseline 文档更新：本任务不是实现细节变化、不是 Domain 状态跃迁、不新增 entry point / contract / 表 / 执行路径，按 AGENTS.md 第 8 节不更新 CHANGE-AUDIT / SYSTEM-BASELINE / system-manifest。本文件即研究工件本身。

## 13. Remaining Risks

| # | 风险 | 等级 | 处置 / 建议 |
|---|---|---|---|
| R1 | BB 60 日回看窗口的未复权价公司行为暴露 23.40%（BC/PR/VCB 约 5-6%，RS 0.51%）；ex-date 可能扭曲平台高低点 | 中 | 已按候选行统计暴露比例；后续可另开版本用「截至 T 的 forward-adjusted」价格重算（注意只用 <= T 的因子，禁止 back-adjustment 泄漏） |
| R2 | 板块映射/板块行情缺失，行为 5 只做市场相对强度 | 中 | 按任务 fallback 实现，不伪造；若后续补齐历史的 PIT 行业归属 + 板块行情，可另开版本 RS-SECTOR-P0-v1 |
| R3 | BB 的「避免大涨后」仅用 60 日区间 + 漂移代理，不含更长上下文 | 低-中 | 已显式登记为 P0 边界；可通过新版本增加 120 日上下文守卫，不修改本版本 |
| R4 | 窗口起点 warm-up：2019-01-02 起无更早行情，BC/PR/VCB 2019-01-30 前、BB 2019-04-03 前无候选 | 低 | 已在 distribution.firstEligibleDate 与分年统计中如实呈现；如需 2019 年初覆盖，需补 2018 年及更早行情 |
| R5 | 2026-09-04 的 T+1 Open 不可核验（源数据边界） | 低 | 单列 executabilityUnverified；等 2026-09-07 行情补齐后可复算 |
| R6 | 极端日候选数很高（BC 最高 2,928，BB 1,398，RS 2,659） | 低 | 这是全市场同步行为的真实结果；本任务不做 TopN/截尾，交由后续 Research 层处理 |
| R7 | 阈值（10%/3%、5%/0.8/0.8、30%/20%）为先验选择 | 低 | 均为固定圆整值，未按收益优化；如需敏感性分析，应作为独立 Research 任务，不在本任务内调参 |

## 14. Next Step

1. 以 5 个 JSON 为统一输入，进入后续 Research（TopN / Ranking / 组合）阶段；
2. 若需要入仓级可复现工件，将 scripts/_scratch/_behavior_pools_002.mjs 沉淀到 scripts/ 并登记 CHANGE-AUDIT（本任务未获授权，未做）；
3. 如需严格消除 R1（公司行为），另开版本使用 <= T 的 forward-adjusted 价格并逐行为重算；
4. 如需恢复行为 5 的板块维度，先补历史 PIT 行业归属与板块行情数据源，再另开版本。

## 15. Gate

BEHAVIOR_POOLS_READY

理由：

- 5 个行为定义明确、全部可实时（T 日收盘）计算；
- 未来信息泄漏：4/4 采样日 as-of replay 对称差全为 0；
- (tradeDate, securityId) 重复：5 个池全部为 0；
- T+1 Open 可执行率：99.877% / 99.957% / 99.905% / 99.904% / 99.950%，其余为无下一日 bar 的真实不可成交与窗口边界不可核验；
- 未修改 RCP-P0-v1 / dataset v8；未创建 Strategy / Candidate / 未运行 Backtest / 未做因子搜索或参数优化。

非阻塞警告：

- 行为 5 板块数据不足（industry_assignments 仅 2026-08-31 单时点快照），已按任务 fallback 实现 RS-MKT（市场相对强度），不输出板块字段；
- BB 公司行为暴露 23.40%（未复权价），已登记为残余风险 R1；
- 2026-09-04 的 T+1 Open 因源数据边界不可核验（每个行为 6-1,450 行）；
- 全部 T+1 不可执行均为无下一日 bar，0 例 Open 缺失/非正。
