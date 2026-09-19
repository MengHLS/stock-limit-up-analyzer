<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/features

- 测试文件 **2** 个 ｜ 用例声明 **14** 个
- 涉及源码目录：`server/` · `server/data/` · `server/engine/` · `server/features/` · `server/strategy/` · `server/strategy/strategies/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/features                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/features/features.golden.test.ts`
- 239 行 ｜ 用例声明 3 ｜ describe 1
- 被测源码：`server/engine/engine.ts` · `server/data/index.ts` · `server/features/index.ts` · `server/strategy/adapter.ts` · `server/leaderCandidates.ts` · `server/strategy/registry.ts` · `server/strategy/contract.ts` · `server/strategy/strategies/leaderCandidateBaseline.ts` · `server/engine/execution.ts` · `server/engine/domain.ts`
- 单跑：`pnpm exec vitest run tests/server/features/features.golden.test.ts`
- 用例树：
- **STEP 5 Golden Test：Raw → … → Backtest Core 全链路**
  - 数据管道：raw 行 → canonical → VALID；feature pipeline 产出 READY snapshot
  - Strategy Context：features 经 registry.evaluate 到达策略（probe 读取 sma 值）
  - 全链路：既有候选策略 + 统一入口（含 Risk 层）驱动 Backtest Core 成交且语义未破坏

### `tests/server/features/features.pipeline.test.ts`
- 179 行 ｜ 用例声明 11 ｜ describe 3
- 被测源码：`server/data/index.ts` · `server/features/index.ts`
- 单跑：`pnpm exec vitest run tests/server/features/features.pipeline.test.ts`
- 用例树：
- **Future Leakage — 破坏性测试**
  - Feature(T)：修改 T+1/T+2 的 close/high/low/volume/amount 后结果完全一致
  - Feature(T)：删除 T+1 及全部未来数据后重新计算，结果与原结果一致
  - 单个 feature（sma/return/avgAmount/volatility/limitUpHit）同样不受未来数据影响
- **Decision Time — asOf / Availability**
  - T 开盘决策看不到 T 的 high/low/close/volume/amount：可见序列以 T-1 截止
  - T 开盘决策：sma3 值等于截至 T-1 收盘的 sma3（T 当日信息不影响）
  - T 开盘决策：把 T 的 close 改到天价不影响以 open 决策的快照
- **Determinism / Isolation / Warm-up / Registry**
  - Determinism：相同输入运行 100 次结果完全一致
  - Instance Isolation：period=20 与 period=60 实例互不影响，无共享可变状态
  - Warm-up：数据不足 → INSUFFICIENT_DATA（requiredBars 与 availableBars 明确）
  - INVALID_DATA：窗口内字段缺失不静默跳过
  - Registry：重复注册抛错、未知 id 抛错、幂等注册可重复调用
