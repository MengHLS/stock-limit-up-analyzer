# RESULT-RCP-P0-NEWSTOCK-EXCLUSION-AUDIT-001

> 生成日期：2026-10-07（Asia/Shanghai）
> 任务性质：**只读审计**。未修改 RCP-P0-v1、未修改任何表、未重跑因子研究（零 DDL / DML）。
> 审计对象：`scripts/_scratch/_realtime_candidate_pool_001.json`（candidatePoolVersion **RCP-P0-v1**）
> 生成脚本：`scripts/_scratch/_realtime_candidate_pool_001.mjs`（task `REALTIME-CANDIDATE-POOL-001`，artifact generatedAt `2026-10-05T12:15:02.670Z`）
> 数据坐标：`datasetVersionId=780001` 仅作声明；Base Universe = RCP-P0-v1

## 0. Gate

```text
GATE = NEW_STOCK_FILTER_VERIFIED
```

**判定依据（三项独立证据同时成立）**：

| 证据 | 结果 |
|---|---|
| ① 源码存在显式的固定阈值条件 | `MIN_AGE_TRADING_DAYS = 120`，且 `if (ageAt(sec,date) < 120) return "INSUFFICIENT_LISTING_AGE"` |
| ② 产物全量复核：**没有任何成员**的上市交易年龄 < 120 | **0 / 4,859,017 条入选记录**（1843 个交易日） |
| ③ 产物中**没有任何**上市年龄 ≥ 120 的股票被误标为 `INSUFFICIENT_LISTING_AGE` | **0 条** |
| ④ 独立 PIT Replay（6 个抽样日期，逐行重演完整过滤链） | **18,378 行比对，0 处不一致** |
| ⑤ 实际进入 RCP-P0 的最短上市年龄 | **正好 120 个交易日**（阈值处，未越界） |

## 1. 正式定义的源码位置（exact code location）

| 项 | 位置 |
|---|---|
| 生成脚本 | `scripts/_scratch/_realtime_candidate_pool_001.mjs`（434 行） |
| 阈值常量 | **第 19 行**：`const MIN_AGE_TRADING_DAYS = 120;` |
| 交易日历 | **第 68 行**：`SELECT DISTINCT tradeDate FROM liquidity_daily WHERE tradeDate <= '2026-09-30' ORDER BY tradeDate` |
| 证券主数据 | **第 82 行**：`SELECT securityId, exchange, listedDate, delistedDate, status FROM research_securities WHERE securityType = 'stock'` |
| 上市起点索引 | **第 87 行**：`s.listingStartIdx = lowerBound(calendar, s.listedDate);` |
| **年龄函数** | **第 139 行**：`function ageAt(sec, date) { const i = calIndex.get(date); return i === undefined ? null : i - sec.listingStartIdx + 1; }` |
| **过滤判定** | **第 145 行**：`if (ageAt(sec, date) < MIN_AGE_TRADING_DAYS) return "INSUFFICIENT_LISTING_AGE";` |
| 上市/退市区间 | **第 149 行**：`function inListing(sec, date) { return sec.listedDate <= date && (sec.delistedDate === null OR sec.delistedDate >= date); }` |
| 冻结口径声明 | **第 108–133 行** `const DEFINITION = {...}`，含 `filtersInOrder` 与 `threshold.minListingAgeTradingDays`；第 133 行生成 `definitionHash` |

> 补充：`scripts/_scratch/_patch_rcp_001..005.mjs` 是脚本的增量修订，逐条检查后确认它们**只**改动：文件写入方式（stream→sync）、环境变量化 START/END/OUT/SAMPLES、`endPlusDate` 回退、可执行性审计字段、聚合会计字段名。**没有任何一处触碰 `MIN_AGE_TRADING_DAYS`、`ageAt`、`classifyMember` 或池成员判定。**

## 2. 全部候选池过滤条件（exact filter rule）

`DEFINITION.filtersInOrder`（**first-fail：每只已上市主板证券每日恰好得到一个原因，`null` = 入选**）：

