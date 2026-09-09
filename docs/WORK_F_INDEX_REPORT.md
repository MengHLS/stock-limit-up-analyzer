# WORK F — 指数主数据 / 指数日线回填报告

> STEP 12 数据地基建设 · F 域（index_master + index_daily）
> 执行日期：2026-09-06

## 1. 结论摘要

- `index_master`、`index_daily` 两张表已从 **0 行** 变为**真实数据**（非 mock）。
- 主数据源 Tushare `index_daily` **当天限频超限**（5 次/天 + 1 次/分钟），改为 **Sina 备用源**回填真实市场数据。
- 覆盖范围受 Sina 限制：仅最近 **1023 个交易日**（2022-06-22 ~ 2026-09-04），**非 2019-01-01 全历史** → 如实标注 **CONDITIONAL GAP**。

## 2. 改动文件清单

| 文件 | 说明 |
| --- | --- |
| `server/marketData/indexStorage.ts` | 新增 index 落库模块：`upsertIndexMaster` / `upsertIndexDaily`（ON DUPLICATE KEY UPDATE 幂等）+ 纯函数（`indexDailyBarToInsert`、`indexMasterEntryToInsert`、`buildIndexMasterEntry`、`deriveIndexDateRange`、`indexDailyIdempotencyKey`、`indexMasterIdempotencyKey`、`getIndexDailyCoverage`） |
| `scripts/backfillIndex.ts` | 新增回填 CLI：provider-neutral（复用 `indexProviders` 注册表），支持 `--dry-run` / `--index` / `--provider=tushare\|sina\|baostock` / `--start` / `--end` / `--interval` / `--allow-unknown`，含 resume 跳过与完整统计 |
| `server/marketData/indexStorage.test.ts` | 新增单元测试（8 个纯函数测试：index_daily 解析转换、index_master 构建、幂等键） |

未改动任何现有代码（`marketData/types.ts`、`providers/tushare.ts` 的 fetch/parse、OHLCV `stock_daily_prices` 均未触碰）。

## 3. 真实 DB 验证结果

SQL 直查 `index_master` / `index_daily`：

| 表 | 行数 | 说明 |
| --- | --- | --- |
| `index_master` | **4** | 4 只核心指数，名称/代码/日期范围正确 |
| `index_daily` | **4092** | 4 × 1023 行，真实收盘价等 OHLCV |

### index_master 明细

| indexCode | indexName | provider | providerCode | firstDate | lastDate |
| --- | --- | --- | --- | --- | --- |
| 000001.SH | 上证指数 | sina | sh000001 | 2022-06-22 | 2026-09-04 |
| 000300.SH | 沪深300 | sina | sh000300 | 2022-06-22 | 2026-09-04 |
| 000905.SH | 中证500 | sina | sh000905 | 2022-06-22 | 2026-09-04 |
| 399001.SZ | 深证成指 | sina | sz399001 | 2022-06-22 | 2026-09-04 |

### index_daily 各指数覆盖

| indexCode | rows | 日期范围 | amount 为 null | volume 为 null |
| --- | --- | --- | --- | --- |
| 000001.SH | 1023 | 2022-06-22 ~ 2026-09-04 | 1023（全部） | 0 |
| 000300.SH | 1023 | 2022-06-22 ~ 2026-09-04 | 1023（全部） | 0 |
| 000905.SH | 1023 | 2022-06-22 ~ 2026-09-04 | 1023（全部） | 0 |
| 399001.SZ | 1023 | 2022-06-22 ~ 2026-09-04 | 1023（全部） | 0 |

抽样（000001.SH，真实值）：
- `2022-06-22 close=3267.202 volume=37552978200 source=sina`
- `2022-06-23 close=3320.149 volume=40061421100 source=sina`

## 4. Provider → Requested → Received → Persisted → Rejected → Failed → Checkpoint

真实回填（`--provider=sina`，4 只核心指数）：

