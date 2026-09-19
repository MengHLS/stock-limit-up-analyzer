<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/corporateActions

- 测试文件 **4** 个 ｜ 用例声明 **62** 个
- 涉及源码目录：`server/corporateActions/` · `server/data/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/corporateActions                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/corporateActions/backtestIntegration.test.ts`
- 368 行 ｜ 用例声明 24 ｜ describe 8
- 被测源码：`server/data/types.ts` · `server/corporateActions/engine.ts` · `server/corporateActions/integration.ts` · `server/corporateActions/portfolioTransform.ts`
- 单跑：`pnpm exec vitest run tests/server/corporateActions/backtestIntegration.test.ts`
- 用例树：
- **PIT 审计 — 未来公司行为不得提前影响 decisionTime**
  - forward 复权在事件生效前就已反映未来事件（前复权天然含未来函数，需禁用）
  - backward 复权在事件生效前不含未来事件（后复权 PIT-safe）
  - isCorporateActionKnownAt：announcementDate 决定可知性，而非 effectiveDate
  - isCorporateActionKnownAt：announcementDate 缺失（null）→ 保守不可知，杜绝 look-ahead
  - filterActionsKnownAt：未来公告事件被过滤，不泄漏进 decisionTime
  - actionsEffectiveOnOrBefore：backward 复权只取已生效事件
- **Reconciliation — provider 因子 vs semantic 因子**
  - 一致（误差 < 1e-3）→ matches
  - 不一致（误差 > 容差）→ 不匹配，可检测 factor mismatch
  - provider 因子非法（0/NaN）→ 不匹配
- **Missing event — 缺失事件不静默伪造**
  - 事件缺失时 adjusted == raw（不崩溃、不发明因子）
  - 事件缺失 → 与 provider 因子对账可检测到缺口
  - 含现金分红的事件早于 raw 序列起点 → 确定性抛错（不静默跳过）
- **Raw price immutability — raw 历史价格不可变**
  - 复权后 raw OHLCV 逐字节不变，且 adjustment 标记保持 raw
- **Portfolio Corporate Action Transformation — 数量变换**
  - split（1 拆 N）→ 股数 ×N、成本基不变、均价 ÷N
  - bonus（送股）→ 股数 ×(1+b)、成本基不变、均价摊薄
  - transfer（转增）→ 与送股同语义
  - reverse_split（N 合 1）→ 股数 ÷N、均价 ×N、成本基不变
- **Portfolio Corporate Action Transformation — 现金变换**
  - cash dividend → 现金 += D×q，股数不变，成本基不变
  - rights issue → 现金 -= s×q×rightsPrice，股数 ×(1+s)，成本基 += 认购支出
- **Portfolio Corporate Action Transformation — 成本基与已实现盈亏**
  - 成本基不变量：拆股后按复权价卖出，已实现盈亏与经济等价
  - 现金分红计入现金、成本基不变 → 总收益正确（除权后卖出）
  - 公司行为本身不产生已实现盈亏（realizedPnLDelta 恒 0）
- **Portfolio Corporate Action Transformation — 同日多事件合并**
  - 同日 分红 + 转增 + 配股 → 合并为一次除权（同一 base 股数）
  - 跨日多事件 → 逐日顺序应用，确定性一致

### `tests/server/corporateActions/corporateActions.test.ts`
- 476 行 ｜ 用例声明 24 ｜ describe 5
- 被测源码：`server/data/types.ts` · `server/corporateActions/index.ts`
- 单跑：`pnpm exec vitest run tests/server/corporateActions/corporateActions.test.ts`
- 用例树：
- **复权引擎 — 单事件前向因子**
  - no action → 因子恒 1，adjusted == raw
  - dividend → forward = (P0 - D) / P0
  - split → forward = 1 / N
  - bonus（送股）→ forward = 1 / (1 + b)
  - rights issue（配股）→ (P0 + s*Pr) / (P0*(1+s))
  - reverse split（合股）→ forward = N
  - 缺 preClose 的现金分红事件 → 确定性抛错
- **复权引擎 — 序列级累计因子与 adjusted 输出**
  - dividend 序列：前复权消跳空、后复权锚定最早
  - multiple actions（分红+拆股）→ 累计链，前复权/后复权均连续
  - same-day action（同日分红+转增）→ 合并为一次除权
  - historical chain：fore 单调趋近 1，back 单调递增
  - adjusted output：OHLC 同因子缩放、volume/amount 不变、adjustment 标记正确
  - determinism：100 次执行结果完全一致
  - raw preservation：复权不改动原始 raw bar 对象
- **复权引擎 — provider 累计因子直接复权路径**
  - 前复权：最新锚定 1，历史按台阶缩放
  - 后复权：最早锚定 1，之后按台阶缩放
- **BaoStock Provider 归一化**
  - toSecurityCode 转换交易所后缀
  - parseBaoStockAdjustFactors 解析累计因子
  - parseBaoStockDividendActions 拆分组合事件（转增+分红）
  - parseBaoStockDividendActions 拆分送股+分红（10送1派43.74）
- **数据校验**
  - 合法事件 → VALID
  - 非法日期 / 负金额 → INVALID
  - 拆分缺 splitRatio → WARNING
  - 非法复权因子 → INVALID

### `tests/server/corporateActions/fullMarket.test.ts`
- 111 行 ｜ 用例声明 6 ｜ describe 3
- 被测源码：`server/corporateActions/fullMarket.ts` · `server/corporateActions/provider.ts`
- 单跑：`pnpm exec vitest run tests/server/corporateActions/fullMarket.test.ts`
- 用例树：
- **daily_adjust_factor 解析（全市场逐日返回）**
  - 5 列行复用 parseBaoStockAdjustFactors 正确解析 fore/back，忽略第 5 列
- **全市场批处理聚合（跨日合并 + 去重，幂等）**
  - 跨多个交易日的行合并后按 (code, effectiveDate) 去重，duplicates 计数
  - 幂等：同一输入重复聚合，结果完全一致（第二次无新增重复）
  - 非法行（缺日期/因子非正）计 skipped，不产出因子
- **事件股票推导与分块**
  - distinctEventCodes 从因子推导去重升序的股票代码
  - chunk 按固定大小分块且不丢元素

### `tests/server/corporateActions/tushareProvider.test.ts`
- 171 行 ｜ 用例声明 8 ｜ describe 3
- 被测源码：`server/corporateActions/tushareProvider.ts`
- 单跑：`pnpm exec vitest run tests/server/corporateActions/tushareProvider.test.ts`
- 用例树：
- **parseTushareDividend**
  - 现金分红：每10股派28.02423 → 每股2.802423，PIT 三字段严格区分
  - 组合事件：10送3转7派2 → 拆为 bonus_issue + transfer + dividend 三事件，各持单一 actionType
  - 送股字段缺失时用 stk_bo_rate 兜底，且不与 stk_div 重复计数
  - ex_date 缺失：计 missingExDate，不产出事件（禁止假设 effectiveDate）
  - 同批内同 (effectiveDate, actionType) 去重，保留公告日更早者
- **parseTushareAdjFactor**
  - 逐日因子只保留变化点；back=adj、fore=adj/latest；首行基线不产出
  - 因子非正或日期非法 → 跳过
- **isTusharePermissionLimited**
  - 识别 40203/频率超限
