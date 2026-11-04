<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/security

- 测试文件 **8** 个 ｜ 用例声明 **123** 个
- 涉及源码目录：`server/` · `server/security/` · `server/securityStatus/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/security                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/security/baostock.test.ts`
- 85 行 ｜ 用例声明 7 ｜ describe 3
- 被测源码：`server/security/baostock.ts`
- 单跑：`pnpm exec vitest run tests/server/security/baostock.test.ts`
- 用例树：
- **parseBaoStockCode**
  - 解析 sh/sz/bj 前缀 → 统一交易所 + 6 位数字
  - 大小写与空白容忍
  - 非法 code 返回 null
- **mapBaoStockExchange**
  - 映射前缀
- **parseBaoStockStockBasic**
  - 只落 type=1 股票，指数/基金/债/非法前缀忽略
  - 上市股与退市股的日期/状态映射
  - 空 ipoDate / outDate 归一化为 null

### `tests/server/security/buildSecurityMaster.test.ts`
- 127 行 ｜ 用例声明 8 ｜ describe 4
- 被测源码：`server/security/buildSecurityMaster.ts` · `server/security/deterministicId.ts` · `server/security/identifierHistory.ts` · `server/security/namechange.ts` · `server/security/provider.ts` · `server/security/securityId.ts`
- 单跑：`pnpm exec vitest run tests/server/security/buildSecurityMaster.test.ts`
- 用例树：
- **确定性 security_id**
  - 同一锚点恒定产出同一 id，且通过格式校验
  - 不同锚点产出不同 id
- **buildSecurityMasterFromStockBasic**
  - 构建上市 + 退市证券的 primary 标识符（退市区间闭合）
  - 缺少上市日期的记录被拒绝
- **splitNameChangeSegments**
  - 连续名称区间不拆分
  - 区间出现缺口 → 拆分为代码复用段
- **buildSecurityMasterFromNameChanges + code reuse**
  - 缺口拆分为两个 security_id，detectCodeReuse 识别到 1 条复用
  - 无缺口 → 单证券、无复用

### `tests/server/security/engineKeyBridge.test.ts`
- 105 行 ｜ 用例声明 11 ｜ describe 2
- 被测源码：`server/security/types.ts` · `server/security/engineKeyBridge.ts`
- 单跑：`pnpm exec vitest run tests/server/security/engineKeyBridge.test.ts`
- 用例树：
- **resolveEngineKeyAt（canonical securityId → 引擎兼容键 stockCode）**
  - 在生效区间内解析为 canonical stockCode
  - 同一 security 更名：不同 asOf 解析到不同引擎键（确定性 + PIT-safe）
  - code reuse 下两个不同 security 在各自区间都能解析（不会错误合并）
  - asOf 落在两个区间之间的空档 → NO_IDENTIFIER（拒绝猜测）
  - 完全未知的 securityId → NO_IDENTIFIER
  - 同一 securityId 在 asOf 有多个重叠区间（数据错误）→ AMBIGUOUS
- **resolveSecurityIdByEngineKey（引擎兼容键 → canonical securityId）**
  - 在生效区间内解析出对应 securityId
  - code reuse：同一引擎键在前后区间解析到不同 security（反推方向也 asOf-safe）
  - 空档期 → NO_IDENTIFIER（退市后、复用前不能解析出任何身份）
  - 非法引擎键抛错（不静默猜测）
  - 多行指向不同 securityId（数据错误）→ AMBIGUOUS

### `tests/server/security/historicalUniverse.test.ts`
- 433 行 ｜ 用例声明 23 ｜ describe 2
- 被测源码：`server/security/tradingCalendar.ts` · `server/security/historicalUniverse.ts` · `server/securityStatus/pointInTime.ts` · `server/security/types.ts` · `server/securityStatus/types.ts`
- 单跑：`pnpm exec vitest run tests/server/security/historicalUniverse.test.ts`
- 用例树：
- **Historical Tradable Universe — 必需用例**
  - 案例1：尚未上市 → 剔除 NOT_YET_LISTED
  - 案例2：正常上市 → 成员
  - 案例3：已退市 → 剔除 DELISTED
  - 案例4：暂停交易 → 剔除 SUSPENDED
  - 案例5：恢复交易 → 成员
  - 案例6：ST → 仍可交易（信息维度，不阻断），st=ST
  - 案例7：*ST → 仍可交易，st=*ST
  - 案例8：suspension UNKNOWN → 不阻断（负向维度，无停牌即放行）
  - 案例9：status UNKNOWN（无任何状态）→ 剔除 TRADING_UNKNOWN（default deny）
  - 案例10：security code reuse — 同代码不同 security 按日期正确解析，不混淆
  - 案例11：identifier history — 同一 security 换代码仍为同一 security_id
  - 案例12：delisted stock — 历史日期可交易，退市后剔除（survivorship-safe）
  - 案例13：historical date — 历史 universe ≠ 当前 universe
  - 案例14：asOf — 未来才可知的退市不泄漏到过去（T+1 + calendar）
  - 案例15：security isolation — 状态互不串扰
- **边界与确定性**
  - 上市边界：listedDate 当日（含）即成员，前一日剔除
  - 退市边界：delistedDate 当日（含）即成员，次一日剔除
  - LISTING UNKNOWN：无 listedDate 且 LISTING 维度缺失 → 剔除 LISTING_UNKNOWN
  - 无生效标识符 → 剔除 NO_ACTIVE_IDENTIFIER
  - 确定性排序：按 exchange → code → securityId
  - getHistoricalTradableSecurityIds 返回确定性有序 id 列表
  - isTradingDay 与 T+1 交易日语义
  - calendar 感知 T+1：状态知识日用下一交易日而非 calendar+1

