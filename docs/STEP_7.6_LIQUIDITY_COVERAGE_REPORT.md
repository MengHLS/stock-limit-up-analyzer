# STEP 7.6 — 流动性覆盖报告（LIQUIDITY COVERAGE）

> 身份：Liquidity Data Engineer
> 结论：**CONDITIONAL PASS**（换手率/成交额/成交量可由 BaoStock 全量获得；市值受 provider 限制 → UNAVAILABLE，需补源或降级）

---

## 一、统一 LiquidityDaily 与单位归一

`schema.liquidity_daily` 字段与 canonical 单位：

| 字段 | 单位 | 说明 |
|------|------|------|
| turnoverRate | % | 换手率 |
| circulationMarketCap | 元 | 流通市值 |
| totalMarketCap | 元 | 总市值 |
| amount | 千元 | 成交额 |
| volume | 手 | 成交量 |

### Provider → canonical 换算系数（`LIQUIDITY_PROVIDER_SCALES`）

| Provider | turnoverRate | 市值 | amount | volume |
|----------|--------------|------|--------|--------|
| tushare-daily | UNAVAILABLE | UNAVAILABLE | 原样（千元） | 原样（手） |
| tushare-daily-basic | 原样（%） | 万元 → 元（×10000） | UNAVAILABLE | UNAVAILABLE |
| baostock-daily | 原样（%） | UNAVAILABLE | 元 → 千元（×0.001） | 股 → 手（×0.01） |

**铁律**：不可提供字段 = null + capability 表显式 `UNAVAILABLE`，禁止推导伪造（不用成交额反推市值、不用 0 填充）。

---

## 二、Provider 能力矩阵（实时探测 2026-09-06）

| 字段 | Tushare daily | Tushare daily_basic | BaoStock daily |
|------|---------------|---------------------|----------------|
| turnoverRate | ❌ | ✅（40203 限频） | ✅ |
| circulationMarketCap | ❌ | ✅（40203 限频） | ❌ UNAVAILABLE |
| totalMarketCap | ❌ | ✅（40203 限频） | ❌ UNAVAILABLE |
| amount | ✅（已有 stock_daily_prices） | ❌ | ✅ |
| volume | ✅（已有 stock_daily_prices） | ❌ | ✅ |

实时样本（BaoStock，平安银行 000001.SZ，2026-01-05 → 2026-09-04，164 行）：

```
tradeDate=2026-01-05  turnoverRate=0.4512%  amount=1,003,479.22 千元  volume=875,491.18 手
tradeDate=2026-09-04  turnoverRate=0.4197%  amount=969,948.44 千元   volume=814,372.95 手
circulationMarketCap=null  totalMarketCap=null  （BaoStock 无市值 → UNAVAILABLE）
```

---

## 三、按年覆盖度（2019–2026）

### 3.1 数据库现状

`liquidity_daily` 表**刚创建、尚未回填**，行数 = 0，故覆盖率为 0。下表为「回填能力」评估，非实测库内数据。

### 3.2 Provider 可提供的按年覆盖（能力评估）

| year | 换手率/额/量（BaoStock） | 市值（Tushare daily_basic） | 说明 |
|------|--------------------------|------------------------------|------|
| 2019 | ✅ 全市场 | ❌ 40203 不可批量 | BaoStock 全历史覆盖 SH/SZ |
| 2020 | ✅ 全市场 | ❌ | 同上 |
| 2021 | ✅ 全市场 | ❌ | 同上 |
| 2022 | ✅ 全市场 | ❌ | 同上 |
| 2023 | ✅ 全市场 | ❌ | 同上 |
| 2024 | ✅ 全市场 | ❌ | 同上 |
| 2025 | ✅ 全市场 | ❌ | 同上 |
| 2026（至 09-04） | ✅ 全市场 | ❌ | 同上 |

> 说明：
> - BaoStock 覆盖 **SH/SZ**（无北交所），约 5400 只，退市股历史含 `outDate`（survivorship-safe）；
> - 全市场 × 交易日网格的理论填充率 = 100%（BaoStock 每只有成交的股票每交易日都有 turn/amount/volume）；
> - **市值是最大 GAP**：Tushare daily_basic 提供但 1次/小时限频（全市场 × 多年 = 数十万请求，完全不可行）；BaoStock 无市值；AkShare 东财源本环境网络 FAIL（STEP 7.2）。

---

## 四、GAP 与建议

| GAP | 严重度 | 建议 |
|-----|--------|------|
| 市值无可用批量源 | **P1** | ① 评估 AkShare 东财源网络恢复；② Tushare 积分升级解除 daily_basic 限频；③ 降级为「月末快照 + 收盘价外推」并显式标注 retrieved_at |
| 北交所流动性缺失 | P2 | BaoStock 无 BJ，北交所 920 股需 Tushare daily（已有 amount/volume）+ 市值另寻 |
| 历史换手率口径 | P2 | 项目既有口径「成交额/流通市值×100」与交易所 turnover_rate 不同；两者都保留，禁止混用 |

---

## 五、结论

- 换手率 / 成交额 / 成交量：**BaoStock 可全量获得**（Primary），Tushare daily 的 amount/volume 已存在于 `stock_daily_prices` 可对照。
- 市值：**UNAVAILABLE（无批量源）** → 本步骤不伪造，标记 GAP。
- 覆盖报告机制：`computeLiquidityCoverageByYear` 已实现，回填后一键输出 year/trading_days/symbols/rows/coverage_ratio。
