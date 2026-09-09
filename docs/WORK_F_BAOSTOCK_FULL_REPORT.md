# WORK F（补全）— BaoStock 指数日线全历史回填报告

> STEP 12 数据地基 · F 域（index_master + index_daily）
> 执行日期：2026-09-06
> 前置：WORK F 首轮用 Sina 源回填了 4 只核心指数，但 Sina 仅覆盖最近约 1023 个交易日（2022-06-22 起），2019-2022 存在缺口；Tushare `index_daily` 限频（5 次/天 + 1 次/分钟）。本轮改用 **BaoStock（免费无配额）** 补齐 2019-2022 缺口。

## 1. 结论摘要

- 用 BaoStock 将 4 只核心指数 `index_daily` 从 **4092 行（Sina，2022-06-22 ~ 2026-09-04）** 补全到 **7452 行（BaoStock，2019-01-02 ~ 2026-09-04）**，覆盖 2019-2026 全历史。
- **Sina/BaoStock 冲突处理策略：BaoStock 全量覆盖 Sina**（复用 `upsertIndexDaily` 的 `ON DUPLICATE KEY UPDATE`，同 `(indexCode, tradeDate)` 已存在时以 `source=baostock` 覆盖）。理由见 §4。
- 4 只指数 `index_master` 新增 baostock 记录（名称/代码/交易所/日期范围完整）；因唯一约束为 `(indexCode, provider)`，原 sina 记录保留（多 provider 并存是 schema 设计使然）。
- 全部 4 指数 `amount`/`volume` 均非 null（BaoStock 提供真实成交额/量，补齐了 Sina `amount` 恒 null 的缺陷）。

## 2. 改动文件清单

| 文件 | 说明 |
| --- | --- |
| `scripts/backfillIndex.ts` | 扩展回填 CLI：provider 感知的 `providerCode`/`source`（新增 `providerCodeFor`/`providerSource`，修复 baostock 误写 `indexCode`/`tushare index_daily` 的问题）；新增 `--force` 标志；resume 跳过逻辑改为**区间感知**（`isCoverageComplete`：首日不晚于 start+30 天 且 末日距 end ≤30 天 才跳过），使缺口（如 Sina 仅 2022 起）不再被误判为「已回填」 |
| `server/marketData/providers.test.ts` | 补齐 2 个测试：4 个核心指数 `toBaostockCode` 映射（sh.000001 / sz.399001 / sh.000300 / sh.000905）、`parseBaostockIndexDaily` 的 source=baostock + 空字段转 null |
| `docs/WORK_F_BAOSTOCK_FULL_REPORT.md` | 本报告 |

未改动任何现有逻辑：`fetch`/`parse`（`baostock.ts`、`sina.ts`、`tushare.ts`）、`indexStorage.ts`、`types.ts`、OHLCV `stock_daily_prices` 均未触碰。`upsertIndexDaily` 的幂等覆盖语义直接复用，无需改代码。

## 3. 真实 DB 验证结果

### index_daily 各指数覆盖（SQL 直查）

| indexCode | rows | 日期范围 | source | amount null | volume null |
| --- | --- | --- | --- | --- | --- |
| 000001.SH | 1863 | 2019-01-02 ~ 2026-09-04 | baostock | 0 | 0 |
| 399001.SZ | 1863 | 2019-01-02 ~ 2026-09-04 | baostock | 0 | 0 |
| 000300.SH | 1863 | 2019-01-02 ~ 2026-09-04 | baostock | 0 | 0 |
| 000905.SH | 1863 | 2019-01-02 ~ 2026-09-04 | baostock | 0 | 0 |

`index_daily` 总行数：**7452**（= 4 × 1863）。

### 缺口补齐量化

| 项 | 值 |
| --- | --- |
| 回填前 index_daily 行数 | 4092（4 × 1023，source=sina） |
| 回填后 index_daily 行数 | 7452（4 × 1863，source=baostock） |
| 新增行（2019-01-02 ~ 2022-06-21 缺口） | 840 行/指数，共 3360 行 |
| 覆盖行（2022-06-22 ~ 2026-09-04，sina→baostock） | 1023 行/指数，共 4092 行 |

### index_master 明细（新增 baostock 记录）

| indexCode | indexName | provider | providerCode | firstDate | lastDate |
| --- | --- | --- | --- | --- | --- |
| 000001.SH | 上证指数 | baostock | sh.000001 | 2019-01-02 | 2026-09-04 |
| 399001.SZ | 深证成指 | baostock | sz.399001 | 2019-01-02 | 2026-09-04 |
| 000300.SH | 沪深300 | baostock | sh.000300 | 2019-01-02 | 2026-09-04 |
| 000905.SH | 中证500 | baostock | sh.000905 | 2019-01-02 | 2026-09-04 |

