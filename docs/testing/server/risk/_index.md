<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/risk

- 测试文件 **2** 个 ｜ 用例声明 **50** 个
- 涉及源码目录：`server/engine/` · `server/risk/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/risk                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/risk/risk.fix.test.ts`
- 341 行 ｜ 用例声明 15 ｜ describe 6
- 被测源码：`server/risk/index.ts` · `server/engine/execution.ts` · `server/engine/domain.ts` · `server/engine/engine.ts` · `server/engine/portfolio.ts`
- 单跑：`pnpm exec vitest run tests/server/risk/risk.fix.test.ts`
- 用例树：
- **P1-F1 敞口估值价格口径一致**
  - 已有持仓敞口按决策时点开盘价估值，组合敞口不突破上限
  - snapshotPositionsAt 与 equityAt 共用同一价格口径
- **P2-F2 CashPolicy 滑点口径**
  - slippedBuyPriceAdjusted 按参考成交额做流动性分层，与 base 滑点区分
  - CashPolicy 用 amount-adjusted 滑点，不再高估可成交数量
- **P2-F3 风险层统一入口**
  - buildDefaultRiskManager 从 config 对齐构建（maxPositions 生效）
  - buildDefaultRiskManager 对齐容量约束（maxPositionAmountRatio）
  - runBacktestWithRisk 默认注入 RiskManager，产生可解释的 riskDecisions
  - runBacktestWithRisk 缺省 manager 会执行容量/资金约束（不静默绕过风险层）
- **buildRiskContext 快照口径**
  - positions 按传入价格估值，portfolioExposure 与之同源
- **P3-F5 同 symbol 加仓语义对齐**
  - Policy 层：MaxPositionsPolicy 对已持仓 symbol 的 BUY 返回 ADD_POSITION_NOT_SUPPORTED
  - Policy 层：加仓拦截优先于开仓数上限检查（同 symbol + 持仓数满 → 仍报 ADD_POSITION_NOT_SUPPORTED）
  - 集成层：同 symbol 加仓 → 风险 REJECT 且最终无成交，风险层与 Portfolio 兜底一致
- **P3-F4 CapacityPolicy 命名修复**
  - 类名 CapacityPolicy 已替换 MaxPositionExposurePolicy，name="capacity"
  - 所有 violation 统一使用 CAPACITY_EXCEEDED（含 REJECT 与 RESIZE 两个分支）
  - 容量约束与敞口约束语义清晰分离（capacity/symbol-exposure/portfolio-exposure 互不混用）

### `tests/server/risk/risk.test.ts`
- 537 行 ｜ 用例声明 35 ｜ describe 7
- 被测源码：`server/risk/index.ts` · `server/engine/execution.ts` · `server/engine/domain.ts` · `server/engine/engine.ts`
- 单跑：`pnpm exec vitest run tests/server/risk/risk.test.ts`
- 用例树：
- **Risk Policy**
  - maxPositions：开仓数达上限时新 BUY 被 REJECT
  - maxPositions：已有同 symbol 持仓视为加仓 → 直接 REJECT ADD_POSITION_NOT_SUPPORTED
  - capacity：容量不足时 RESIZE 到容量上限（向下取整到整手）
  - capacity：容量不足以成交一手 → REJECT
  - capacity：ratio=0（不限）→ APPROVE
  - maxPortfolioExposure：组合总敞口超限 → RESIZE
  - maxPortfolioExposure：剩余敞口不足以成交一手 → REJECT
  - insufficientCash：资金不足 → RESIZE 到可负担最大整手
  - insufficientCash：不足以负担一手 → REJECT
  - lotSize：非整手买入 → REJECT INVALID_LOT_SIZE（不自动修正）
  - lotSize：整手买入 → APPROVE
- **Position Sizing**
  - fixed quantity：固定 1000 股
  - fixed capital：10% 资金 → 1000 股（100000×0.1/10）
  - fixed weight：10% 权重 → 1000 股
  - risk capped：最大风险 1%、止损 10% → 1000 股（1000/1）
  - 所有模型向下取整到整手
  - 缺少有效价格 → 返回 0
- **RiskManager 组合**
  - 全部 APPROVE → APPROVE，数量不变
  - 任一 REJECT → REJECT，合并所有违规记录
  - 多个 RESIZE → 取所有限制的最小值
  - RESIZE 后不足一手 → REJECT INSUFFICIENT_LOT
  - REJECT 短路：后续 policy 不再执行
- **Safety（未来函数 / 确定性 / 隔离）**
  - 确定性：相同输入两次检查结果深度相等
  - 未来函数防护：Policy 只读 context，不访问未来数据（无 Date.now / Math.random / 网络）
  - 实例隔离：Policy 无 module-level mutable state
- **Golden Test**
  - 完整风险决策管道（人工计算）
  - 完整管道：资金约束兜底（现金只够 400 股）
  - 完整管道：非整手直接 REJECT（lotSize 合法性校验）
- **buildRiskContext**
  - 正确计算组合敞口与单标的敞口
  - equity<=0 时以 1 兜底，避免除零
- **RiskManager + Backtest Core 集成**
  - 风险决策管道驱动 Backtest Core 成交，并记录 RiskDecisionTrace
  - 风险决策 RESIZE 后按批准数量成交
  - 风险决策 REJECT 后不成交，记录追踪
  - 未来数据污染：T+1 成交日 amount 变化不影响风险决策结果
  - 确定性：风险管道两次运行深度相等
