<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/researchDataset

- 测试文件 **9** 个 ｜ 用例声明 **85** 个
- 涉及源码目录：`server/corporateActions/` · `server/data/` · `server/marketData/` · `server/researchDataset/` · `server/security/` · `server/securityStatus/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/researchDataset                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/researchDataset/assemble.test.ts`
- 441 行 ｜ 用例声明 11 ｜ describe 4
- 被测源码：`server/security/tradingCalendar.ts` · `server/security/historicalUniverse.ts` · `server/security/types.ts` · `server/securityStatus/types.ts` · `server/marketData/types.ts` · `server/corporateActions/types.ts` · `server/data/types.ts` · `server/researchDataset/assemble.ts` · `server/researchDataset/universe.ts` · `server/researchDataset/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchDataset/assemble.test.ts`
- 用例树：
- **resolveUniverseDefinition**
  - 只含可交易成员（排除 pre-listing / UNKNOWN 默认拒绝）
  - 板块过滤：只保留选中板块，其余计入 BOARD_EXCLUDED:<board>
  - 排除 ST：ST 成员计入 ST_EXCLUDED（ST 不影响 eligibility，仅过滤层剔除）
- **assembleDayRows**
  - 扁平化投影：身份/生命周期/可交易/行业/流动性/价格/指数/可知性 全解析
  - CA PIT 双层口径：effective 可见但 announcementDate 晚于 asOf 不得记为已知
  - 无价格 bar 时 price 维度为 UNKNOWN（不伪造）
  - 确定性：相同输入两次 → 相同行序列
- **activeFullCodeAt / projectStateToRow 辅助**
  - code 复用：行业/CA 只归属真正拥有该代码的证券（防跨主体串扰）
  - activeFullCodeAt 返回当日完整代码
  - projectStateToRow 直接投影（供独立调用方）
- **resolveAsOfForRequest**
  - 逐日 PIT → null（每行用 tradeDate）；固定快照 → asOf

### `tests/server/researchDataset/capability.test.ts`
- 114 行 ｜ 用例声明 11 ｜ describe 2
- 被测源码：`server/researchDataset/capability.ts`
- 单跑：`pnpm exec vitest run tests/server/researchDataset/capability.test.ts`
- 用例树：
- **deriveCapabilityFacts**
  - Industry 单期快照 → CONDITIONAL
  - Industry 多期历史序列 → AVAILABLE
  - Industry 无数据 → UNAVAILABLE
  - Liquidity 未覆盖 OHLCV 全窗口 → CONDITIONAL
  - Liquidity 覆盖 OHLCV 全窗口 → AVAILABLE
  - Corporate Action 有缺失 announcementDate → CONDITIONAL
  - Corporate Action announcementDate 齐备 → AVAILABLE
- **buildCapabilityMatrix**
  - 矩阵含 10 个维度，顺序稳定
  - 行业维度诚实标记 CONDITIONAL（不伪造 READY）
  - PIT/Survivorship 结构性 AVAILABLE
  - DB 不可用（全 0）→ 保守降级，无 AVAILABLE 冒名

### `tests/server/researchDataset/certify.test.ts`
- 141 行 ｜ 用例声明 9 ｜ describe 1
- 被测源码：`server/researchDataset/certify.ts` · `server/researchDataset/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchDataset/certify.test.ts`
- 用例树：
- **certifyResearchDataset 决策树**
  - gate=FAIL → REJECTED
  - gate=INCONCLUSIVE → CONDITIONAL
  - gate=PASS 且固定快照 → CONDITIONAL（NON_RESEARCH_SAFE）
  - gate=PASS + 逐日 PIT + 不依赖 Industry → CERTIFIED
  - gate=PASS + 逐日 PIT + 依赖 Industry（历史 PIT CONDITIONAL）→ CONDITIONAL
  - gate=PASS + 依赖 Industry 但历史 PIT AVAILABLE → CERTIFIED
  - gate=PASS + 依赖 Liquidity（覆盖 CONDITIONAL）→ CONDITIONAL
  - policySet 缺失 pit/survivorship → CONDITIONAL（防篡改护栏）
  - 确定性：同输入两次结果深相等

### `tests/server/researchDataset/partitioned.test.ts`
- 166 行 ｜ 用例声明 10 ｜ describe 3
- 被测源码：`server/researchDataset/version.ts` · `server/researchDataset/buildKey.ts` · `server/researchDataset/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchDataset/partitioned.test.ts`
- 用例树：
- **computeBuildKey**
  - 同请求同 buildKey（确定性）
  - 不同请求不同 buildKey
  - buildKey 为 16 位 hex，表名格式正确
  - 非法 buildKey 抛错（防注入）
- **流式指纹 == 一次性指纹**
  - computeDatasetVersionStreaming === computeDatasetVersion
  - computeRowsFingerprintStreaming === computeRowsFingerprint
  - computeDatasetFingerprintsStreaming（异步）与一次性一致
  - 空 rows 也一致
- **JSON round-trip 不改变指纹（分片落表关键）**
  - round-trip 后 canonicalStringify 一致
  - round-trip 后整体 rowsFingerprint 一致