> 唯一约束 `uq_index_master_code_provider(indexCode, provider)` 允许多 provider 并存，故原 4 条 sina 记录保留（2022-06-22 起），与 4 条 baostock 记录共 8 行。`index_daily` 本身唯一约束是 `(indexCode, tradeDate)`，单一 source，已被 baostock 统一覆盖。

### 抽样（000001.SH，真实值，单位已归一）

- `2019-01-02` close=**2465.291**（上证指数 2019 年初约 2465 点，合理）amount=97592573.952（千元）volume=109932014.08（手）source=baostock
- `2019-01-08` close=2526.462
- `2022-06-22`（原 Sina 覆盖日）close=3267.2016 amount=440850994.2562 source=**baostock**（原 sina 此日 amount 为 null，现为真实值，验证覆盖生效）

### 幂等 / resume 验证

复跑 `--provider=baostock --start=2019-01-01 --end=2026-09-04` 输出 `Checkpoint=4`（4 只全部跳过，`Requested=4 Received=0 Persisted=0`），确认区间感知 resume 判定正确、重复跑不产生重复行。

## 4. Sina/BaoStock 数据冲突处理策略说明

**选择：BaoStock 全量覆盖 Sina。**

唯一约束为 `uq_index_daily_code_date(indexCode, tradeDate)`，Sina 与 BaoStock 在同日期会冲突。决策理由：

1. **数据质量**：BaoStock 免费且覆盖全历史，单位口径明确（`volume=股→手 ×0.01`、`amount=元→千元 ×0.001`，`baostock.ts` 已归一）；Sina 仅最近 1023 个交易日且 `amount` 恒 null、`volume` 口径待核。
2. **统一 source**：覆盖后 `index_daily` 单一 source=baostock，避免同一指数混有两种来源、下游需要分支判断。
3. **实现零成本**：`upsertIndexDaily` 已实现 `ON DUPLICATE KEY UPDATE`（含 `source` 字段），直接复用即可覆盖，无需新增"只插缺失"的过滤逻辑。

实施方式：直接以 `--provider=baostock --start=2019-01-01 --end=2026-09-04` 跑全区间，BaoStock 返回 1863 行/指数，其中 840 行新增、1023 行覆盖原 Sina。若未来需要"仅补缺失、保留 Sina"，可改为在插入前按 `getIndexDailyCoverage` 的已有日期集合过滤，但当前不采用（BaoStock 更优）。

## 5. 剩余 gap

1. **首个交易日**：`start=2019-01-01` 为元旦休市，真实数据首日为 `2019-01-02`（非 gap，属正常日历）。
2. **指数起始历史（1990/2004/2007 发布前）**：本次按需求只补 2019-01-01 起；若需更长历史（如 000300 自 2005-04-08、000001 自 1991），BaoStock 可继续向前拉，但非本轮验收范围。
3. **index_master 双 provider 并存**：sina 记录（2022-06-22 起）与 baostock 记录（2019-01-02 起）共存，属 schema 设计允许（多 provider）；下游按 `indexCode` 取数时需注意可能有多条 master 记录（建议以 provider=baostock 为准）。
4. **BaoStock 无指数名称返回**：`fetchBaostockIndexIdentity` 返回 `indexName=""`，CLI 通过 `CORE_INDEX_IDENTITY` 参考表补全名称（上证指数/深证成指/沪深300/中证500），身份校验 `verifyIndexIdentity` 全部 PASS。

## 6. 验收核对

- [x] `npm run check`（`tsc --noEmit`）通过
- [x] 新增测试通过（`providers.test.ts` 13/13、`indexStorage.test.ts` 8/8）
- [x] 真实 DB `index_daily` 覆盖 2019-2026（4 指数各 1863 行，2019-01-02 ~ 2026-09-04），2019-2022 缺口补齐
- [x] `index_master` 4 指数记录完整（名称/交易所/ provider/日期范围）
- [x] 输出本报告
- [x] 未破坏 fetch/parse/indexStorage 现有逻辑、未动 OHLCV
- [x] 未 push、未动 git 历史

> 全量测试套件中 `server/marketData.test.ts`（4 个，依赖真实 DB marketData 表）、`server/tushare.secret.test.ts`（TUSHARE_TOKEN 未注入）、`server/tushareTradingCalendar.test.ts`（外网超时）共 13 个失败为**预先存在**、环境相关，与本次改动无关（首轮 WORK F 报告已注明）。
