<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/portfolio

- 测试文件 **1** 个 ｜ 用例声明 **17** 个
- 涉及源码目录：`server/portfolio/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/portfolio                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/portfolio/portfolio.test.ts`
- 197 行 ｜ 用例声明 17 ｜ describe 7
- 被测源码：`server/portfolio/index.ts`
- 单跑：`pnpm exec vitest run tests/server/portfolio/portfolio.test.ts`
- 用例树：
- **Portfolio Engine · Buy**
  - 买入扣减现金 = 成交额 + 买入费用，并建立持仓
  - 非整手买入被拒绝且不改变状态
  - 资金不足被拒绝且不改变状态
- **Portfolio Engine · Sell**
  - 清仓：现金增加 = 卖出所得，realized PnL 精确
  - T+1 锁定：当日买入不可卖出
  - rollover 后 T+1 释放可卖数量
  - 部分减仓：按比例结转成本基，剩余持仓成本不变
  - 卖出无持仓被拒绝
- **Portfolio Engine · Accounting（Fee/Tax/Cash）**
  - 买入费用 = 佣金 + 过户费（无印花税）
  - 卖出费用含印花税，买入印花税为 0
  - computeFill 现金变动方向正确
- **Portfolio Engine · Average Cost（加权平均）**
  - 加仓后平均成本 = 总成本基 / 总股数
- **Portfolio Engine · Mark-to-Market & Exposure**
  - unrealized PnL 与 exposure 正确
- **Portfolio Engine · Accounting Integrity（资金守恒）**
  - 任意时点 equity − initialCash = realizedPnL + unrealizedPnL
  - 全清仓后 realizedPnL 仍保留（不随持仓删除归零）
- **Portfolio Engine · Determinism**
  - 相同操作序列产生完全一致的快照
  - 独立实例互不污染
