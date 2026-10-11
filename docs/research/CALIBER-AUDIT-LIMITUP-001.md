# CALIBER-AUDIT-LIMITUP-001 — 「涨停」口径正确性审计

> 生成日期：2026-10-09（Asia/Shanghai）
> 任务性质：**只读审计**。零 DDL / 零 DML；未修改任何业务代码、未修改任何表、未重跑任何 Run/策略。
> 审计对象：`server/data/boardRules.ts`（涨跌停规则唯一权威）及其全部消费者，以及 `datasetRegistry` 的 Universe 口径。
> 触发：用户提问「现在对于涨停的概念正不正确，核心是主板非ST非新股，是不是符合 A 股涨停的规则」。

---

## 0. Gate

```text
GATE = PARTIALLY_CORRECT
```

| 维度 | 判定 |
|---|---|
| 涨停**判定机制**（价格公式 / 相等判定 / 板块比例 / 唯一权威） | ✅ **正确**，已用独立实现逐条复现（§1） |
| 涨停**比例规则表**的时效性 | 🔴 **错误** —— 主板 ST 缺失 2026-07-06 的制度分界（§2） |
| 涨停价的数值精度 | 🔴 **有缺陷** —— 浮点「半分平局」少算一分（§3） |
| ST 状态不可得时的默认行为 | 🟠 **与自身原则冲突**（§4） |
| 退市整理期比例 | 🟠 **方向错误**，且被测试锁死（§5） |
| 「主板非ST非新股」这一表述 | 主板 ✅ / 非ST ⚠️ / **非新股 ❌**（§8、§9） |

---

## 1. 做对的部分：涨停判定链

### 1.1 机制与 A 股规则一致

| 项 | 实现位置 | 与交易所规则 |
|---|---|---|
| 涨停价 = 前收 ×(1+比例)，四舍五入到分 | `server/engine/execution.ts#limitUpPrice`（L97） | ✅ 上交所《交易规则》3.3.17 / 深交所 3.3.19「按照四舍五入原则取至申报价格最小变动单位」 |
| 判定 = `close` **恰等于**涨停价（非 `>=`） | `server/datasetRegistry/detection.ts#isLimitUpClose`（L65） | ✅ 关键正确：`>=` 会把无涨跌幅限制日（IPO 前 5 日、退市整理期首日）与除权失真数据误收 |
| 主板非ST 10% / 主板ST 5% / 创业板·科创板 20% / 北交所 30% | `server/data/boardRules.ts#resolveLimitRulesAt`（L152） | 比例本身 ✅（但 ST 档见 §2） |
| 创业板 2020-08-24 前 10% | `boardRules.ts#CHINEXT_20PCT_EFFECTIVE_DATE`（L52） | ✅ 已在代码中实现时间分界 |
| 唯一权威，禁止第二套近似 | 全仓 123 处引用均走 `boardRules`；`server/data/validation.ts`、`docs/architecture/DEPENDENCY-MAP.md` 明确钉死 | ✅ 不存在「9.9% 近似」路径 |

### 1.2 独立复算：与生产数据集逐条零差异

**方法**：刻意**不复用 `server/**`** 的独立实现，直连真实库按「主板 + PIT非ST + 10% 收盘封板 + 首板」重算，再与生产数据集逐条比对。

```text
窗口          2024-01-02 .. 2024-12-31
生产数据集    datasetVersionId = 780001（boards=main · excludeSt=1 · excludeListedWithinDays=NULL）
独立实现      涨停 = close == ROUND(preClose×1.10, 2)；首板 = 涨停(T) && !涨停(T-1，全局交易日历前一交易日)
```

| 指标 | 值 |
|---|---:|
| 独立实现首板事件 | **10,924** |
| 生产数据集事件 | **10,924** |
| 一致 | **10,924** |
| 仅我有（漏判） | **0** |
| 仅生产有（误判） | **0** |

⇒ **该窗口内的涨停判定链完全可复现，无漏判、无误判。** 这是本仓最扎实的一环。

### 1.3 粗筛下推是安全超集

