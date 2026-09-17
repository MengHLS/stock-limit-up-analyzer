# WORK B 实施报告 — Security Master + Identifier History 真实落库

> STEP 12 核心 blocker B2：让 `research_securities` 与 `research_security_identifier_history` 从 0 行变为有真实数据。
> 完成日期：2026-09-06

## 1. 结论摘要

- 已完成：namechange provider、stock_basic 全量 provider、确定性 security_id、Security Master 构建器（含 code reuse 拆分）、幂等落库仓库、回填 CLI、单元测试。
- `npm run check` 通过；`server/security/` 下 116 个测试全部通过（含新增 12 个）。
- 真实 DB 已写入**真实 Tushare 数据**：`research_securities` = 1 行、`research_security_identifier_history` = 1 行（非 mock）。
- **主 blocker 未解除**：Tushare `stock_basic` 今日配额（5 次/天）已耗尽（40203），全量 L/D/P 回填需等配额重置后执行（CLI 已就绪，`npx tsx scripts/backfillSecurityMaster.ts --fetch`）。

## 2. 改动文件清单

| 文件 | 说明 |
| --- | --- |
| `server/security/namechange.ts` | 新增。Tushare `namechange` Provider + `parseTushareNameChange` 纯解析器 |
| `server/security/provider.ts` | 修改。`TushareStockBasicProvider` 支持 `listStatus`（默认全量 L/D/P），保留纯函数解析 |
| `server/security/deterministicId.ts` | 新增。以 ts_code 锚点做 SHA-1 摘要生成确定性 `sec_<uuid>`，保证幂等 |
| `server/security/buildSecurityMaster.ts` | 新增。纯函数：从 stock_basic / namechange 构建 securities + identifiers，含 code reuse 缺口拆分与区间校验 |
| `server/security/repository.ts` | 新增。drizzle 幂等 upsert 落库 + 统计 + code reuse 查询（不入 `index.ts`，避免纯测试被 DB 依赖拖入） |
| `server/security/index.ts` | 修改。导出 deterministicId / namechange / buildSecurityMaster |
| `server/security/namechange.test.ts` | 新增。namechange 解析单测（含真实 000001.SZ 形态） |
| `server/security/buildSecurityMaster.test.ts` | 新增。确定性 id / 构建 / code reuse 拆分单测 |
| `scripts/backfillSecurityMaster.ts` | 新增。回填 CLI（`--fetch` / `--namechange` / `--input` / `--dry-run` / `--limit`） |
| `scripts/_namechange_real_000001.json` | 辅助。真实 namechange 数据 fixture（000001.SZ，离线复现用） |
| `scripts/_verify_security_master.ts` | 辅助。SQL 验证脚本（两张表行数/明细/code reuse） |

## 3. 关键设计决策

1. **确定性 security_id（幂等核心）**：以 `tushare:<code>.<exchange>` 为锚点，SHA-1 取前 16 字节、置 UUID v4 version/variant 位，格式化为 `sec_<uuid>`。同一 ts_code 恒定产出同一 id，重复运行不产生新 id，且通过 `isValidSecurityId` 格式校验。已实测：000001.SZ 重复运行 `securities=1 identifiers=1`（无重复行）。

2. **Survivorship bias**：`TushareStockBasicProvider` 默认 `listStatus=undefined`（不带 `list_status` 参数）即拉全量 L/D/P；保留 `"L" | "D" | "P"` 分片能力。退市股 primary 标识符的 `effectiveTo = delist_date`（区间闭合），为代码复用留出语义空间。

3. **code reuse 检测**：复用 `identifierHistory.detectCodeReuse`。复用信号来自 namechange 名称区间的「缺口」（`next.start > prev.end + 1 天`），据此把同一 code 拆分为多个 security_id（锚点 `#2/#3…` 后缀保证确定性与唯一性）。已在单测中验证（缺口 → 2 个 security_id，`detectCodeReuse` 命中 1 条）。

4. **PIT 语义**：`effectiveFrom = 上市日`（namechange 下取最早 `start_date`），`effectiveTo = 退市日`（namechange 下取最新区间 `end_date`，null = 至今）。`retrievedAt` 由 DB `DEFAULT CURRENT_TIMESTAMP` + upsert 时 `new Date()` 记录抓取时间。

5. **幂等落库**：`research_securities` 按唯一键 `securityId` `ON DUPLICATE KEY UPDATE`；identifier history 按唯一键 `(exchange, securityCode, identifierType, effectiveFrom)` upsert。CLI 重复运行天然 resume（无显式 checkpoint，单次任务即幂等）。

## 4. 字段名探测结果（以实测为准）

- **namechange** 实测字段（2026-09-06 探测）：`ts_code, name, start_date, end_date, ann_date, change_reason` —— 与任务描述一致。
- **`change_reason` 实测值全部为 `"其他"`**（无语义区分，如 000001.SZ 的更名均为「其他」），故 code reuse 检测**不依赖 `change_reason`**，改用「名称区间缺口」启发式（`splitNameChangeSegments`）。
- **限频实测**：`stock_basic` 5 次/天；`namechange` 1 次/小时（且 1 次/分钟）。

## 5. 真实 DB 验证结果（SQL）

执行 `npx tsx scripts/_verify_security_master.ts`：

| 指标 | 值 |
| --- | --- |
| `research_securities` 行数 | **1** |
| `research_security_identifier_history` 行数 | **1** |
| distinct security_id | **1** |
| code reuse（同 code 多 securityId）组数 | **0** |

明细（真实 Tushare namechange 数据）：

```
sec_d5e57ebc-... SZ 000001 [1991-04-03, null] status=listed listed=1991-04-03 delisted=null
```

该行为 `000001.SZ`（深发展A → 平安银行）的真实名称/代码生命周期：上市日 1991-04-03，至今上市。

## 6. 剩余 blocker / 风险

1. **stock_basic 今日配额耗尽（主 blocker）**：`40203 频率超限(5次/天)`。全量 L/D/P 回填无法在今天完成；配额重置后执行 `npx tsx scripts/backfillSecurityMaster.ts --fetch` 即可全量落库（预计 ~5600+ 证券，含退市）。
2. **namechange 限频 1 次/小时**：今天仅取得 000001.SZ 一份真实样本；退市股（`delisted` 状态）与代码复用的**真实验证**待配额（已由 mock 单测覆盖逻辑）。
3. **code reuse 全市场识别受限**：stock_basic 每 ts_code 仅一条快照，无法暴露复用；需**全量 namechange 回填**（未来 work）才能全市场识别退市后代码复用。当前机制已就绪，仅缺数据。
4. **全量回填规模**：stock_basic 全量 + 后续 namechange 全量会产生数万行 identifier history，建议沿用分批 upsert（已实现 `BATCH_SIZE=500`）。
5. **未动 OHLCV**：本 work 未改 `daily` 接口与 `stock_daily_prices` 表，OHLCV 后台回填不受影响。

## 7. 复现 / 运行

```bash
# 全量回填（配额重置后）
npx tsx scripts/backfillSecurityMaster.ts --fetch

# 小样本 namechange（1 次/小时，节制）
npx tsx scripts/backfillSecurityMaster.ts --namechange=600000.SH,600519.SH --namechange-interval=65000

# 离线复现（真实 namechange fixture）
npx tsx scripts/backfillSecurityMaster.ts --input=./scripts/_namechange_real_000001.json

# 预览
npx tsx scripts/backfillSecurityMaster.ts --fetch --dry-run

# SQL 验证
npx tsx scripts/_verify_security_master.ts
```
