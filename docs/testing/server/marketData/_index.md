<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/marketData

- 测试文件 **9** 个 ｜ 用例声明 **95** 个
- 涉及源码目录：`server/marketData/` · `server/marketData/providers/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/marketData                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/marketData/coverage.test.ts`
- 89 行 ｜ 用例声明 8 ｜ describe 2
- 被测源码：`server/marketData/coverage.ts` · `server/marketData/types.ts`
- 单跑：`pnpm exec vitest run tests/server/marketData/coverage.test.ts`
- 用例树：
- **computeIndexCoverage**
  - 返回 first/last/rowCount
  - 无 bar 时回退 master first/last
  - 传入交易日历可计算缺失日期
  - 无日历时 missingDates 为空
- **computeLiquidityCoverageByYear**
  - 按年分组并计算填充率
  - 无日历时以数据内日期去重为 tradingDays
  - 分母为 0 时 coverageRatio 为 0
  - coverageRatio 封顶为 1

### `tests/server/marketData/indexes.test.ts`
- 114 行 ｜ 用例声明 17 ｜ describe 3
- 被测源码：`server/marketData/indexes.ts` · `server/marketData/types.ts`
- 单跑：`pnpm exec vitest run tests/server/marketData/indexes.test.ts`
- 用例树：
- **index mapping（代码规范化）**
  - 裸 6 位 000300 → 000300.SH
  - sina 前缀 sh000300 → 000300.SH
  - 已带后缀 000300.SH → 幂等
  - 深证指数 399006 → 399006.SZ
  - 中证500 000905 → 000905.SH（指数段 ≠ 股票段 0→SZ）
  - mapIndexCode 复用 normalizeIndexCode
  - 无法识别 → 抛错
  - 非法输入 → 抛错
- **index identity 校验**
  - 身份一致 → PASS
  - 名称不符 → CONCERN
  - 数据早于官方发布日（Sina 000300 自 2002 起）→ CONCERN
  - 数据早于基期 → CONCERN（强烈身份疑点）
  - 未知指数 → BLOCKED
  - 核心指数参考表包含 6 只目标指数
- **index duplicate / missing**
  - assertUniqueIndexDaily 检出重复
  - assertUniqueIndexDaily 对无重复不抛错
  - sortIndexDaily 按日期升序

### `tests/server/marketData/indexStorage.test.ts`
- 112 行 ｜ 用例声明 8 ｜ describe 3
- 被测源码：`server/marketData/indexStorage.ts` · `server/marketData/types.ts`
- 单跑：`pnpm exec vitest run tests/server/marketData/indexStorage.test.ts`
- 用例树：
- **index_daily 解析 / 转换（bar → DB 行）**
  - indexDailyBarToInsert 字段对齐，单位不变
  - nullable 字段透传 null（不伪造）
- **index_master 构建**
  - buildIndexMasterEntry 从 bars 推导 firstDate/lastDate
  - 空 bars → firstDate/lastDate 为 null
  - indexMasterEntryToInsert 将 retrievedAt ISO string 转 Date
- **幂等键**
  - indexDailyIdempotencyKey 与 uq_index_daily_code_date 对齐
  - indexMasterIdempotencyKey 与 uq_index_master_code_provider 对齐
  - deriveIndexDateRange 返回 min/max

### `tests/server/marketData/industry.test.ts`
- 105 行 ｜ 用例声明 13 ｜ describe 2
- 被测源码：`server/marketData/industry.ts`
- 单跑：`pnpm exec vitest run tests/server/marketData/industry.test.ts`
- 用例树：
- **getIndustryAt (as-of)**
  - 命中生效区间返回该行业
  - 无归属（日期早于起始）返回 null
  - 无归属（日期晚于截止）返回 null
  - 区间边界含端点：effectiveTo 当天仍命中
  - null effectiveTo 视为至今仍有效
  - 重叠区间命中多个 → 抛错（禁止静默挑一个）
  - 非法日期 → 抛错
  - 不同证券互不干扰
- **industry interval**
  - 按 effectiveFrom 升序返回该证券全部区间
  - industryIntervalsOverlap 判定闭区间重叠
  - validateIndustryIntervals 检出重叠
  - validateIndustryIntervals 检出 from > to
  - hasCurrentIndustry 识别 effectiveTo=null 的当前行业

### `tests/server/marketData/industryProvider.test.ts`
- 90 行 ｜ 用例声明 12 ｜ describe 3
- 被测源码：`server/marketData/providers/baostock.ts` · `server/marketData/industry.ts`
- 单跑：`pnpm exec vitest run tests/server/marketData/industryProvider.test.ts`
- 用例树：
- **baostockCodeToSecurityCode（securityCode 转换）**
  - sh.600000 → 600000.SH
  - sz.000001 → 000001.SZ
  - bj.920000 → 920000.BJ
  - 与 toBaostockCode 互为逆运算
  - 非法代码抛错
