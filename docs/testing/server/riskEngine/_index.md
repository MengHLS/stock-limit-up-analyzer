<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/riskEngine

- 测试文件 **1** 个 ｜ 用例声明 **18** 个
- 涉及源码目录：`server/portfolio/` · `server/riskEngine/` · `shared/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/riskEngine                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/riskEngine/riskEngine.test.ts`
- 295 行 ｜ 用例声明 18 ｜ describe 3
- 被测源码：`shared/quant-stats.ts` · `server/portfolio/index.ts` · `server/riskEngine/index.ts`
- 单跑：`pnpm exec vitest run tests/server/riskEngine/riskEngine.test.ts`
- 用例树：
- **Risk Engine · validateOrder（Pre-Trade）**
  - 合法买入 PASS
  - 合法卖出 PASS
  - INVALID_ORDER：空 symbol / 非整手 / 非正数量 / 缺价
  - INVALID_ORDER：卖出无持仓 / T+1 可卖不足
  - INSUFFICIENT_CASH
  - MAX_POSITION：开新仓超过持仓数上限
  - MAX_EXPOSURE：单一标的敞口超限
  - MAX_EXPOSURE：总敞口超限
  - MAX_EXPOSURE：行业权重超限
  - RISK_LIMIT：回撤超限禁止新增风险
  - RISK_LIMIT：单日亏损超限禁止新增风险
- **Risk Engine · calculatePortfolioRisk（Post-Trade）**
  - 敞口 / 集中度 / 行业 / 回撤 / 单日亏损 / 波动率正确
  - 行业敞口支持 sectorOf 注入（接口）
  - 限额击穿列表正确
  - 无历史上下文时 drawdown/dailyLoss 为 0、波动率为 null
  - determinism：相同输入产生完全一致的 RiskSnapshot
- **Risk Engine · RiskLimit 校验**
  - 合法限额通过，非法限额被捕获
  - 数值型限额 <= 0 表示不启用该检查（0=不限口径）