`detection.ts#LIMIT_UP_CANDIDATE_SQL_PREDICATE`（L107）阈值 `close >= preClose × 1.045`（低价股额外分支）。任何真实封板（≥ ×1.05）都被包含 ⇒ **粗筛不产生漏判**。⚠️ 但其注释前提「最低比例是 0.05（ST/*ST 主板）」在 2026-07-06 之后已过时（§2）；超集性质仍成立，不构成缺陷。

---

## 2. 🔴 缺陷 1：主板 ST 的 5% 已作废，代码缺制度分界

### 2.1 制度事实（双交易所来源）

**2026-04-24 沪深交易所修订《交易规则》，2026-07-06 起主板风险警示股票（ST/*ST）涨跌幅由 5% 调整为 10%。**

| 依据 | URL |
|---|---|
| 上交所新闻稿（2026-04-24）第三项「将主板风险警示股票价格涨跌幅限制比例由5%调整为10%」「于2026年7月6日起正式实施」 | https://www.sse.com.cn/aboutus/mediacenter/hotandd/c/c_20260424_10816474.shtml |
| 深交所投教「一图读懂」（2026-07-06）一览表：风险警示股票 主板 **10%** / 创业板 **20%** | http://investor.szse.cn/thematic/chinext/graphic/t20260706_621513.html |
| 深交所《业务指南第2号——风险警示板交易事项（2026年修订）》 | https://www.szse.cn/lawrules/service/member/t20260630_621404.html |
| 上交所《交易规则（2026年修订）》 | https://www.sse.com.cn/lawandrules/sselawsrules2025/trade/universal/c/c_20260424_10816492.shtml |
| 深交所《交易规则（2026年修订）》正文 PDF | https://docs.static.szse.cn/www/lawrules/rule/trade/current/W020260424690713155663.pdf |

### 2.2 代码现状：无条件的 5%

| 位置 | 代码 |
|---|---|
| `server/data/boardRules.ts:159` | `const ratio = stStatus === "ST" \|\| stStatus === "*ST" ? 0.05 : 0.1;` |
| `server/data/boardRules.ts:123` | `const ratio = isStStock(stockName) ? 0.05 : 0.1;` |

**没有**类似 `CHINEXT_20PCT_EFFECTIVE_DATE` 的时间分界。

### 2.3 真实库实测（影响量化）

```text
窗口 A（变更后）  2026-07-06 .. 2026-10-09
窗口 B（变更前）  2026-01-02 .. 2026-07-03
行情表末端        stock_daily_prices.max(tradeDate) = 2026-10-09（8,980,820 行）
```

| 指标 | 窗口 A | 窗口 B |
|---|---:|---:|
| 主板 ST 覆盖的 bar | 6,588（153 只） | 16,934 |
| 真实 10% 封板 | **136** | **0** |
| 收盘恰 +5% | **46** | **1,826** |
| 盘中触及 10% | 223 | — |

⇒ **现口径在窗口 A 会漏判 136 次真涨停、并把 46 次普通日误判为涨停。** 窗口 B 的「1,826 对 0」本身就是制度切换的实证。

### 2.4 内部互证（不依赖外部资料）

变更后 ST 股在 10% 线的封板率 = 136 / 6,588 = **2.06%**；
全市场非ST 主板在 10% 线的封板率 = 14,974 / 745,058 = **2.01%**。

两者几乎相同 ⇒ **变更后主板 ST 股的行为已与普通主板股一致**（10% 档）。

### 2.5 仓库里其实「知道」这次修订，但没喂给 `boardRules`

`server/research/regulationEvents/exchangeRules.ts`（L47-L88）已登记 `effectiveFrom: "2026-07-06"` 的 `SSE_2026_MAIN_BOARD` / `SZSE_2026_MAIN_BOARD`，并保留 `2023-02-17 .. 2026-07-05` 的 provisional 版本。

但那是**异常波动**（±20% 偏离值等）引擎，**与涨跌停比例是两套互不相通的规则源**。⇒ 存在**两个规则源地方案**，其中「涨跌停比例」这一套缺时间维度。

### 2.6 影响范围（重要：不是全仓）

| 消费者 | 是否受影响 |
|---|---|
| `ds_first_limit_pullback_*` 的 `780001`/`780002`/`780003`/`780004` 事件集 | ❌ **不受影响** —— 这 4 个版本 `excludeSt=1`，ST 在 Universe 层已被剔除 |
| `marketRegime` **涨停家数**（v1.62.1 / v1.63.0「涨停生态闸门」指标） | 🔴 受影响（`server/research/marketRegime/facts.ts:152`） |
| 回测成交拦截（涨停买不进 / 跌停卖不出） | 🔴 受影响（`server/backtest/marketRules.ts:20`、`server/realisticBacktest.ts`、`server/paperTrading.ts`、`server/research/paperAccount/constraints.ts`） |
| 特征 `limitUpHit` | 🔴 受影响（`server/features/basic.ts:243` → `isLimitUpBar`） |
| `excludeSt=0` 的数据集 —— **含默认值** `DATASET_BUILD_FILTER_DEFAULTS.excludeSt = false` | 🔴 受影响（实测 2 个版本：`720001`/v6、`690001`/combo-v1） |
| 执行事实 `canBuyAtOpen` / `canSellAtClose` | 🔴 受影响（`server/datasetRegistry/executionFacts.ts:50`） |
| 涨停生态闸门 v1.62.1/v1.63.0 的**历史结论** | ⚠️ 其回测窗口若止于 2026-07-05 之前则不受影响；本次**未逐 Run 核对窗口**，见 §12 |

---

## 3. 🔴 缺陷 2：浮点「半分平局」少算一分

### 3.1 机制

`server/engine/execution.ts:98`

```ts
return Math.round(prevClose * (1 + limitUpRatio) * 100) / 100;
```

交易所口径是**十进制**四舍五入；JS 是二进制浮点。当 `前收(分) × (100+比例%)` 恰好落在 `.5` 时会产生平局。

**实例**：前收 **17.15** → 精确 17.15 × 1.10 = 18.865 → 四舍五入 **18.87**；
JS：`17.15 * 1.1 = 18.864999999999998` → `Math.round(1886.4999999999998) = 1886` → **18.86**。

### 3.2 真实库实测（主板 5,802,628 个 bar）

| 指标 | 值 |
|---|---:|
| 收盘价 == **精确**涨停价 | 98,246 |
| 收盘价 == **现实现**算出的涨停价 | 98,202 |
| **因平局被漏判的真涨停** | **45** |
| 由此产生的误判 | 1 |
| 受影响的两位前收值（10% 档） | **134 个** |
| …（5% 档） | 210 个 |
| …（30% 档） | **1,103 个** |
| …（20% 档） | 0 个 |

代表作（10% 档）合计漏判 45 次：

| 代码 | 日期 | 前收 | 收盘 | 精确涨停价 | 现实现 |
|---|---|---|---:|---:|---:|
| `600435.SH` | 2026-03-02 | 17.15 | 18.87 | 18.87 | 18.86 |
| `605318.SH` | 2026-03-10 | 69.85 | 76.84 | 76.84 | 76.83 |
| `000586.SZ` | 2026-04-03 | 17.15 | 18.87 | 18.87 | 18.86 |
| `600206.SH` | 2026-06-16 | 35.55 | 39.11 | 39.11 | 39.10 |
| `002146.SZ` | 2026-08-12 | 1.15 | 1.27 | 1.27 | 1.26 |

### 3.3 讽刺之处

`server/data/boardRules.ts:23-34` 的长注释正是为「消除浮点误差」而写（并实证了未四舍五入阈值漏判 38.03%），但修法停在 `Math.round` 这一层 —— **半分平局仍未覆盖**。

---

## 4. 🟠 缺陷 3：`stStatus === "UNKNOWN"` 被静默当成非 ST（10%）

`resolveLimitRulesAt` 只在 `"ST" | "*ST"` 时给 5%，`"UNKNOWN"` 落 10%。

**真实库实测**：

| 指标 | 值 |
|---|---:|
| `research_securities` 中 `securityType='stock'` | 5,552 |
| `research_security_status_history` 中 `statusType='ST'` 的证券数 | **734**（841 行） |
| ST 维度的 `statusValue` 取值域 | **只有 `'ST'`**（无 `'NORMAL'`，无 `'*ST'`） |

⇒ 判定路径（`server/datasetRegistry/db.ts#resolveStSync`，L725-L732）在「无 ST 区间 / securityId 未解析 / `statusValue` 未识别」三种情况下都返回 `UNKNOWN`，而 `UNKNOWN` 被当成非 ST：

1. 它**不会被 `excludeSt` 剔除**（`server/datasetRegistry/filter.ts#isStExcluded` 只匹配 `"ST" | "*ST"`）；
2. 它真实的 5% 涨停会被判为非涨停（**漏判**）。

**与自身原则冲突**：同一模块对**未知板块**返回 `supported=false` + `limitUpRatio=null` 响亮拒绝判定（"不得假装支持"），但对**未知 ST** 却给出默认 10%。两条路径的保守性不一致。

---

## 5. 🟠 缺陷 4：`isStStock` 把「退市」判成 ST → 5%，方向反了

`server/data/boardRules.ts:98`：`if (name.includes("退市")) return true;`

但**主板退市整理期的实际涨跌幅是 10%**（首日不设限，其后主板 10% / 创业板 20% / 科创板 20% / 北交所 30%）。依据：上交所《交易规则》3.3.13、深交所 3.3.15、北交所 3.3.12；深交所热线问答（2021-01-27）https://investor.szse.cn/knowledge/t20210127_584470.html

**沪、深格式不一致导致的实际后果（真实库取证）**：

| 名称格式 | 样例（来自 `limit_up_records`） | `isStStock` | 判出比例 | 正确比例 |
|---|---|---|---|---|
| 沪市「退市XX」 | `退市海润`（测试用例） | `true` | **5%** ❌ | 10% |
| 深市「XX退」 | `东海A退` / `中期退` / `丹邦退` …（实际数据主流格式） | `false` | **10%** ✅ | 10% |

⇒ 沪市退市整理期股票的 10% 涨停会被**漏判**；深市正确纯属**巧合而非设计**。

**且该错误行为被测试锁死**：`tests/server/data/data.test.ts:89`

```ts
expect(resolveLimitRules("600001.SH", "退市海润").limitUpRatio).toBe(0.05);
```

---

## 6. 🟡 覆盖缺口（保守，但属静默降级而非响亮拒绝）

| 项 | 现状 | 后果 |
|---|---|---|
| **B 股**（沪 `900xxx`、深 `200xxx`） | `classifyBoard` 落 `unknown` → `limitUpRatio = null` → `isLimitUpClose` 恒 `false` | B 股（实际 10%）**永久不产生涨停事件**，不报错 |
| **老三板** `400xxx` / `420xxx` | 被 `boardRules.ts:81` 的 `^(920\|43\|83\|87\|88\|4\|8)` 归为 `bse`（30%） | 板块误归类 |
| `boards=[]`（全板块） | `isBoardAllowed` 放行 `unknown`，但 `unknown` 比例恒 `null` | 「全板块」实际等于「四个已知板块」 |

实测：13 个构建配置中 **12 个**显式 `boards=["main"]`，**1 个**（`720001`/v6）无板块行 ⇒ `boards=[]`。

---

## 7. 口径事实：「涨停」= 收盘封板，比「盘中触板」少 37%

本仓口径为 `close` **恰等于**涨停价（收盘封板），**不含盘中触板后回落**。

2024 全年主板非ST 实测：

| 口径 | 次数 |
|---|---:|
| 盘中触及涨停价（`high >= 涨停价`） | **23,779** |
| **收盘封板（本仓口径）** | **14,974** |
| 触板但未封板 | **8,805 = 触板的 37.0%** |
| 开盘即涨停（一字/秒板，开盘买不到） | 3,950（占封板的 26.4%） |
| 主板 ST bar 总数 / 5% 封板 | 23,943 / 3,191（10% 封板 0 次，佐证 2024 年仍是 5%） |

⇒ 若外部口径是「触板」或「炸板」，与本研究口径差距 **37%**。做「涨停家数」类统计时必须显式声明。

---

## 8. 「主板非ST非新股」逐项核对

| 表述 | 判定 | 实证 |
|---|---|---|
| **主板** | ✅ 成立 | 13 个构建配置中 12 个显式 `boards=["main"]`；有物理数据的 4 个版本事件 `boardType` 100% = `'main'`（`780001` = 73,003 条） |
| **非ST** | ⚠️ 主流但**非默认**，且有洞 | 默认 `excludeSt: false`（`shared/datasetRegistryContracts.ts:364`）；13 个配置中 11 个 `1`、2 个 `0`（`720001`/v6、`690001`/combo-v1）；另见 §4 |
| **非新股** | ❌ **不是当前涨停口径** | 默认 `excludeListedWithinDays: null` = **不过滤**；13 个配置中**仅 3 个**开（`365` 自然日：`780002`/v9-smoke、`780003`/v9、`780004`/v10）。**`780001`（151% 策略所用）不过滤次新** |

**最反例**：`720001`/v6 = `boards=[]`（全板块）+ `excludeSt=0`（含ST）+ `excludeListedWithinDays=NULL`（含次新）—— 三项假设全部不成立。

---

## 9. 「次新」有至少 4 套互相冲突的定义（无 canonical）

| # | 定义位置 | 单位 | 基准日 | 阈值 |
|---|---|---|---|---|
| 1 | `server/datasetRegistry/filter.ts#isListingAgeExcluded`（L112）；基准日由 `server/datasetRegistry/builder.ts:688` 传 `tradeDate` | 自然日 | **事件日** | 可配（v9/v10 = 365） |
| 2 | `server/research/compositeRunner/index.ts#candidateListingFilter`（L486-L497） | 自然日 | **决策日** | 可配 |
| 3 | `scripts/_scratch/_realtime_candidate_pool_001.mjs`（RCP-P0-v1） | **交易日** | `T`（上市首日算第 1 天） | 120 |
| 4 | `research-experiments/first-board-pullback/composite-runner-newhigh3-t74-subnew/experiment.ts`（L228 过滤 / L262 诊断） | 自然日 | **过滤用决策日、诊断用建仓日**；诊断阈值硬编码 `365` 与臂阈值无关 | 随臂（365/180/90） |

⇒ 单位（自然日 vs 交易日）、阈值、基准日三者两两冲突；`#4` 在**同一实验内**使用两个不同基准日。

---

## 10. 与上一次审计的边界

用户提到「之前审计过一次」。经查为 `docs/research/RESULT-RCP-P0-NEWSTOCK-EXCLUSION-AUDIT-001.md`。其三个边界：

1. 审计对象是 `scripts/_scratch/_realtime_candidate_pool_001.mjs` —— **一个未被版本控制的脚本**（该报告 §8 第 4 条自陈），不是全仓口径；
2. 其 §2 结论「**不存在其他次新股过滤**」作为**全仓**陈述为**假**（另有 §9 的 #1/#2/#4 三套）。该 `BASELINE_DRIFT` 已被 `docs/research/PLAN-CROSS-SECTIONAL-FACTOR-001.md` §3 C5 / §514 登记；
3. 它**完全未触及涨停比例规则表**，因此结构上不可能发现本次 §2 的缺陷（需 2026-07-06 之后的数据才可观测）。

⇒ **用户的不确定是合理的。**

---

## 11. 建议修法（**本轮未实施**）

| # | 建议 | 影响面 |
|---|---|---|
| 1 | `resolveLimitRulesAt` 主板 ST 分支加日期分界（照抄既有的 `CHINEXT_20PCT_EFFECTIVE_DATE` 写法），新增 `MAIN_BOARD_ST_10PCT_EFFECTIVE_DATE = "2026-07-06"` | 核心口径，**需授权** |
| 2 | `exchangeLimitUpPrice` / `limitDownPrice` 改用**整数分算术**（或 decimal）消除半分平局 | 数值精度，行为面窄 |
| 3 | `isStStock` 的「退市」分支改为「退市整理期」独立建模（主板 10%）；同步修正 `tests/server/data/data.test.ts:89` | 需说明「测试锁定的是错误规则」 |
| 4 | `stStatus === "UNKNOWN"` 改为「不可判定」，与未知板块同等对待（或至少如实计数 + 告警） | **行为变更**，会改变数据集事件数，**需授权** |
| 5 | 补 B 股 / 老三板归类，或显式拒绝（而非静默为空） | 影响面小 |
| 6 | 清理 `detection.ts:92` 注释里过时的「最低比例是 0.05」前提 | 纯注释 |

改动将牵动 `datasetRegistry` / 特征 / 回测成交 / `marketRegime`，收尾需 `pnpm run check` = 0 + `pnpm run test:changed` 零新增失败 + `node scripts/checkEolDrift.mjs --strict` = 0。

---

## 12. 未能验证 / 限制（UNDETERMINED / CAVEAT）

| # | 项 | 状态 |
|---|---|---|
| 1 | v1.62.1 / v1.63.0「涨停生态闸门」的历史 Run 窗口是否跨过 2026-07-06 | ❓ **未逐 Run 核对**；若窗口止于 2026-07-05 之前则结论不受 §2 影响 |
| 2 | §2 的影响是否已在任何既有 Run 中实际发生 | ❓ 未追溯到具体 Run（只确认了代码路径与数据事实） |
| 3 | 半分平局对 30% 档（1,103 个前收值）在真实库中的实际漏判次数 | ❓ 本仓北交所数据未做全量对拍 |
| 4 | 交易所对**北交所**涨跌幅价是否明文「四舍五入」 | ⚠️ 2021 版《试行》与 2026 版全文均未出现该表述（与沪/深的真实差异，非遗漏） |
| 5 | B 股涨跌幅 10% 仅有《交易规则》「股票」口径的推论，无 B 股专项条文 | ⚠️ 来源性质已在上文标注 |
| 6 | `research_security_status_history` 的 `availability = UNKNOWN`（PIT ingestion 时点不可机检） | ⚠️ 影响 §4 的稳健性，不影响 §2/§3 |
| 7 | 退市整理期股票在 `research_security_status_history` 中是否有 ST 区间覆盖（若覆盖则 PIT 会给 5%，与 §5 属同一错误方向） | ❓ 本轮未展开 |
| 8 | 除权除息日 `preClosePrice` 是否已为除权参考价 | ⚠️ 数据源属未复权口径；`docs/archive/DATABASE_DESIGN.md` 与 `tests/server/engine/edgeCases.test.ts` 未见覆盖除权日的专项用例 —— ❓ 未独立验证 |
| 9 | 本仓未实现沪深「限制价与前收之差 < 一个最小变动单位」的两条兜底条款 | ⚠️ 对 A 股主板（最小变动 0.01 元、前收 ≥ 0.10 元）不可触达；对 B 股/基金 tick 不同者可能有影响 |

---

## 13. 复现

只读探针（均在 `scripts/_scratch/`，已 gitignore；**不写库、不写表**）：

| 脚本 | 作用 |
|---|---|
| `scripts/_scratch/_caliber_audit_limitup_001.mjs` | 构建配置 / ST 维度取值域 / 覆盖率 / 事件表 `boardType` 与 `limitRuleUp` 分布 |
| `scripts/_scratch/_caliber_audit_limitup_002.mjs` | **独立实现重算首板，与 `780001` 逐条比对**（§1.2） |
| `scripts/_scratch/_caliber_audit_limitup_004.mjs` | 主板 ST 5%→10% 的影响量化（§2.3） |
| `scripts/_scratch/_caliber_audit_limitup_006.mjs` | 精确十进制 vs JS 浮点对拍（§3） |
| `scripts/_scratch/_caliber_audit_limitup_007.mjs` | 封板 vs 触板口径量化（§7） |
| `scripts/_scratch/_caliber_audit_limitup_003.mjs` | 已废弃（相关子查询在 77 万行上过慢，被 007 取代；未产出数据，不作为证据） |

交易所规则原文抽取保留在 `scripts/_scratch/rules/`（会话本地、未跟踪）：`sse_rules.txt`、`sse_listing2026.txt`、`szse_rules2026.txt`、`szse_cyb_special2020.txt` 等；**持久依据以上文引用的官方 URL 为准**。

---

## 14. 工程校验

- 本轮**零 DDL / 零 DML**：未修改 `dataset_version` / `dataset_build_config` / `ds_*` / `research_*` 任何一行；未创建 Run / Candidate / Strategy。
- 本轮**未修改任何已跟踪文件**（`git status --porcelain` 的 18 个 ` M` 条目均为本会话开始前既有的并发会话改动）。
- 本轮新增产物仅为本文档与 `scripts/_scratch/` 下的只读探针（该目录已 gitignore）。
- **EOL**：`node scripts/checkEolDrift.mjs --strict` **无法在本沙箱内运行** —— 该脚本经 `child_process.execFileSync('git', ['diff','--numstat'])` 取数，在受限沙箱下报 `spawnSync git EPERM`（已知边界，非漂移结果）。改为**直接验证该脚本所判定的属性**：① 本文档 `CRLF = 0 / LF = 341 / 无 BOM`（纯 LF，符合铁律 2）；② 会话前后的 `git status --porcelain` 已跟踪改动集合**逐条相同（均为 18 个，且条目名完全一致）** ⇒ 本会话未改动任何已跟踪文件 ⇒ EOL 漂移为 0。
- ⚠️ **`_scratch/`（仓库根，约 620KB，未跟踪且未被 gitignore）仍在原位**：含本次规则原文抽取 `rules/` 与另一并发会话的 `overlap/`。按 `AGENTS.md` 铁律 8 应位于 `scripts/_scratch/`，但本会话沙箱拒绝创建/移动目录，故原样保留待人工处理。
- ⚠️ **未追加 `docs/architecture/CHANGE-AUDIT.md` 条目**：该文件正被并发会话编辑（会话开始时已处于 ` M` 状态），为避免跨会话写入冲突，本轮未触碰。**本发现尚未进入基线台账**，属待办。