- **splitIndustryCodeName（industryCode/Name 拆分）**
  - J66货币金融服务 → code=J66 name=货币金融服务
  - C39计算机、通信和其他电子设备制造业 → code=C39
  - 纯中文名（无代码前缀）→ code 空、name 保留原文
  - 空串 → 两者皆空
- **parseBaostockIndustry（BaoStock industry 行解析 + PIT）**
  - 解析为 IndustryAssignment：securityId=规范化代码，effectiveFrom=updateDate，effectiveTo=null
  - 区间校验：单条当前快照区间 VALID（无重叠）
  - getIndustryAt：effectiveFrom 当天及之后命中当前行业

### `tests/server/marketData/liquidity.test.ts`
- 160 行 ｜ 用例声明 11 ｜ describe 2
- 被测源码：`server/marketData/liquidity.ts`
- 单跑：`pnpm exec vitest run tests/server/marketData/liquidity.test.ts`
- 用例树：
- **liquidity mapping + unit normalization**
  - tushare-daily-basic：万元→元（×10000），amount/volume 不可提供 → null
  - baostock-daily：元→千元（×0.001）、股→手（×0.01），市值不可提供 → null
  - tushare-daily：amount/volume 可提供，换手/市值不可提供
  - 非有限数值 → null（不静默填 0）
  - mergeLiquidity：后序 provider 只补前序缺失字段，不覆盖已有值
  - liquidityFieldAvailability 聚合多 provider 可提供性
  - 市值全量仅靠 baostock → 市值 UNAVAILABLE
  - validateLiquidity 检出负值与换手率超范围
  - validateLiquidity 检出流通市值 > 总市值
  - capability 表显式声明各 provider 能力
- **liquidity 类型完整性**
  - NormalizedLiquidity 暴露 bar 与 capability

### `tests/server/marketData/liquidityStorage.test.ts`
- 74 行 ｜ 用例声明 6 ｜ describe 3
- 被测源码：`server/marketData/providers/baostock.ts` · `server/marketData/liquidityStorage.ts` · `server/marketData/liquidity.ts`
- 单跑：`pnpm exec vitest run tests/server/marketData/liquidityStorage.test.ts`
- 用例树：
- **liquidityStorage（幂等键 + bar→insert 映射）**
  - 幂等键与唯一约束 (securityCode, tradeDate) 对齐
  - liquidityBarToInsert：securityCode 作自然键，securityId 软引用，市值 null 透传
  - liquidityBarToInsert：未知 securityId 时为 null
- **单位换算复用（WORK E 链路不自行乘除，走 normalizeLiquidity）**
  - parseBaostockStockDaily：元→千元（×0.001）、股→手（×0.01）、turn 原样 %、市值 null
  - 空数值字段 → null（不静默填 0）
- **getBackfilledSecurityCodes（resume 读取）**
  - 无库环境下返回空集（不抛错）

### `tests/server/marketData/pointInTime.test.ts`
- 54 行 ｜ 用例声明 7 ｜ describe 1
- 被测源码：`server/marketData/pointInTime.ts`
- 单跑：`pnpm exec vitest run tests/server/marketData/pointInTime.test.ts`
- 用例树：
- **Point-in-Time 语义**
  - effective / available / retrieved 均合法且顺序正确 → VALID
  - availableAt 为 null → UNKNOWN 且合法（不是错误）
  - 不得强行假设 T+1：withUnknownAvailability 不填充 availableAt
  - availableAt 早于 effectiveDate → WARNING/INVALID（时间倒挂）
  - retrievedAt 早于 availableAt → 顺序错误
  - 非法 effectiveDate → INVALID
  - 非法 retrievedAt → INVALID

### `tests/server/marketData/providers.test.ts`
- 127 行 ｜ 用例声明 13 ｜ describe 4
- 被测源码：`server/marketData/providers/tushare.ts` · `server/marketData/providers/sina.ts` · `server/marketData/providers/baostock.ts` · `server/marketData/providers/akshare.ts`
- 单跑：`pnpm exec vitest run tests/server/marketData/providers.test.ts`
- 用例树：
- **Tushare provider 解析**
  - parseTushareIndexDaily 归一为 canonical
  - parseTushareDailyBasic：万元→元 归一
- **Sina provider 解析**
  - toSinaSymbol 转 Sina 行情代码
  - parseSinaIndexDaily：amount 恒 null（Sina 不返回），volume 保留
  - parseSinaIndexQuote 提取名称
- **BaoStock provider 解析**
  - toBaostockCode 转 BaoStock 代码
  - toBaostockCode 4 个核心指数映射（sh.000001 / sz.399001 / sh.000300 / sh.000905）
  - parseBaostockIndexDaily：股→手、元→千元
  - parseBaostockIndexDaily：source=baostock，空字段转 null 不伪造
  - parseBaostockStockDaily：turn %、股→手、元→千元，市值 null
- **AkShare SW provider 解析**
  - parseAkShareSwIndustries 过滤空项
  - parseAkShareSwMembers：6 位代码 → 规范化
  - parseAkShareSwMembers：非法代码跳过
