# STEP 7.6 — 历史行业覆盖报告（INDUSTRY COVERAGE）

> 身份：Historical Industry Data Engineer
> 结论：**CONDITIONAL GAP**（当前行业快照完整；历史行业有效期缺失，禁止用当前行业回填历史）

---

## 一、核心结论

- **当前行业（current industry）**：AkShare SW 可获取 **31 个申万一级行业**（已实时验证），但仅为**当前快照**。
- **历史行业（historical industry）**：**无法获得带有效期的历史成分**（无 effectiveFrom/effectiveTo），必须标记 CONDITIONAL GAP。
- **铁律**：禁止把「当前行业」描述为「历史行业」，禁止用当前行业回填历史。

---

## 二、Provider 审计

| Provider | 数据 | 是否为历史行业 | 结论 |
|----------|------|----------------|------|
| AkShare SW（`sw_index_first_info` + `sw_index_cons`） | 31 个申万一级 + 当前成分 | ❌ 仅当前快照 | 可用作 current industry |
| BaoStock | 无行业分类 | ❌ | 不可用 |
| Tushare | 概念/行业分类（`ths_index`/`index_classify` 等） | ⚠️ 需进一步核实，且受 40203 限频 | 待核实 |

实时探测确认 AkShare SW 返回 31 个申万一级行业（代码带 `.SI` 后缀，如 `801010.SI` 农林牧渔）：

```
农林牧渔、基础化工、钢铁、有色金属、电子、汽车、家用电器、食品饮料、
纺织服饰、轻工制造、医药生物、公用事业、交通运输、房地产、商贸零售、
社会服务、银行、非银金融、综合、建筑材料、建筑装饰、电力设备、机械设备、
国防军工、计算机、传媒、通信、煤炭、石油石化、环保、美容护理
```

---

## 三、历史行业覆盖程度

| 维度 | 状态 |
|------|------|
| 当前行业成分（31 个申万一级） | ✅ 可获得 |
| 历史成分有效期（effectiveFrom/effectiveTo） | ❌ **不可获得** |
| 历史行业归属回溯能力 | ❌ 无法追溯「某证券 2023 年归属何行业」 |

**GAP 本质**：申万行业成分会随时间调整（新股纳入、行业重分类），AkShare SW 只暴露「当前」成分，不暴露历史调整记录。因此：

- 用当前快照构建的行业归属，其 `effectiveFrom` 只能取「快照获取日」，`effectiveTo = null`；
- 这在时间上会把「现在」的行业错误地回填到「过去」——**严格禁止**。

---

## 四、已建立的行业基础设施

`schema.industry_assignments` + `server/marketData/industry.ts` 提供：

- `getIndustryAt(securityId, date)`：as-of 解析某日行业归属
- `getIndustryIntervals(securityId)`：某证券全部行业区间
- `validateIndustryIntervals(securityId)`：区间重叠 / from>to 校验
- `hasCurrentIndustry(securityId)`：识别当前行业（effectiveTo=null）

**约束**：区间重叠时 `getIndustryAt` 抛错，绝不静默挑一个；同一证券同一生效日唯一（DB 唯一键）。

---

## 五、填补 GAP 的建议（不回填，仅建议）

1. **首选**：申万/中证指数公司官方历史成分调整表（若有授权），构建带 effectiveFrom/effectiveTo 的完整历史行业区间。
2. **次选**：Tushare 行业分类历史（需核实接口能力与 40203 限频）。
3. **降级**：用「快照日」构建单点区间（effectiveFrom = 快照日、effectiveTo = null），并显式标注 `source` 与 `retrievedAt`，明确该区间**不覆盖快照日之前**，下游按 as-of 语义只会取到「快照日之后」的行业，天然避免回填。

> 无论采用哪种来源，都必须在 `industry_assignments.source` 与 `retrievedAt` 中留痕，保证可审计。
