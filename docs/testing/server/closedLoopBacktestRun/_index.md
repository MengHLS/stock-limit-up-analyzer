<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/closedLoopBacktestRun

- 测试文件 **3** 个 ｜ 用例声明 **20** 个
- 涉及源码目录：`server/` · `server/closedLoopBacktestRun/` · `shared/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/closedLoopBacktestRun                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/closedLoopBacktestRun/persistRetry.test.ts`
- 154 行 ｜ 用例声明 5 ｜ describe 1
- 被测源码：`server/researchRunRouter.ts` · `shared/researchContracts.ts`
- 单跑：`pnpm exec vitest run tests/server/closedLoopBacktestRun/persistRetry.test.ts`
- 用例树：
- **BD-24 · 闭环留档重试（长算后连接被掐）**
  - C1 · 前 3 次 ECONNRESET、第 4 次成功 ⇒ **生产默认参数下**必须留档成功
  - C2 · 非瞬时错误 ⇒ 只尝试一次、立即放弃（不重试、不抛）
  - C3 · 全瞬时失败 ⇒ 不抛（best-effort 不变式）+ 用尽尝试 + 响亮告警
  - C4 · 首次即成功 ⇒ 零重试、零告警
  - C5 · 瞬时判定穿透 Drizzle 的 cause 包装（最外层 message 无 ECONNRESET 字样也要认）

### `tests/server/closedLoopBacktestRun/securityLabels.test.ts`
- 139 行 ｜ 用例声明 9 ｜ describe 1
- 被测源码：`server/closedLoopBacktestRun/securityLabels.ts`
- 单跑：`pnpm exec vitest run tests/server/closedLoopBacktestRun/securityLabels.test.ts`
- 用例树：
- **buildSecurityLabels**
  - A) 标识与名称都齐 ⇒ 名称 + canonical 代码都对
  - B) 名称源未收录 ⇒ name 为 null，但 code 仍在（不连带丢代码）
  - C) identity 不在标识历史里 ⇒ 三字段全 null（不猜、不拼）
  - D) 非 primary 标识不参与解析（须严格等于 null，不能擅自兜底用次类标识）
  - E) 同代码名称漂移 ⇒ 取最近日期那一条
  - F) 输出顺序与入参逐位对应（未命中占位，前端按序索引）
  - G) 代码与交易所后缀冲突 ⇒ code 为 null（拒绝静默猜测）
  - H) 空入参 ⇒ 空数组
  - I) 全库归一：同一 securityId 有多条 primary 时取第一条（不静默取最后一条）

### `tests/server/closedLoopBacktestRun/summary.test.ts`
- 202 行 ｜ 用例声明 6 ｜ describe 1
- 被测源码：`server/closedLoopBacktestRun/summary.ts` · `shared/researchContracts.ts`
- 单跑：`pnpm exec vitest run tests/server/closedLoopBacktestRun/summary.test.ts`
- 用例树：
- **buildClosedLoopBacktestRunSummary**
  - A. 完整结果 ⇒ 摘要逐字段正确，且与结果同源
  - B. assembly 为 null ⇒ 数据来源类字段全 null，且不抛错
  - C. backtest 阶段未 EXECUTED ⇒ 成交与权益为 null（不是 0）
  - C2. 产出 kind 不是 backtestSummary ⇒ 同样取不到（不误读其它阶段的产出）
  - D. 真实 0 与「取不到」必须区分：0 笔成交如实记 0
  - E. 类型不合法（字符串数字 / NaN）⇒ 一律 null，不做隐式转换不猜测
