# STEP 7.6 — Historical Industry / Index / Liquidity 数据基础设施实现报告

> 身份：Quantitative Market Data Architect + Historical Industry / Index / Liquidity Data Engineer + Point-in-Time Data Auditor
> 完成时间：2026-09-06
> 结论：**CONDITIONAL PASS**（结构完成；数据覆盖依赖后续回填，已如实标注 GAP）

---

## 一、范围与边界

本步骤只做 **Data Infrastructure**，未实现任何 Strategy / Factor / Backtest / Portfolio / Risk / WFO / OOS / Ensemble / Paper Trading / Live Trading。

交付四类数据基础设施：

1. **Historical Industry**（历史行业归属，as-of 可查）
2. **Index Master + Index Daily**（指数身份 + 指数日线）
3. **Liquidity / Daily Basic**（换手率 / 流通市值 / 总市值 / 成交额 / 成交量）
4. **Market Breadth Foundation**（市场宽度基础：指数基准 + 流动性 + 成交量，供下游构建宽度指标，本步不实现宽度指标本身）

---

## 二、产出文件

### 2.1 核心领域层 `server/marketData/`

| 文件 | 职责 |
|------|------|
| `types.ts` | 统一领域类型 + `DataAvailability` 三态（AVAILABLE / UNAVAILABLE / UNKNOWN）+ 流动性单位常量 |
| `pointInTime.ts` | effective_date / available_at / retrieved_at 语义，UNKNOWN 标记，时间一致性校验 |
| `industry.ts` | `getIndustryAt(securityId, date)` as-of 解析、区间校验、区间重叠检测 |
| `indexes.ts` | 指数代码规范化（000→SH / 399→SZ）、指数身份校验 `verifyIndexIdentity` |
| `liquidity.ts` | 多 provider 单位归一化、UNAVAILABLE 显式化、多源合并 `mergeLiquidity` |
| `coverage.ts` | 指数覆盖度 / 流动性按年覆盖度计算 |
| `index.ts` | 统一出口 |

### 2.2 Provider Adapter `server/marketData/providers/`

| 文件 | 职责 |
|------|------|
| `types.ts` | provider-neutral 接口（IndexProvider / LiquidityProvider / IndustryProvider） |
| `tushare.ts` | Tushare index_daily / daily_basic（HTTP，含 40203 限频识别） |
| `sina.ts` | Sina 指数日线 + 实时行情身份反查（含 000300 身份疑点校验） |
| `baostock.ts` | BaoStock 指数日线 + 个股流动性（Python bridge） |
| `akshare.ts` | AkShare 申万一级行业 + 成分（Python bridge） |
| `pythonBridge.ts` | Python 子进程桥接 |
| `index.ts` | 统一出口 + provider 注册表 |

### 2.3 Python bridge 脚本 `scripts/providers/`

| 文件 | 职责 |
|------|------|
| `baostock_probe.py` | index_daily / stock_daily / stock_basic 命令 |
| `akshare_sw_probe.py` | industries / members 命令 |

### 2.4 数据库 Schema

在 `drizzle/schema.ts` 新增 4 张表，迁移 SQL 见 `drizzle/0016_market_data_infra.sql`：

| 表 | 关键字段 |
|------|------|
| `industry_assignments` | securityId, industryCode, industryName, effectiveFrom, effectiveTo, source, retrievedAt（唯一键 securityId+effectiveFrom） |
| `index_master` | indexCode, indexName, provider, providerCode, firstDate, lastDate, source（唯一键 indexCode+provider） |
| `index_daily` | indexCode, tradeDate, open/high/low/close/amount/volume, source（唯一键 indexCode+tradeDate） |
| `liquidity_daily` | securityId, tradeDate, turnoverRate, circulationMarketCap, totalMarketCap, amount, volume, source（唯一键 securityId+tradeDate） |

> 单位约定（canonical）：price 点/元、amount **千元**、volume **手**、turnoverRate **%**、市值 **元**。

---

## 三、核心语义决策

### 3.1 历史行业 ≠ 当前行业（禁止回填）

行业归属以带有效期的区间表达（effectiveFrom 含 / effectiveTo 含，null = 至今）。`getIndustryAt` 严格按 as-of 解析；区间重叠时**抛错**而非静默挑一个。

### 3.2 指数身份校验（不硬编码）

