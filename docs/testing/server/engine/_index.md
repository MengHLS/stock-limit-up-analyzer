<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/engine

- 测试文件 **3** 个 ｜ 用例声明 **63** 个
- 涉及源码目录：`server/data/` · `server/engine/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/engine                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/engine/edgeCases.test.ts`
- 258 行 ｜ 用例声明 18 ｜ describe 5
- 被测源码：`server/engine/execution.ts` · `server/engine/engine.ts` · `server/data/boardRules.ts` · `server/engine/domain.ts`
- 单跑：`pnpm exec vitest run tests/server/engine/edgeCases.test.ts`
- 用例树：
- **G3 P3-T4 · 涨跌停可成交性**
  - blockLimitUpBuy=true 时，开盘触及涨停的买入被拒绝
  - blockLimitUpBuy=false（默认）时，开盘涨停仍可买入
  - blockLimitDownSell=true 时，开盘触及跌停的卖出被拒绝
  - 跌停卖出拒绝只发生在 blockLimitDownSell=true（默认不拦截）
  - 缺少前收盘价时无法判定涨跌停 → 拒绝成交（不静默放行）
- **G3 P3-T4 · 停牌 / 数据缺失**
  - 买入信号在成交日无 bar（停牌）→ 信号作废，不成交、不产生持仓
  - 持仓股在卖出日停牌 → 卖出作废，持仓保留（不复牌前不得强平）
- **G3 P3-T4 · 板块涨跌停幅度**
  - 主板非 ST：10%
  - 主板 ST：5%
  - 创业板（300/301）：20%
  - 科创板（688/689）：20%
  - 北交所：30%
  - 无法识别代码 → supported=false（不得假装支持）
  - ST 判定严格：STORE/STAR 等 ASCII 名称不误判为 ST
  - 板块归类：60 主板 / 300 创业板 / 688 科创板 / 920 北交所
- **G3 P3-T4 · maxHoldingDays 时间退出**
  - maxHoldingDays=2：持有满 2 个交易日后强制卖出，下一交易日成交
- **G3 P3-T4 · 费用完整性**
  - 印花税仅在卖出收取，买入不含印花税
  - 最低佣金 5 元对小额成交生效

### `tests/server/engine/engine.fix.test.ts`
- 284 行 ｜ 用例声明 16 ｜ describe 5
- 被测源码：`server/engine/execution.ts` · `server/engine/portfolio.ts` · `server/engine/engine.ts` · `server/engine/domain.ts`
- 单跑：`pnpm exec vitest run tests/server/engine/engine.fix.test.ts`
- 用例树：
- **P1-1 maxPositions 生效**
  - maxPositions=1 时多个 BUY 信号只建仓一个 symbol
  - Portfolio 层直接拒绝超限建仓
- **P1-2 maxPositionAmountRatio 生效（amount 单位千元）**
  - 容量足够 → 不截断，正常交易
  - 容量不足 → 数量被截断到容量上限（向下取整到整手）
  - 容量不足以成交一手 → 不成交
  - 资金约束与容量约束同时存在时取较小值
- **P1-3 Future Leakage 修复**
  - bar.amount（T+1 当日）变化不影响成交价，成交价只由 referenceAmount 决定
  - T+1 / T+2 的 amount 变化不影响 T+1 开盘成交价
  - 容量约束（maxPositionAmountRatio>0）使用信号日 amount，成交日 amount 变化不影响买入数量
  - 容量截断基于信号日 amount 而非成交日 amount
- **P2 lotSize 校验**
  - 50 股 BUY → 拒绝 INVALID_LOT_SIZE
  - 150 股 BUY → 拒绝 INVALID_LOT_SIZE
  - 100 股 BUY → 成交
  - 200 股 BUY → 成交
- **Portfolio Invariants**
  - 多约束场景下全部不变量成立
  - Invariant 5: 单笔成交金额 <= 容量上限

### `tests/server/engine/engine.test.ts`
- 394 行 ｜ 用例声明 29 ｜ describe 5
- 被测源码：`server/engine/execution.ts` · `server/engine/portfolio.ts` · `server/engine/performance.ts` · `server/engine/engine.ts` · `server/engine/domain.ts`
- 单跑：`pnpm exec vitest run tests/server/engine/engine.test.ts`
- 用例树：
- **成本模型（手续费 / 滑点）**
  - 买入滑点上浮、卖出滑点下浮
  - 买入费用 = 佣金 + 过户费（无印花税）
  - 卖出费用 = 佣金 + 印花税 + 过户费
  - 最低佣金生效
- **Portfolio 引擎**
  - 初始资金
  - 单次买入扣减现金并建立持仓
  - 资金不足拒绝买入且不改变状态
  - 单次卖出清仓并结转已实现收益
  - 持仓不足拒绝卖出
  - 卖出无持仓股票被拒绝
  - 持仓市值与未实现收益
  - 同一股票已有持仓不支持加仓
  - 状态隔离：两个 Portfolio 互不影响
- **ExecutionModel**
  - 正常买入以开盘价 + 滑点成交
  - 缺少开盘价拒绝成交
  - 可配置禁止追涨停买入
- **Performance Analytics**
  - 最大回撤
  - 日收益率序列
  - 胜率 / Profit Factor / 平均盈亏 / Trade Count
  - Sharpe 与 CAGR 分离（CAGR 用几何年化，Sharpe 用算术年化）
  - 无交易时指标为空/安全默认值
  - completedTrades 只统计已平仓且净盈亏非空的
- **Backtest Engine**
  - Golden Test：人工计算确定的一买一卖
  - 空交易：无信号返回安全结果
  - 确定性：相同输入产生相同输出
  - 状态隔离：连续回测互不污染
  - 日期边界：endDate 之后的数据不参与回测
  - 未来数据不影响历史结果：增加 endDate 之后的 bar 不改变结果
  - T+1 规则：信号日收盘后产生，下一交易日开盘成交
