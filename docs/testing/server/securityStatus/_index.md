<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/securityStatus

- 测试文件 **3** 个 ｜ 用例声明 **40** 个
- 涉及源码目录：`server/security/` · `server/securityStatus/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/securityStatus                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/securityStatus/baostockStatus.test.ts`
- 128 行 ｜ 用例声明 10 ｜ describe 4
- 被测源码：`server/securityStatus/baostockStatus.ts`
- 单跑：`pnpm exec vitest run tests/server/securityStatus/baostockStatus.test.ts`
- 用例树：
- **mergeConsecutiveRuns（连续段合并）**
  - 单个连续段 → 一个区间
  - 多段被交易日隔开 → 多个区间
  - 边界：首/末行命中
  - null 字段不命中
- **inferSuspensionIntervals（停牌区间）**
  - 连续停牌段合并为 SUSPENSION/SUSPENDED 区间，标注 medium/UNKNOWN/baostock-daily
  - 无停牌日 → 空区间
- **inferStIntervals（ST 区间）**
  - 连续 isST=1 段合并为 ST/ST 区间
  - isST 为二进制，不产生 *ST（诚实不做越级推断）
- **inferBaostockStatusIntervals（合并入口）**
  - 停牌 + ST 同时存在时两维度都产出
  - 空输入 → 空

### `tests/server/securityStatus/pointInTime.test.ts`
- 114 行 ｜ 用例声明 12 ｜ describe 4
- 被测源码：`server/securityStatus/pointInTime.ts` · `server/security/tradingCalendar.ts` · `server/securityStatus/validation.ts` · `server/securityStatus/types.ts`
- 单跑：`pnpm exec vitest run tests/server/securityStatus/pointInTime.test.ts`
- 用例树：
- **isEffectiveOn（区间生效，闭区间）**
  - 闭区间端点生效（from/to 均含）
  - effectiveTo=null 为开放区间（至今）
- **statusKnowledgeDate（effective 与 retrieved 分离）**
  - IMMEDIATE → effectiveFrom 当日
  - T_PLUS_1 无交易日历 → null（fail-safe，禁止退回自然日）
  - UNKNOWN + retrievedAt → 取 retrievedAt 日期
  - UNKNOWN 且无 retrievedAt → null（不可用于 as-of 推理）
- **isKnowableBy（无未来泄漏）**
  - asOf 早于可知日 → 不可知；晚于/等于 → 可知
  - T_PLUS_1 无交易日历 → 永不可知（fail-safe）
  - UNKNOWN 且无 retrievedAt → 任何 asOf 均不可知
- **validateStatusInterval（校验）**
  - 合法区间 → 无问题
  - 非法 security_id / statusType / statusValue / 倒置区间 均报告
  - isValidStatusValue：ST 维度接受 NORMAL/ST/*ST，拒绝其它

### `tests/server/securityStatus/timeline.test.ts`
- 188 行 ｜ 用例声明 18 ｜ describe 3
- 被测源码：`server/securityStatus/timeline.ts` · `server/securityStatus/suspensionAdapter.ts` · `server/security/tradingCalendar.ts` · `server/securityStatus/types.ts`
- 单跑：`pnpm exec vitest run tests/server/securityStatus/timeline.test.ts`
- 用例树：
- **resolveSecurityStatus — as-of 查询**
  - 案例1+8：历史 ST 不回填当前 ST；显式历史区间正确
  - 案例2：status interval 边界（effectiveFrom/effectiveTo 闭区间）
  - 案例5：listing（上市）与 案例6：delisting（退市）
  - 案例7：unknown — 无数据维度不默认填充
  - 案例9：as-of 只解析指定日期；不同日期得不同状态
  - 案例10：no future leakage — point-in-time asOf 排除未来才可知的状态
  - asOf=null（全知视角）不排除未来可知状态
  - 多区间重叠：挑最新 effectiveFrom（确定性）
- **isTradable（UNKNOWN 不默认 TRADING）**
  - TRADING=TRADING + LISTED + 无停牌 → true
  - TRADING=SUSPENDED → false
  - TRADING=UNKNOWN → false（不默认 TRADING）
  - TRADING 缺失 → false
  - 案例3/4：suspension 停牌 + resume 复牌
  - LISTING=DELISTED 即使 TRADING=TRADING 也不可交易
  - isTradableFromSnapshot 与 isTradableFromIntervals 一致
  - 按 securityId 隔离（不串其它证券的状态）
- **suspensionWindowsToStatusIntervals（停牌适配器）**
  - 解析成功 → SUSPENSION/SUSPENDED；manual 高置信 / 反推中置信
  - 无法解析 code → 跳过并上报，绝不把 stockCode 当 security_id