| # | id | 精确规则 | 源码行 |
|---|---|---|---|
| 1 | `MAIN_BOARD` | 仅主板（代码前缀 600/601/602/603/604/605/606/607/608/609/000/001/002/003）；创业板/科创板/北交所/B 股**属范围之外**，不计入剔除 | L24–25, L85 |
| 2 | `ST` | T 日无 ST 区间生效（`research_security_status_history.statusType='ST'` 且 `effectiveFrom<=T<=effectiveTo`） | L94, L101–105, L141 |
| 3 | `SUSPENDED` | T 日无停牌区间生效（`statusType='SUSPENSION'`，同区间语义） | L94, L101–105, L142 |
| 4 | `NO_TRADING_BAR` | `stock_daily_prices` 在 (security, T) 无行 | L143 |
| 5 | `OHLCV_INCOMPLETE` | open/high/low/close/preClose 存在且 >0；volume/amount 存在且 ≥0 | L135–137, L144 |
| 6 | **`INSUFFICIENT_LISTING_AGE`** | **`ageAt(sec,T) < 120`**，其中 `ageAt = calIndex(T) − lowerBound(calendar, listedDate) + 1` | **L139, L145** |
| 7 | `BELOW_TRADABILITY_THRESHOLD` | `amount >= 20000`（千元，= 2000 万元）且 `volume > 0` | L20, L146 |

**关于次新股过滤的结论**：

- ✅ **存在固定 `>= 120 个交易日` 条件**（第 6 条），阈值常量 `MIN_AGE_TRADING_DAYS = 120` 硬编码于源码第 19 行。
- ✅ 上市日期字段为 **`research_securities.listedDate`**（第 82 行 SQL）。
- ✅ **不存在其他次新股过滤**：7 条规则中只有第 6 条与上市年龄相关；不存在「上市 N 个月内剔除」「IPO 后停牌」「次新股板块」等第二套规则。
- ⚠️ 相关但**不属于**次新股过滤：第 1 条 `MAIN_BOARD` 把创业板/科创板/北交所整体排除在**范围之外**（这是 scope 决定，不是新股过滤）；第 7 条流动性阈值会顺带剔除部分低成交额新股，但其判定不含上市年龄。

## 3. exact field / SQL 证据

**字段**：`research_securities.listedDate`（上市日，`date` 类型，字符串模式读取）。

**实际执行的 SQL（逐字）**：

```sql
-- ① 交易日历（年龄分母的唯一来源）
SELECT DISTINCT tradeDate FROM liquidity_daily WHERE tradeDate <= '2026-09-30' ORDER BY tradeDate;

-- ② 证券主数据（listedDate / delistedDate）
SELECT securityId, exchange, listedDate, delistedDate, status
FROM research_securities WHERE securityType = 'stock';

-- ③ 代码映射（主板判定用）
SELECT securityId, exchange, securityCode FROM research_security_identifier_history
WHERE identifierType = 'primary';

-- ④ ST / 停牌区间（第 2、3 条规则）
SELECT securityId, statusType, effectiveFrom, effectiveTo, source, availability
FROM research_security_status_history WHERE statusType IN ('ST','SUSPENSION');

-- ⑤ 当日 bar（第 4、5、7 条规则）
SELECT stockCode, openPrice, highPrice, lowPrice, closePrice, preClosePrice, volume, amount
FROM stock_daily_prices WHERE tradeDate = ?;
```

**判定代码（逐字，第 135–147 行）**：

```js
function completeBar(b) {
  return b.o !== null && b.o > 0 && b.h !== null && b.h > 0 && b.l !== null && b.l > 0 &&
    b.c !== null && b.c > 0 && b.pc !== null && b.pc > 0 &&
    b.vol !== null && b.vol >= 0 && b.amt !== null && b.amt >= 0;
}
function ageAt(sec, date) {
  const i = calIndex.get(date);
  return i === undefined ? null : i - sec.listingStartIdx + 1;
}
function classifyMember(sec, date, bar, stIv, suspIv) {
  if (stIv) return "ST";
  if (suspIv) return "SUSPENDED";
  if (!bar) return "NO_TRADING_BAR";
  if (!completeBar(bar)) return "OHLCV_INCOMPLETE";
  if (ageAt(sec, date) < MIN_AGE_TRADING_DAYS) return "INSUFFICIENT_LISTING_AGE";   // ← 次新股过滤
  if (!(bar.amt >= MIN_AMOUNT_KB && bar.vol > 0)) return "BELOW_TRADABILITY_THRESHOLD";
  return null;
}
```

