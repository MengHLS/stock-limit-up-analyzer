<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/backfill

- 测试文件 **14** 个 ｜ 用例声明 **110** 个
- 涉及源码目录：`server/` · `server/backfill/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/backfill                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/backfill/canonical.test.ts`
- 78 行 ｜ 用例声明 6 ｜ describe 1
- 被测源码：`server/backfill/canonical.ts` · `server/backfill/types.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/canonical.test.ts`
- 用例树：
- **mapRawToCanonical**
  - 字段重命名映射
  - 单位转换：volume 手→shares、amount 千元→CNY
  - shares/cny 单位原样保留（不二次换算）
  - provenance 挂载
  - null 数值保持 null（不静默填零）
  - 批量映射保持输入顺序

### `tests/server/backfill/checkpoint.test.ts`
- 66 行 ｜ 用例声明 7 ｜ describe 2
- 被测源码：`server/backfill/checkpoint.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/checkpoint.test.ts`
- 用例树：
- **checkpoint 构造**
  - createPendingCheckpoint
  - toRunningCheckpoint 递增 attempts
  - toFinalCheckpoint 标记 SUCCESS + rowCount
- **MemoryCheckpointStore**
  - set/get 往返
  - get 不存在 → null
  - list 按日期范围过滤 + 排序
  - set 覆盖（upsert 语义，不产生重复）

### `tests/server/backfill/coverage.test.ts`
- 83 行 ｜ 用例声明 10 ｜ describe 3
- 被测源码：`server/backfill/coverage.ts` · `server/backfill/checkpoint.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/coverage.test.ts`
- 用例树：
- **median**
  - 奇数个
  - 偶数个
  - 空 → null
- **isSuspiciousCoverage**
  - 低于 baseline × ratio → true
  - 高于阈值 → false
  - baseline 无效 → false
- **buildCoverageReport**
  - 目标日期 vs 已完成/缺失日期
  - 低行数日判 SUSPICIOUS
  - min/max/avg 行数统计
  - 按年份聚合

### `tests/server/backfill/errors.test.ts`
- 43 行 ｜ 用例声明 7 ｜ describe 1
- 被测源码：`server/backfill/errors.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/errors.test.ts`
- 用例树：
- **classifyProviderError**
  - 限频（40203）→ RATE_LIMIT
  - 网络超时 → TRANSIENT_NETWORK
  - 5xx → TRANSIENT_NETWORK
  - 授权错误 → AUTHORIZATION
  - 未知错误 → UNKNOWN
  - 已分类的 BackfillError 原样返回
  - 非 Error 输入 → UNKNOWN

### `tests/server/backfill/pagination.test.ts`
- 116 行 ｜ 用例声明 8 ｜ describe 4
- 被测源码：`server/backfill/pagination.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/pagination.test.ts`
- 用例树：
- **compareStockDailyPriceKey**
  - 先按 tradeDate 再按 stockCode
- **isAfterStockDailyPriceCursor**
  - null 游标 → 全通过
  - 严格大于语义
- **nextStockDailyPriceCursor**
  - 页非空 → 最后一行的 key
  - 页空 → 返回原游标
- **iterateKeysetPages（100k+ 模拟行，内存有界）**
  - 分页完整、不重不漏、每页 <= batchSize
  - 空数据 → 立即终止
  - 游标未前进（防死循环）→ 有限页后终止

### `tests/server/backfill/persistence.test.ts`
- 113 行 ｜ 用例声明 9 ｜ describe 4
- 被测源码：`server/backfill/persistence.ts` · `server/backfill/types.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/persistence.test.ts`
- 用例树：
- **toNullableText**
  - null/undefined/NaN → null
  - 有限数值 → 字符串
- **rawBarToUpsert**
  - 映射到表写入候选行（raw 单位 手/千元）
  - 缺失 open/close/preClose → null（由 hasRequiredPrices 过滤）
  - toPersistableUpsert 窄化后非 null
- **persistInBatches（有界分批）**
  - 按 batchSize 分批调用 upsertFn
  - 空行 → 0 批次
  - 单批失败向上抛出
- **幂等性（§17）**
  - 同一 stockCode+tradeDate 重复映射产生相同候选行（由 DB 唯一约束承担最终一致性）

### `tests/server/backfill/pipeline.test.ts`
- 80 行 ｜ 用例声明 6 ｜ describe 1
- 被测源码：`server/backfill/pipeline.ts` · `server/backfill/types.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/pipeline.test.ts`
- 用例树：
- **runDailyPipeline**
  - 合法行 → persistRows（raw 单位 手/千元）
  - INVALID 行（OHLC 矛盾）→ 拒写并计数
  - 负 volume → INVALID 拒写
  - 缺 close → UNPERSISTABLE 计数
  - WARNING 行（缺失 amount）→ 仍写入 + warningCount
  - 混合行：合法 + INVALID + 缺价格 → 各自计数

### `tests/server/backfill/provider.test.ts`
- 76 行 ｜ 用例声明 6 ｜ describe 3
- 被测源码：`server/backfill/provider.ts` · `server/tushare.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/provider.test.ts`
- 用例树：
- **tusharePriceToRawBar**
  - 映射到 provider-neutral RawDailyBar（保留原始单位）