| 阶段 | 值 | 说明 |
| --- | --- | --- |
| Provider | `sina` | Tushare 限频，改用 Sina |
| Requested | 4 | 4 只核心指数各 1 次请求 |
| Received | 4 | 4 只均返回数据 |
| Persisted | `index_master`=4, `index_daily`=4092 | ON DUPLICATE KEY UPDATE 幂等写入 |
| Rejected | 0 | 4 只均在核心参考表内，身份校验通过 |
| Failed | 0 | 无请求失败 |
| Checkpoint | 0（首次）/ 4（复跑） | resume 复跑时 4 只全部跳过（幂等验证） |

Tushare 探测（`--provider=tushare`）：
- 第一次 `fetchTushareIndexIdentity` → `频率超限(5次/天)` 40203
- 第二次 `fetchTushareIndexDaily` → `频率超限(1次/分钟)` 40203

## 5. index_daily 真实配额结论

**CONDITIONAL GAP —— 无法用 Tushare 全量回填。**

- Tushare `index_daily` 真实限频：**5 次/天 + 1 次/分钟**（当前积分档）。探测时当天配额已耗尽，两个请求均返回 40203。
- 结论：Tushare 路径当天不可用；即便可用，5 次/天仅够拉 4~5 只指数全历史（每只 1 次请求），无法支撑"全市场指数"或高频刷新。
- 已采用的降级路径：**Sina**（HTTP，宽松限频），数据真实、非 mock，但存在覆盖/字段缺口（见下）。

## 6. 剩余 blocker / 风险

1. **Tushare index_daily 限频**（5 次/天 + 1 次/分钟）：核心 blocker。需升级 Tushare 积分，或改用其他指数源，才能拉 2019 至今全历史。
2. **Sina 数据范围限制**：`datalen=1023` 只返回最近约 1023 个交易日，**2019-01-01 ~ 2022-06-21 指数数据缺失**。
3. **Sina amount 恒 null**：新浪指数 K-line 不返回成交额，`index_daily.amount` 对 Sina 来源全部为 null（不伪造）。
4. **Sina volume 口径待核**：返回值为约 375 亿量级，疑似"股"而非 canonical "手"（1 手 = 100 股），当前保留原值并在 source 标注待核；若下游按"手"消费需谨慎。
5. **BaoStock 环境缺失**：`baostock` Python 模块未安装（`ModuleNotFoundError`），CLI 已预留 `--provider=baostock` 但当前环境无法执行；BaoStock 免费且可拉全历史，是补齐 2019-2022 缺口的候选路径。
6. **非交易日 end 边界**：CLI 的 resume 判定已用"最后交易日距今 ≤ 30 天"语义规避非交易日比较问题（已验证复跑触发 Checkpoint=4）。

## 7. PIT 影响

- 指数日线本身是**历史既成事实**，写入不引入前视偏差（look-ahead bias）。
- 但 **2019-01-01 ~ 2022-06-21 指数数据缺失**：若策略/因子依赖指数（如大盘环境、市场 beta、指数相对强弱等），该期间将**无法计算或需降级**（不能拿 2022 之后的指数序列回填更早日期）。
- `amount`（成交额）对 Sina 来源全 null：任何依赖指数成交额的因子在 2022-06-22 之后仍然缺失，属显式 UNAVAILABLE，禁止用其他字段推导伪造。

## 8. 验收核对

- [x] `npm run check` 通过（`tsc --noEmit` 无错误）
- [x] 新增测试通过（`indexStorage.test.ts` 8/8）
- [x] 真实 DB `index_master`（4 行）、`index_daily`（4092 行）有真实数据，行数 > 0
- [x] 输出本报告
- [x] 未改动现有代码 / fetch / parse / OHLCV
- [x] 未 push、未动 git 历史

> 注：`server/marketData.test.ts` 存在 4 个**预先存在**的失败（依赖真实 DB 的 `marketData` 表读写，环境相关），与本次改动无关，非本 WORK 引入。