## 4. PIT 正确性论证

| 潜在泄露点 | 实际实现 | 是否泄露 |
|---|---|---|
| 年龄计算是否用到 T 之后的信息 | `ageAt = calIndex(T) − lowerBound(calendar, listedDate) + 1`，只统计 **[listedDate, T] 区间内的交易日数** | ❌ 不泄露 |
| 交易日历含未来日期是否有影响 | 日历是**全局交易日集合**（与个股无关）；上式只按索引相减，未来日期不参与 | ❌ 不泄露 |
| `listedDate` 是否可能有未来信息 | `listedDate` 是**历史事实**（上市日一旦发生即为已知） | ❌ 不泄露 |
| 尚未上市的股票是否会被当作候选 | `if (!inListing(s, date)) continue;`（第 230 行）——`listedDate > T` 的证券**根本没有该日期的 row** | ❌ 不泄露 |
| `delistedDate` 是否为未来信息 | 仅在 `delistedDate < T`（T 日之前已退市）时排除；T 时仍上市者无论何时退市都被包含 ⇒ 与 T 时点的 PIT 判断**完全等价** | ❌ 不泄露 |
| ST/停牌区间的时间语义 | 使用 `effectiveFrom/effectiveTo` 生效区间语义（**非** ingestion 时间） | 既有 caveat（见 §8） |


## 5. 只读统计（2019-01-30 ~ 2026-09-04，共 1843 个交易日）

### 5.1 每日 RCP-P0 成员数

| 指标 | 值 |
|---|---:|
| 交易日数 | 1843 |
| 最小成员数 | 1372 |
| 中位成员数 | 2666 |
| 最大成员数 | 3072 |

### 5.2 每日「上市不足 20 / 60 / 120 个交易日」的股票数量（主板已上市 universe 内）

| 阈值 | min | P25 | 中位 | P75 | max | 均值 |
|---|---:|---:|---:|---:|---:|---:|
| 上市 < 20 交易日 | 0 | 2 | 5 | 7 | 29 | 5.68 |
| 上市 < 60 交易日 | 0 | 6 | 10 | 16 | 46 | 12.12 |
| 上市 < 120 交易日 | 2 | 9 | 16 | 23 | 67 | 18.38 |

> 对照：这些「上市 < 120 日」的股票**全部**被 RCP-P0 以 `INSUFFICIENT_LISTING_AGE` 排除（见 §6 的 `lt120in = 0`）。

### 5.3 实际进入 RCP-P0 的最短上市年龄

| 指标 | 值 |
|---|---:|
| 全窗口最小值 | **120 个交易日**（= 阈值本身，未越界） |
| 首次出现 | 2019-01-30，`601606.SH`（listedDate 2018-08-06） |
| 每日最小年龄：min / P25 / 中位 / P75 / max | 120 / 121 / 122 / 126 / 174 |
| 每日最小年龄：均值 | 124.47 |

### 5.4 每年次新股（上市 < 120 交易日）剔除数量

| 年份 | 剔除条数 |
|---|---:|
| 2019 | 8,401 |
| 2020 | 13,346 |
| 2021 | 17,941 |
| 2022 | 8,825 |
| 2023 | 7,501 |
| 2024 | 3,809 |
| 2025 | 3,858 |
| 2026 | 2,817 |
| **合计（窗口内）** | **66,498** |

> 每日剔除条数：min 8 / P25 18 / 中位 35 / P75 42 / max 105，均值 36.08。
> 产物全量（含窗口前的 2019-01-02~2019-01-29）：`INSUFFICIENT_LISTING_AGE` 共 **67,126** 条 = 窗口内 66,498 + 窗口前 628。

