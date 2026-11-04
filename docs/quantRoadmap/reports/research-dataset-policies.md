# Research Dataset 9 项 Policy 冻结（P2-T3 / G2）

> 版本：v1.0 | 冻结日期：2026-09-09 | 状态：FROZEN
> 权威源码：`server/researchDataset/policy.ts`（`derivePolicySet` / `deriveExpectedPolicyValue`）
> 一致性校验：`server/researchDataset/policyValidate.ts`（`validateResearchDatasetPolicyConsistency`）
> 依据：ROADMAP §12（策略元数据集）+ §45.2（PIT/Survivorship 铁律）

---

## 0. 冻结声明

本文件冻结 Research Dataset 的 **9 类 policy** 的权威口径（机器可读、确定性、可校验）。
任何修改 policy 语义必须走 Gate Change Proposal（见 `docs/RESEARCH_GATE_SPECIFICATION.md` §5），
并递增 `RESEARCH_DATASET_POLICY_SCHEMA_VERSION`。

- **policy schema 版本**：`1`（`RESEARCH_DATASET_POLICY_SCHEMA_VERSION`）
- **权威顺序**（`RESEARCH_DATASET_POLICY_ORDER`）：`pit → survivorship → corporate-action → adjustment → industry → liquidity → universe-membership → calendar-trading-days → knowledge`
- **派生方式**：`derivePolicySet(request, dataSnapshot)` 纯函数，由规范化请求 + 数据快照派生 9 条声明；每条含 `policyId / class / name / description / value / evidence`。

---

## 1. 九类 policy 权威定义

| # | policyId | 名称 | 权威口径（value 派生规则） |
|---|----------|------|---------------------------|
| 1 | `pit` | PIT 策略 | `asOfPerTradeDate=true → {mode:"asOfPerTradeDate", asOf:null}`；`false → {mode:"fixed", asOf:request.asOf}` |
| 2 | `survivorship` | 幸存者偏差策略 | 固定三真值：`membershipIsPointInTime / masterIncludesDelistedSecurities / delistedNotRenderedAsEligibleRows = true` |
| 3 | `corporate-action` | 公司行为策略 | 双层口径：`effectiveLayerRule="effectiveDate<=tradeDate"`，`knownLayerRule="announcementDate<=asOf"`，`missingAnnouncementDateRule="conservativelyUnknown"`，`mode="PIT"` |
| 4 | `adjustment` | 复权策略 | `priceBasis="raw"`（未复权），`priceFields=[open,high,low,close,preClose]`，`corporateActionAdjustmentIntoPrice=false` |
| 5 | `industry` | 行业归属策略 | `codeOwnership="fullCodeOwnershipFiltered"`，`pointInTimeFilter="retrievedAt<=asOf"`，`missing="nullAndKnowledgeUNKNOWN"` |
| 6 | `liquidity` | 流动性策略 | `granularity="tradeDateDailyFacts"`，`closingKnown=true`，`missing="nullAndKnowledgeUNKNOWN"` |
| 7 | `universe-membership` | Universe 成员决议策略 | `resolver="STEP11-resolveHistoricalUniverse"`，`membershipPerTradingDay=true`，`defaultOnUnknown="reject"`，`includeExcluded=true`，`sortOrder="exchange->code->securityId"` |
| 8 | `calendar-trading-days` | 交易日历策略 | `calendarName=dataSnapshot.calendarName`，`windowRule="calendarTradingDaysWithinRequestWindow"`，`tradingDayCount=dataSnapshot.tradingDays`，`tPlusOneAvailabilitySemantics=true` |
| 9 | `knowledge` | 可知性策略 | `mode="PIT"`，`asOfRequired=true`，`dimensions=[listing,delisting,tradability,industry,liquidity,price,corporateActions,marketState]` |

---

## 2. 关键铁律（policy 层落地）

1. **PIT**：逐日 PIT 下每行 `asOf = tradeDate`，只用当日可知信息；固定快照须显式给 `asOf`。
2. **Anti-Survivorship**：B Master 全表加载（含退市 337 只），成员按生命周期 PIT 决议，退市后不渲染 eligible 行。
3. **未复权 raw**：行价 open/high/low/close/preClose 取自 `stock_daily_prices` 未复权；公司行为只以事件计数/可知性提供，不折算进价格。
4. **缺失 ≠ 无事实**：industry/liquidity 缺失 → `null` + `knowledge.UNKNOWN`，禁止填零/伪造。
5. **UNKNOWN 默认拒绝**：universe 成员决议默认拒绝（非正向确认不放行）。

---

## 3. 一致性校验（policyValidate）

`validateResearchDatasetPolicyConsistency(ctx)` 对 built dataset 做四层核对：
1. **9 类齐备性**：缺失/重复/未知/class 不符/顺序错 → issue。
2. **value shape**：键白名单 + 值域合法。
3. **声明值 vs 期望值**：每类以 canonical JSON 相等性核对（防篡改/与数据集语义脱钩）。
4. **交叉语义**：PIT 声明 vs universeDefinition.asOfDescription、行级 asOf、knowledge 行级模式、universe 行覆盖、日历窗口。

---

## 4. 冻结指纹

- 9 类 policy 的 `policySetFingerprint` 由 `computePolicySetFingerprint(policySet)` 派生（canonical JSON + SHA-256 前 16 hex），随每个 dataset 落库（`research_datasets.policySetFingerprint`）。
- 首次真实构建的 policySetFingerprint 见 `docs/quantRoadmap/evidence/G2/P2-T3/evidence.json`。

---

## 5. 更新记录

| 时间 | 变更 | 说明 |
|------|------|------|
| 2026-09-09 | 建立（FROZEN v1.0） | 9 类 policy 权威口径冻结，源自 policy.ts `derivePolicySet` |
