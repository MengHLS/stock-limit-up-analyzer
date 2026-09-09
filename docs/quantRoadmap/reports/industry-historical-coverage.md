# Industry Historical Coverage Report — 行业历史覆盖报告

> 版本：v1.0 | 日期：2026-09-09 | Gate：G1（HISTORICAL_STATE_READY 的 Industry 维度）
> 结论：**CONDITIONAL**（当前快照 AVAILABLE；历史 PIT NOT READY）
> 证据：真实 TiDB 实查（非引用旧文档），2026-09-09。

---

## 1. 执行摘要

`industry_assignments` 表当前承载的是 **BaoStock「当前证监会行业分类」快照**（单一时间点 2026-08-31），**不是历史行业时间序列**。P1-T3 已把 `securityId` 100% 关联到永久身份（5212/5212，0 孤儿），但 `effectiveFrom` 仍是单点——历史行业 PIT 数据缺失，且**当前无免费稳定历史源可补齐**。

结论一句话：**当前行业快照可用；历史行业 PIT 不成立，需外部数据源（付费/高积分/手工）解锁。**

---

## 2. 当前快照状态（实查）

| 维度 | 值 | 说明 |
|------|-----|------|
| 总行数 | 5,212 | 每只证券 1 行（无历史区间） |
| securityId 关联 | 5,212 / 5,212（0 NULL） | P1-T3 已回填，0 孤儿引用 |
| effectiveFrom | 单点 `2026-08-31` | **无历史区间** |
| effectiveTo | 全 NULL（= 至今） | 快照语义 |
| source | 100% `baostock` | `query_stock_industry` 只返回当前分类 |
| 行业覆盖 | ≥5000 股（G0 #7 PASS） | 但这是「截面覆盖」，非「时序覆盖」 |
| 每证券行业记录数 | 1（`ind_multi_per_code` 空） | 无任何证券有多条历史行业区间 |

---

## 3. 历史可用区间

**无。** `effectiveFrom` 只有 `2026-08-31` 一个值，`effectiveTo` 全 NULL。

| 区间 | 状态 |
|------|------|
| 2019-01 ~ 2026-08 | ❌ 无任何行业归属记录 |
| 2026-08-31 ~ 至今 | ✅ 单点快照（当前分类） |

因此行业数据**无法**作为 2019~2026 期间的历史截面/时序因子使用。

---

## 4. PIT 是否成立

**不成立（对历史研究）。**

- 唯一有效点是 `2026-08-31`，即「asOf(T) 查询行业」对任意 T < 2026-08-31 都**无数据**，只能用 2026-08-31 的当前分类「回填历史」，这属于**未来数据污染**（survivorship + look-ahead），铁律禁止。
- `PIT_STATUS = CONDITIONAL`（诚实标注，不伪装 PASS）。

---

## 5. 允许 / 禁止的研究

### ✅ 允许使用（当前快照语义）
- 「当前全市场行业分布」截面分析（如当前各行业涨停数分布）。
- 以 `asOf >= 2026-08-31` 为边界的策略研究中，行业作为**当前截面特征**。
- 行业作为「标签/分组」用于**非时序**的统计描述（如某行业当前有多少只票）。

### ❌ 禁止使用（历史 PIT 语义）
- **禁止**用 `2026-08-31` 当前行业回填 2019~2026 任意历史日期（未来数据）。
- **禁止**把行业作为历史回测的时序因子（`industry factor at T` 对 T<2026-08-31 无真实数据）。
- **禁止**在任何研究数据集（G2）中声明「行业历史 PIT = PASS」。

---

## 6. 历史源调研结论（2026-09-09）

| 数据源 | 历史行业能力 | 可用性 |
|--------|-------------|--------|
| BaoStock `query_stock_industry` | 仅当前分类，无历史 | ❌（已确认，backfillIndustry.ts 注释亦声明） |
| Tushare `index_member_all` | 申万/中证历史成分（进出日期） | ⚠️ 需 5000 积分，当前 token 积分受限 |
| Tushare `index_classify` / `index_member` | 分类定义 / 当前成分 | ❌ 非历史 |
| akshare 申万历史成分 | 部分接口（`sw_index_*`） | ⚠️ 未安装，质量/稳定性未知 |
| 证监会历史分类 | 无免费公开 API | ❌ |

---

## 7. 解锁路径（若要补齐历史 PIT）

1. **Tushare 5000 积分**：`index_member_all` 拉取申万一级/二级行业历史成分（in/out 日期），映射为 `effectiveFrom/effectiveTo` 区间。→ 最正规。
2. **akshare 申万历史**：安装 akshare，评估 `sw_index_*` 历史成分接口覆盖与质量。
3. **手工维护**：仅对首板/龙头等少量目标票，人工记录历史行业变更（成本高，仅小样本）。

任一方案落地前，`G1` 的 Industry 维度保持 `CONDITIONAL`，且**不得**为让 Gate PASS 而把当前快照伪装成历史 PIT。

---

## 8. 对 G1 / G2 的传导

- `G1`（HISTORICAL_STATE_READY）：Industry 维度 `CONDITIONAL`；其余维度（Listing/Delisting/Suspension/ST/Identifier）已 PASS。
- `G2`（RESEARCH_DATASET_READY）：研究数据集的 `industry policy` 必须**明确声明**「行业仅当前快照，历史 PIT 不可用」，否则数据集不成立。
- `G0`（DATA_FOUNDATION_READY）**不受影响**：G0 #7 的行业判定是「截面覆盖 ≥5000 股」，与历史 PIT 无关，仍 PASS。