`verifyIndexIdentity` 三级结论：
- **PASS**：code/name/startDate 与权威参考一致
- **CONCERN**：名称不符、数据早于官方发布日、数据早于基期
- **BLOCKED**：指数身份完全无法确认（未知代码）

关键事实：沪深300 基期 2004-12-31、首发 2005-04-08，故任何 2002 起的数据（Sina）都会触发 `DATA_BEFORE_BASE` 强告警——**不得把「000300」直接当作「沪深300 完整历史」**。

### 3.3 流动性 UNAVAILABLE 显式化

某 provider 无法提供的字段 → `null` + capability 表声明 `UNAVAILABLE`，禁止推导/填 0/近似。`mergeLiquidity` 只在字段为 null 时用后序 provider 补齐，不覆盖已有值，并保留 per-field 来源。

### 3.4 Point-in-Time

严格区分 effective_date / available_at / retrieved_at。发布时点无法确定时标记 **UNKNOWN**（availableAt = null），不强行假设 T+1。

---

## 四、测试（全部通过）

`server/marketData/*.test.ts` + `providers.test.ts` 共 6 文件 **68 测试全通过**，覆盖 spec §11 全部项：

- industry as-of（边界含端点、null 截止、重叠抛错、跨证券隔离）
- industry interval（升序、重叠检测、from>to）
- index mapping（000→SH / 399→SZ / 幂等 / 非法抛错）
- index identity（PASS / 名称不符 / 早于发布日 / 早于基期 / BLOCKED）
- liquidity mapping + unit normalization（万元→元 ×10000、元→千元 ×0.001、股→手 ×0.01、NaN→null）
- point-in-time（VALID / UNKNOWN / 时间倒挂 / 非法日期）
- duplicate（指数日线重复抛错）
- missing date（指数覆盖缺失日期计算）

验证：

- `npx tsc --noEmit`：`server/marketData/` 0 错误（其余错误来自并行进行的 STEP 7.3/7.4/7.5 目录 `server/backfill`/`server/backtest`/`server/research/framework`）
- `npx vitest run server/marketData`：68 passed / 0 failed
- 全量 `npx vitest run`：**1010 passed / 15 failed**，15 失败精确命中历史环境基线（customSector=1、watchStatus=4、marketData=4、sync page=2、token=1、tushare calendar=3），**新增回归 = 0**

---

## 五、实时探测结论（provider 能力实测）

| Provider | 指数 | 流动性 | 行业 | 状态 |
|----------|------|--------|------|------|
| Tushare | index_daily = 40203（1次/小时） | daily_basic = 40203（1次/小时） | — | 仅限定点低频 |
| Sina | ✅ 可用（但 datalen 上限截断历史） | — | — | 身份需校验 |
| BaoStock | ✅ 全历史（自基期） | ✅ turn/amount/volume | — | 无市值 |
| AkShare SW | — | — | ✅ 31 个申万一级（当前快照） | 无历史有效期 |

详细见对应覆盖报告。

---

## 六、完成标准判定

| 项 | 判定 |
|----|------|
| 结构完成（schema + domain + adapter + 测试） | ✅ PASS |
| 数据覆盖 | ⚠️ 需后续回填（本步不执行全量回填） |
| 关键 identity 确认 | ✅ 已建立校验机制（CONCERN/BLOCKED），无伪造 |

**最终结论：CONDITIONAL PASS。** 结构层完成且测试通过；历史数据覆盖由后续回填步骤补齐，所有 GAP 已在对应覆盖报告中如实标注。

---

## 七、后续建议（不回填，仅建议）

1. **指数**：以 BaoStock 为 Primary（全历史），Sina 为名称/身份交叉验证；Tushare index_daily 仅作低频抽查（40203）。
2. **历史行业**：AkShare SW 仅当前快照，需另寻历史成分有效期来源（如申万官方历史成分表 / Tushare 概念分类），否则历史行业归属只能用「快照日」构建单点区间并标注 retrieved_at。
3. **市值**：Tushare daily_basic 提供但 1/h 限频（全市场 5400 股 × 历史不可行）；BaoStock 无市值。需评估 AkShare 东财源（本环境网络 FAIL，见 STEP 7.2）或降级为「市值 = 快照 + 日频收盘价外推」并显式标注。
4. **迁移**：`drizzle/0016_market_data_infra.sql` 需在确认迁移漂移状态后通过 `drizzle-kit migrate` 或手动应用。
