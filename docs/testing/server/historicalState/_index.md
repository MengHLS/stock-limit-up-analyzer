<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/historicalState

- 测试文件 **5** 个 ｜ 用例声明 **64** 个
- 涉及源码目录：`server/corporateActions/` · `server/data/` · `server/historicalState/` · `server/historicalState/audit/` · `server/marketData/` · `server/security/` · `server/securityStatus/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/historicalState                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

> ℹ️ 本模块有 **1** 个「源码文本断言」测试（`readFileSync` 源码 + 字符串匹配），
> 改个变量名就可能变红，且不验证行为；详见 `docs/testing/README.md` 的「测试分类」一节。

## 逐文件

### `tests/server/historicalState/audit/checkers.test.ts`
- 413 行 ｜ 用例声明 17 ｜ describe 3
- 被测源码：`server/corporateActions/types.ts` · `server/data/types.ts` · `server/marketData/types.ts` · `server/security/types.ts` · `server/securityStatus/types.ts` · `server/historicalState/reconstruct.ts` · `server/historicalState/types.ts` · `server/historicalState/audit/checkers.ts` · `server/historicalState/audit/types.ts`
- 单跑：`pnpm exec vitest run tests/server/historicalState/audit/checkers.test.ts`
- 用例树：
- **checkers.clean**
  - 干净基线：12 项检查全 PASS、无 FAIL
  - 退市日之后的样本：master 判 DELISTED、不可交易（survivorship 正向）
- **checkers 泄漏检测（篡改状态模拟回归缺陷）**
  - IDENTITY_CODE：身份代码被替换
  - LIFECYCLE_MASTER：master 已退市但重建判 LISTED
  - TRADABILITY_MASTER_BOUND：上市前被错误放行为可交易
  - INDUSTRY_PIT：未来回填（retrievedAt>asOf）泄漏进重建结果
  - INDUSTRY_PIT：应可知的行业被遗漏（重建返回 null）
  - CA_KNOWN_SET：look-ahead——未来公告事件进入 PIT 可知集
  - CA_KNOWN_SET：遗漏——已公告事件未进入可知集
  - CA_EFFECTIVE_SET：未来生效事件被装入已生效集
  - PRICE_DAY：价格日期错位
  - MARKET_STATE_DAY：市场状态缺失（有指数行但重建为空）
  - KNOWLEDGE_CONSISTENCY：可知性标记与结果矛盾
  - PIT_SUBSET_DIMS：asOf 增大后已解析维度倒退
  - INDUSTRY_GROWTH：asOf 增大后行业消失
- **checkers 稳定性**
  - CHECK_IDS 与实现一致（汇总聚合所需）
  - 同一输入两次检查结果一致（确定性）

### `tests/server/historicalState/audit/oracle.test.ts`
- 254 行 ｜ 用例声明 12 ｜ describe 4
- 被测源码：`server/corporateActions/types.ts` · `server/marketData/types.ts` · `server/security/types.ts` · `server/securityStatus/types.ts` · `server/historicalState/audit/types.ts` · `server/historicalState/audit/oracle.ts`
- 单跑：`pnpm exec vitest run tests/server/historicalState/audit/oracle.test.ts`
- 用例树：
- **oracle.naiveActiveIdentifierAt**
  - primary 优先：生效区间内返回 primary
  - 无 primary 时取别名；区间外为 null
  - code 为 6 位、canonical 拼接正确
  - identity 期望字段透传区间与类型
- **oracle.naiveLifecycleExpectation**
  - master 时间界判词：未上市 / 上市中 / 已退市 / 未知
- **oracle CA PIT（announcementDate）**
  - 已生效集合：effectiveDate<=T 且生效日代码归本 security
  - 代码复用：生效日不属于本主体的行为不得计入（跨主体防串扰）
  - 可知集合：announcementDate<=asOf；缺失公告保守不可知；asOf=null 全知=生效集
- **oracle 行业 PIT（retrievedAt）**
  - retrievedAt<=asOf 才可用；无行→none；重叠→overlap
  - 未来回填（retrievedAt>asOf）→ none 且触发 PIT 护栏；asOf=null 全知可见
  - 区间不覆盖 tradeDate → none（未来才开始生效的行业不得回填过去）
  - 行业归属代码拥有区间过滤：第二主体不得使用他人区间

### `tests/server/historicalState/codeLookup.test.ts`
- 94 行 ｜ 用例声明 7 ｜ describe 3 ｜ 📄 源码文本断言
- 被测源码：`server/historicalState/codeLookup.ts`
- 单跑：`pnpm exec vitest run tests/server/historicalState/codeLookup.test.ts`
- 用例树：
- **parseCodeQuery（纯函数）**
  - 6 位纯数字 → digits + 无交易所
  - 带 .SH/.SZ 后缀（大小写不敏感、容忍空白）
  - 支持北交所后缀 .BJ
  - 非法输入 → 可读 parseError 而非静默猜测
- **lookupSecuritiesByCode（无 DB 环境：诚实失败）**
  - DATABASE_URL 缺失 → 返回 error 而非空数组
- **FE-2 接线守卫**
  - historicalState router 暴露 resolveCode（前端页面可调用）
  - 契约 schema 定义 resolve 入参/结果类型

### `tests/server/historicalState/mappers.test.ts`
- 220 行 ｜ 用例声明 9 ｜ describe 4
- 被测源码：`server/historicalState/mappers.ts`
- 单跑：`pnpm exec vitest run tests/server/historicalState/mappers.test.ts`
- 用例树：
- **STEP 7.4 行映射**
  - research_securities 行 → Security（同名字段透传）
  - identifier_history 行 → SecurityIdentifier（code=6 位数字，无后缀）
- **STEP 7.5 状态行映射**
  - retrievedAt 为 Date → ISO；为 null → null
- **STEP 7.6 行业 / 流动性 / 指数行映射**
  - industry 行 → IndustryAssignment：领域键 = 自然键 securityCode（软引用 null 不冒充身份）
  - liquidity 行 → LiquidityDaily：double 数值直接透传，null 保持 null
  - index_daily 行 → IndexDailyBar；index_master 行 → IndexMasterEntry
- **STEP 7.7 公司行为 / 复权因子行映射**
  - varchar 现金/比例列 → number；空串与缺失 → null（禁止静默填零）
  - adjustment_factors varchar 因子 → number
  - 非法数值 → null，绝不抛错或填零

### `tests/server/historicalState/reconstruct.test.ts`
- 497 行 ｜ 用例声明 19 ｜ describe 6
- 被测源码：`server/security/tradingCalendar.ts` · `server/security/historicalUniverse.ts` · `server/historicalState/reconstruct.ts` · `server/historicalState/types.ts` · `server/security/types.ts` · `server/securityStatus/types.ts` · `server/marketData/types.ts` · `server/corporateActions/types.ts` · `server/data/types.ts`
- 单跑：`pnpm exec vitest run tests/server/historicalState/reconstruct.test.ts`
- 用例树：
- **STEP 12.5 — 完整状态 10 问**
  - 正常上市可交易日：10 个问题全部得到确定答案
  - 未加载域必须标记 UNKNOWN，禁止默认填充为 KNOWN
  - 日历提供时给出 isTradingDay；缺失时为 null
- **STEP 12.5 — 生命周期 / 可交易（默认拒绝）**
  - 尚未上市 → NOT_YET_LISTED + 不可交易
  - 已退市（master 时间界）→ DELISTED + 不可交易 + 无生效代码
  - 停牌 → 不可交易 reason=SUSPENDED，但 ST 维度不影响可交易
  - 状态维度全部缺失 → 默认拒绝（TRADING_UNKNOWN），不默认为可交易
- **STEP 12.5 — PIT 无未来泄漏（asOf）**
  - 公司行为：仅 announcementDate <= asOf 的事件可知；全知视角不过滤
  - 公司行为：未来才生效的事件不计入 effectiveOnOrBefore
  - 公司行为：announcementDate 缺失 → 保守视为不可知（PIT）
  - 行业：retrievedAt 晚于 asOf 的归属不可见（禁止晚取数据回填历史）
  - 状态 T+1：asOf 早于可知日 → 退市信息不可见（周五生效的 T+1 是周一）
- **STEP 12.5 — 行业数据质量与 code 键守卫**
  - 行业区间重叠 → 抛错（禁止静默挑选）
  - priceBar/liquidity 代码与生效代码不一致 → 抛错（禁止静默错配）
  - 无生效代码且未提供 code 键数据 → 不报错，identity.code=null
- **STEP 12.5 — 确定性排序**
  - 市场状态按 indexCode 升序；公司行为按 (effectiveDate, type, announcement) 确定性排序
- **STEP 12.5 — 标识符解析与 code 归属（防代码复用）**
  - resolveActiveIdentifierAt 优先 primary；无生效标识符返回 null
  - isCodeOwnedBySecurityAt：同一 code 在不同时间段归属不同 security
  - isCodeIntervalOwnedBySecurity：区间型归属按重叠判定