### `tests/server/researchDataset/policy.test.ts`
- 375 行 ｜ 用例声明 16 ｜ describe 3
- 被测源码：`server/researchDataset/policy.ts` · `server/researchDataset/policyValidate.ts` · `server/researchDataset/versionSnapshot.ts` · `server/researchDataset/version.ts` · `server/researchDataset/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchDataset/policy.test.ts`
- 用例树：
- **derivePolicySet**
  - 派生 9 类、顺序与 POLICY_ORDER 一致、policyId===class、含结构化五要素
  - 派生值是确定性的：两次调用 canonical 指纹一致
  - 口径变化（固定快照 vs 逐日 PIT）→ pit 声明与指纹变化
- **validateResearchDatasetPolicyConsistency**
  - 合法 fixture（逐日 PIT + raw + 全 9 类）→ 零 issue
  - 合法固定快照 fixture → 零 issue
  - 空壳（DB 不可用路径：days=[] rows=[]）→ 不误报
  - 冲突①：asOfPerTradeDate=false 且未给 asOf → MISSING_AS_OF
  - 冲突②：PIT mode 声明与 universeDefinition.asOfDescription 不符 → PIT_MODE_UNIVERSE_MISMATCH
  - 冲突③：adjustment 声明 priceBasis=adjusted 与行 schema（raw）不符 → ADJUSTMENT_BASIS_MISMATCH
  - 冲突④：universe-membership 声明口径被篡改（defaultOnUnknown=allow）→ POLICY_VALUE_CONFLICT
  - 冲突⑤：缺类 → POLICY_MISSING；重复 → POLICY_DUPLICATE
  - 确定性：同输入两次 → 相同 issue 序列（code 升序）
- **ResearchDatasetVersionSnapshot**
  - 绑定：artifact 含 datasetVersion + rowsFingerprint + policySet + universe/snapshot 摘要 + 版本号
  - round-trip：serialize → parse → 深等 + 再序列化稳定；指纹确定
  - 内容变化（行数据）→ 版本/指纹变化；policySet 变化 → policySetFingerprint 变化
  - parse 非法输入 → 响亮抛错（不静默降级）

### `tests/server/researchDataset/pullback.test.ts`
- 215 行 ｜ 用例声明 10 ｜ describe 5
- 被测源码：`server/researchDataset/pullback.ts` · `server/data/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchDataset/pullback.test.ts`
- 用例树：
- **screenSingleTarget（触及且不破）**
  - 最低价回踩到目标位上方容差带内 → 命中
  - 跌破目标位 → 失败（broken）
  - 未回踩（最低价远高于目标位）→ 不命中
  - 目标位数据缺失 → 不可判定
- **screenPullback（多目标位）**
  - 对每个目标位分别判定并支持任一命中
- **computeMa5FromFacts**
  - 含 T0 的最近 5 日收盘均值
  - 不足 5 日返回 null
- **buildWindowBars**
  - 取 T0 之后 N 个交易日
- **screenFirstBoardRow（通用回踩筛选）**
  - 首板后回踩到涨停价容差带内（触及且不破）→ matched
  - 窗口缺交易日 → 不完整，保守排除

### `tests/server/researchDataset/tDayFilter.test.ts`
- 89 行 ｜ 用例声明 6 ｜ describe 3
- 被测源码：`server/researchDataset/tDayFilter.ts` · `server/researchDataset/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchDataset/tDayFilter.test.ts`
- 用例树：
- **limitUpRatioForRow**
  - 主板 10%、创业板/科创板 20%、北交所 30%、ST 主板 5%
  - unknown 板块 / 无代码 → null（不可判，不伪造）
- **isRowLimitUp**
  - close ≥ 涨停价 → 涨停（主板 10%）
  - ST 主板按 5% 判定
  - 价格缺失 / 板块不可判 → false（保守不入选）
- **matchesTDayCondition**
  - 四种口径判定表（首板/连板按 T-1 涨停状态区分）

### `tests/server/researchDataset/validate.test.ts`
- 81 行 ｜ 用例声明 6 ｜ describe 2
- 被测源码：`server/researchDataset/validate.ts`
- 单跑：`pnpm exec vitest run tests/server/researchDataset/validate.test.ts`
- 用例树：
- **normalizeResearchDatasetRequest**
  - 应用默认值：逐日 PIT + 4 大核心指数
  - 显式提供 fixed asOf 与 coreIndexCodes 时保留
- **validateNormalizedResearchDatasetRequest**
  - 合法请求 → 无问题
  - 非法日期 / 倒序 / 空名 → 报错
  - asOfPerTradeDate=false 缺 asOf → MISSING_AS_OF
  - asOfPerTradeDate=true 且给了 asOf → CONFLICT_AS_OF

### `tests/server/researchDataset/version.test.ts`
- 119 行 ｜ 用例声明 6 ｜ describe 2
- 被测源码：`server/researchDataset/version.ts` · `server/researchDataset/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchDataset/version.test.ts`
- 用例树：
- **computeDatasetVersion**
  - 相同输入 → 相同版本（可复现，字段顺序无关）
  - 内容变化 → 版本变化（行价格改变）
  - 请求变化（日期范围 / asOf 口径）→ 版本变化
  - universe 变化 → 版本变化
  - 版本前缀含 builder/schema 版本，哈希为 16 hex
- **computeRowsFingerprint**
  - 行序列指纹：顺序敏感、内容敏感