### `tests/server/security/namechange.test.ts`
- 66 行 ｜ 用例声明 4 ｜ describe 1
- 被测源码：`server/security/namechange.ts`
- 单跑：`pnpm exec vitest run tests/server/security/namechange.test.ts`
- 用例树：
- **parseTushareNameChange**
  - 解析真实形态（深发展A → 平安银行）
  - 错误码抛错
  - 缺少必需字段抛错
  - 无法解析的 ts_code 被跳过

### `tests/server/security/provider.test.ts`
- 99 行 ｜ 用例声明 7 ｜ describe 3
- 被测源码：`server/security/index.ts`
- 单跑：`pnpm exec vitest run tests/server/security/provider.test.ts`
- 用例树：
- **Tushare stock_basic 解析**
  - 归一化为 ProviderSecurityRecord（SH/SZ/BJ + 退市）
  - 错误码抛错
  - 缺少字段抛错
- **映射辅助**
  - 交易所映射
  - list_status 映射
  - 日期转换
- **记录 → Security / Identifier 构造**
  - 构造 Security 与 primary identifier

### `tests/server/security/security.test.ts`
- 288 行 ｜ 用例声明 32 ｜ describe 10
- 被测源码：`server/stockIdentity.ts` · `server/security/index.ts`
- 单跑：`pnpm exec vitest run tests/server/security/security.test.ts`
- 用例树：
- **security_id 永久身份**
  - 生成合法且唯一的 security_id
  - 拒绝非法 security_id
  - 代码变更不改变 security_id（同一证券换代码）
- **证券代码解析**
  - 解析裸 6 位数字
  - 解析带后缀（大写）
  - 解析小写与空白
  - 解析交易所前缀形态
  - 拒绝后缀与代码前缀冲突
  - 拒绝非法输入
  - canonical 表示
- **交易所推断**
  - SH：6 开头
  - SZ：0/3 开头
  - BJ：92/4/8 开头
  - 无法识别前缀抛错
- **BJ / SH / SZ 完整支持**
  - BJ 规范表示
  - SH 规范表示
  - SZ 规范表示
- **与历史 stockIdentity 语义一致**
  - normalizeStockCode 与 normalizeSecurityCode 等价
  - inferStockExchangeSuffix 与 inferExchange 等价
- **标识符历史（identifier history）**
  - 记录与检索
  - 同一 code 在不同区间对应不同 security_id（代码复用）
- **有效区间（effective interval）**
  - intervalContains 闭区间语义
  - intervalsOverlap 判定
  - 重叠区间校验抛错
  - 不重叠区间通过校验
- **上市 / 退市日期**
  - addDays 与 compareDate
  - 未上市证券不出现在 as-of universe
  - 已退市证券不出现在退市之后的 as-of universe
- **as-of lookup 与 survivorship**
  - as-of 解析返回正确证券
  - current universe != historical universe（survivorship 基础）
  - survivorship-safe：退市证券仍可按历史日期解析，但不属于当前 universe
- **detectCodeReuse（纯函数）**
  - 无复用时返回空数组

### `tests/server/security/tradingCalendar.test.ts`
- 279 行 ｜ 用例声明 31 ｜ describe 9
- 被测源码：`server/security/tradingCalendar.ts` · `server/securityStatus/pointInTime.ts` · `server/securityStatus/types.ts`
- 单跑：`pnpm exec vitest run tests/server/security/tradingCalendar.test.ts`
- 用例树：
- **isTradingDay**
  - 普通交易日为 true
  - 周末为 false
  - isTradingDayIn 纯函数一致
- **nextTradingDay / previousTradingDay**
  - 普通交易日：周一 → 周二
  - 周末：周五 → 下周一（不得跳周六）
  - 上一交易日跨周末：周一 → 上周五
  - 非交易日输入按其后/前最近交易日定位（clamp）
  - 连续休市（春节）：周五 → 节后首个交易日
  - 连续休市（国庆）：周三 → 节后首个交易日
  - 跨年 + 元旦连续休市：12/31 → 1/5
  - 末位/首位边界返回 null
- **addTradingDays（multiple trading days）**
  - T+1 / T+2 / T+3 跨周末正确
  - n=0 返回自身（交易日）
  - 负偏移（向前）
  - 越界返回 null
  - 非交易日返回 null（missing calendar date）
  - 非法偏移量 fail-fast
- **tradingDaysBetween / tradingDayCount**
  - 闭区间包含两端点
  - 跨周末区间正确计数
  - from > to 返回空
  - 端点不在日历内也能按区间过滤
- **clamp helpers**
  - firstTradingDayOnOrAfter / lastTradingDayOnOrBefore
  - 边界返回 null
- **empty calendar / missing calendar**
  - 空日历：查询均安全返回空语义
  - 日期不在日历内（missing）：addTradingDays 返回 null，next/previous clamp
- **邻接映射纯函数**
  - buildNextTradingDayMap / buildPreviousTradingDayMap
- **determinism（确定性）**
  - 相同输入构造的两个实例查询结果一致
  - 重复调用结果稳定
  - 构造对输入数组去重 + 升序归一（无序/重复输入也确定）
- **T_PLUS_1 集成（securityStatus pointInTime 用 nextTradingDay）**
  - T+1 用下一交易日，跨年+元旦不跳周末/节假日
  - 无 calendar 注入时 fail-safe 返回 null（不退回自然日）