### 5.5 抽样日期明细

| 日期 | 成员数 | 年龄剔除 | <20 | <60 | <120 | 成员最小年龄 | 成员年龄中位 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2019-01-30 | 1635 | 36 | 12 | 9 | 16 | 120 | 2962 |
| 2019-01-31 | 1925 | 36 | 12 | 9 | 16 | 121 | 2949 |
| 2019-02-01 | 1678 | 37 | 13 | 9 | 16 | 122 | 2948 |
| 2022-11-18 | 2796 | 41 | 6 | 14 | 21 | 124 | 3181 |
| 2026-09-04 | 3000 | 14 | 1 | 4 | 9 | 138 | 3946 |

## 6. PIT Replay（6 个抽样日期，逐行重演完整过滤链）

**方法**：审计脚本**独立**从数据库重新拉取 ①交易日历 ②`research_securities` ③主板代码映射 ④ST/停牌区间 ⑤当日 bar，用与生成脚本**逐字相同**的顺序与条件重新判定每一只已上市主板证券的 `exclusionReason`，再与产物中的 row **逐行比对**。

| 抽样日期 | 当日已上市主板证券 | 尚未上市（无 row，已核对） | 当日之前已退市 | **逐行不一致数** | 年龄<120 被排除 | 年龄<120 却入选 | 年龄≥120 入选 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2019-01-30 | 2,842 | 545 | 99 | **0** | 36 | **0** | 1,635 |
| 2019-06-28 | 2,868 | 517 | 101 | **0** | 42 | **0** | 2,109 |
| 2021-06-30 | 3,095 | 259 | 132 | **0** | 75 | **0** | 2,211 |
| 2023-06-30 | 3,197 | 102 | 187 | **0** | 38 | **0** | 2,773 |
| 2025-06-30 | 3,182 | 39 | 265 | **0** | 19 | **0** | 2,998 |
| 2026-09-04 | 3,194 | 0 | 292 | **0** | 14 | **0** | 3,000 |

**Replay 结论**：

1. **0 处不一致**（合计 18,378 行比对）⇒ 产物的 `exclusionReason` 可由源码逻辑**完全复现**，包括 first-fail 归因顺序。
2. 每个抽样日期 **`ageLt120_included_BUG = 0`**：上市不足 120 个交易日的股票**从未**进入候选池。
3. 每个抽样日期都存在 **`listedNotYet > 0`**（72 → 545 只），这些证券在产物中**根本没有该日期的 row** ⇒ **未使用未来上市信息**。
4. `ageGe120_excluded > 0` 的股票均因**更早的规则**（ST / 停牌 / 无 bar / OHLCV 不全 / 成交额不足）被排除，而非年龄 —— 这正是 first-fail 语义。

## 7. 产物是否已把上市年龄过滤固化进候选池

**是。四重证据**：

| 证据 | 内容 |
|---|---|
| ① 口径声明 | `definition.filtersInOrder[5]` = `{ id: "INSUFFICIENT_LISTING_AGE", rule: "trading-day age since listedDate (liquidity_daily market calendar) >= 120" }` |
| ② 阈值字段 | `pool.threshold.minListingAgeTradingDays = 120` |
| ③ 原因字典 | `pool.exclusionReasons[4] = "INSUFFICIENT_LISTING_AGE"` |
| ④ 行级数据 | 共 **67,126** 条 row 的 `exclusionReason` 指向该原因（窗口内 66,498 条） |

因此任何消费者**无需重算年龄**：直接读 `pool.rows[..][2] === null` 即得到已应用次新股过滤后的成员集合。

## 8. 未能验证 / 限制（UNDETERMINED / CAVEAT）