- **computeRawHash**
  - 空行 → null
  - 相同内容 → 相同 hash，不同内容 → 不同 hash
- **TushareMarketDataProvider**
  - 正常响应 → success + provenance
  - 空响应 → success + 0 行 + rawHash null
  - fetcher 抛错 → 向上抛出（由 retry 层分类）

### `tests/server/backfill/rateLimiter.test.ts`
- 70 行 ｜ 用例声明 7 ｜ describe 3
- 被测源码：`server/backfill/rateLimiter.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/rateLimiter.test.ts`
- 用例树：
- **resolveRequestIntervalMs**
  - 环境变量缺失 → 默认 6000
  - 环境变量合法 → 使用其值
  - 环境变量非法 → 回退默认
- **IntervalRateLimiter（间隔强制）**
  - 第一次 wait 不等待，后续在间隔内等待
  - 间隔已过则不再等待
  - 负间隔被钳制为 0（不等待）
- **NoopRateLimiter**
  - 永不等待

### `tests/server/backfill/retry.test.ts`
- 114 行 ｜ 用例声明 7 ｜ describe 4
- 被测源码：`server/backfill/errors.ts` · `server/backfill/retry.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/retry.test.ts`
- 用例树：
- **withRetry — 成功路径**
  - 首次成功，无重试
- **withRetry — 瞬态重试（1s/2.5s/5s，最多 3 次）**
  - 瞬态失败一次后成功
  - 瞬态连续失败 3 次后放弃（等待 1s/2.5s/5s）
- **withRetry — 限频 60s 一次 + QUOTA_STOP**
  - 限频一次后成功（等待 60s 一次）
  - 限频两次 → QUOTA_STOP（不再无限重试）
- **withRetry — 授权/未知错误不重试**
  - 授权错误立即失败
  - 未知错误立即失败

### `tests/server/backfill/scheduler.test.ts`
- 188 行 ｜ 用例声明 6 ｜ describe 1
- 被测源码：`server/backfill/scheduler.ts` · `server/backfill/checkpoint.ts` · `server/backfill/rateLimiter.ts` · `server/backfill/types.ts` · `server/db.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/scheduler.test.ts`
- 用例树：
- **BackfillScheduler**
  - 顺序执行全部交易日，persist 成功后标记 SUCCESS
  - 断点续传：已 SUCCESS 日期不重新下载
  - 幂等：重复运行不产生重复写入
  - 配额停止：40203 → 等待后重试仍失败 → QUOTA_STOPPED 并中断
  - persist 失败 → 标记 FAILED（绝不 SUCCESS）
  - scheduler 仅调用 upsert，不 delete/truncate（既有数据保护）

### `tests/server/backfill/tradingCalendar.test.ts`
- 47 行 ｜ 用例声明 4 ｜ describe 2
- 被测源码：`server/backfill/tradingCalendar.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/tradingCalendar.test.ts`
- 用例树：
- **parseTradeCalPayload**
  - 解析 cal_date/is_open，只保留 isOpen=1
  - 错误码 → 抛错
  - 缺少字段 → 抛错
- **extractTradingDates**
  - 只提取 isOpen=true 的日期并升序去重

### `tests/server/backfill/units.test.ts`
- 83 行 ｜ 用例声明 12 ｜ describe 2
- 被测源码：`server/backfill/units.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/units.test.ts`
- 用例树：
- **Tushare 单位转换（§16）**
  - vol=1234（手）→ volume=123400（shares）
  - amount=5678（千元）→ amount=5,678,000（CNY）
  - 组合转换 vol=1234 / amount=5678
  - 整数转换
  - 小数转换
  - 0 转换（0 手 = 0 股，0 千元 = 0 元）
  - 常量正确：1 手 = 100 股，1 千元 = 1000 元
- **normalizeVolumeToShares / normalizeAmountToCny**
  - null 原样返回 null（不静默填零）
  - hands ×100、shares 原样
  - thousand-cny ×1000、cny 原样
  - 非有限数值 → null（NaN/Infinity 不参与换算）
  - 极端大值不溢出为 Infinity（在安全整数范围内）

### `tests/server/backfill/validation.test.ts`
- 100 行 ｜ 用例声明 15 ｜ describe 2
- 被测源码：`server/backfill/validation.ts` · `server/backfill/types.ts`
- 单跑：`pnpm exec vitest run tests/server/backfill/validation.test.ts`
- 用例树：
- **validateCanonicalBackfillBar**
  - 合法 bar → VALID
  - 空 symbol → INVALID
  - 非法日期 → INVALID
  - 负价格 → INVALID
  - NaN / Infinity → INVALID
  - 负 volume → INVALID
  - 负 amount → INVALID
  - OHLC 矛盾：low > high → INVALID
  - OHLC 矛盾：high < close → INVALID
  - OHLC 矛盾：low > open → INVALID
  - 缺失字段 → WARNING（非 INVALID）
  - 格式异常代码 → WARNING（MALFORMED_CODE）
  - tradeDate 不在交易日历内 → WARNING（NON_TRADING_DATE）
- **isValidTradeDate**
  - 合法日期
  - 非法格式 / 非法日期