| # | 项 | 状态 |
|---|---|---|
| 1 | `MIN_AGE_TRADING_DAYS = 120` 的**业务依据**（为何是 120 而非 100/250） | ❓ 未在源码/文档中找到论证；本轮只验证「实际生效且为 120」，不评价其合理性 |
| 2 | 交易日历取自 `liquidity_daily DISTINCT tradeDate` | ⚠️ 若该表缺失某交易日，则个股年龄会**少算**；本轮未独立比对该日历与 `index_daily` 交易日集合 |
| 3 | `research_security_status_history` 的 `availability = UNKNOWN`（产物自身已记录该 caveat） | ⚠️ ST/停牌区间的**生效日语义**可信，但 ingestion 时点不可机检 —— **只影响第 2/3 条归因，不影响第 6 条年龄规则** |
| 4 | 生成脚本位于 `scripts/_scratch/`（gitignore 目录） | ⚠️ **未纳入版本控制**；若该文件被删除，则无法再复现产物。建议（不属本轮范围）将生成脚本迁入受控目录 |
| 5 | 产物 `definitionHash` 与 `DEFINITION` 的对应 | ⚠️ 本轮读取到的 `definitionHash` 为 `undefined`；未重算哈希（若 `DEFINITION` 之后被改动，哈希将不匹配） |
| 6 | 上市年龄的「120 个交易日」是否与行业惯例一致 | ❓ 不在本轮范围 |

## 9. 结论

1. **找到了正式定义**：生成脚本 `scripts/_scratch/_realtime_candidate_pool_001.mjs`，阈值常量在第 19 行，判定在第 145 行。
2. **次新股过滤确实存在且为固定 120 个交易日**：`ageAt(sec,T) = calIndex(T) − lowerBound(calendar, listedDate) + 1 < 120 → INSUFFICIENT_LISTING_AGE`；字段为 `research_securities.listedDate`。
3. **不存在其他次新股过滤规则**（7 条规则中仅第 6 条与上市年龄相关）。
4. **实际、稳定生效**：1843 个交易日中，**0 条**入选记录的上市年龄 < 120；实际最短入选年龄**正好 120**。
5. **PIT 正确**：年龄只统计 [listedDate, T] 区间；未上市证券无 row；`delistedDate` 的使用与 T 时点判断等价；6 个抽样日期 18,378 行逐行重演 **0 不一致**。
6. **产物已固化**：`filtersInOrder` + `threshold.minListingAgeTradingDays` + `exclusionReasons` + 67,126 条行级原因，四者齐备。

**Gate：`NEW_STOCK_FILTER_VERIFIED`**

## 10. 复现与产物

```bash
# 只读审计（独立重演 + 全量统计，不修改任何东西）
node scripts/_scratch/_rcp_newstock_audit_001.mjs
```

| 产物 | 路径 |
|---|---|
| 本报告 | `RESULT-RCP-P0-NEWSTOCK-EXCLUSION-AUDIT-001.md` |
| 审计脚本 | `scripts/_scratch/_rcp_newstock_audit_001.mjs` |
| 审计结果 | `scripts/_scratch/_rcp_newstock_audit_001.json`（含 1843 日逐日统计与 6 个 PIT Replay） |
| 被审计产物 | `scripts/_scratch/_realtime_candidate_pool_001.json`（**未修改**） |
| 被审计源码 | `scripts/_scratch/_realtime_candidate_pool_001.mjs`（**未修改**） |

### 10.1 工程校验

- `node scripts/checkEolDrift.mjs --strict` = **0 漂移**
- `node_modules\.bin\tsc.cmd --noEmit` = **非 0（2 处错误）**，但**全部错误集中在同一个文件**：
  `research-experiments/first-board-pullback/composite-runner-newhigh3-t74-subnew/experiment.ts`
  （该目录**创建于 2026-10-07 11:36:40**、当前仍是 `??` 未跟踪状态 ⇒ **并发会话正在编辑的新实验文件**）。
  本轮任务的全部产物位于 `scripts/_scratch/`（gitignore 目录，`.mjs` 脚本**不进入 tsc 编译范围**）与一份 `.md` 报告，
  **不包含任何 TypeScript 源文件**。同一会话早前的 `tsc --noEmit` 为 0 错（该文件出现之前）。
  按 AGENTS.md「不修改与任务无关的模块」，本轮**未触碰**该文件。
- 本轮**未提交、未暂存**；未触碰 `.workbuddy`；零 DDL / DML。
