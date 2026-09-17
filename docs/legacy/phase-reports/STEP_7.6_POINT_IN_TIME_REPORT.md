# STEP 7.6 — Point-in-Time 报告（POINT-IN-TIME）

> 身份：Point-in-Time Data Auditor
> 结论：**CONDITIONAL PASS**（三类时间语义已建立并测试；发布时点 available_at 多数 UNKNOWN，未强行假设 T+1）

---

## 一、三类时间严格区分

| 时间 | 含义 | 当前系统状态 |
|------|------|--------------|
| **effective_date** | 事实生效日（如行业归属开始生效的日期） | 行业表 `effectiveFrom`（可确定） |
| **available_at** | 该事实「可被公众/系统获得」的发布时点 | 多数 **UNKNOWN**（无法确定） |
| **retrieved_at** | 我们实际抓取/写入的时点 | 表 `retrievedAt`（自动记录） |

`server/marketData/pointInTime.ts`：

- `PointInTime = { effectiveDate, availableAt: string | null, retrievedAt }`
- `availabilityStatus(pit)`：availableAt 为 null → `UNKNOWN`
- `withUnknownAvailability(effectiveDate, retrievedAt)`：显式构造 UNKNOWN 记录
- `validatePointInTime(pit)`：校验 effectiveDate ≤ availableAt ≤ retrievedAt 时间顺序；availableAt 为 null（UNKNOWN）合法、非错误

---

## 二、关键原则：不得强行假设 T+1

**发布时点无法确定时，标记 UNKNOWN，不强行假设「T+1 发布」。**

反例警示：Tushare `daily`（收盘行情）发布时点事实上约为当日盘后（T 日 15:00 后），但这不是由接口保证的契约，而是观测经验；若在 PIT 层硬编码「availableAt = effectiveDate + 1」，当数据源实际是 T 日盘后发布时，会造成 **1 天的错误滞后**，且无法追溯。因此：

- 能确证的发布时点 → 填 availableAt；
- 不能确证的 → availableAt = null（UNKNOWN），由下游按保守策略消费（宁可不采，不可误采未来数据）。

---

## 三、各类数据的 PIT 可用性现状

| 数据 | effective_date | available_at | retrieved_at | 说明 |
|------|----------------|--------------|--------------|------|
| 行业归属（历史） | ✅ effectiveFrom | ❌ UNKNOWN | ✅ | 行业调整公告日可作 availableAt，但未系统化 |
| 行业归属（当前快照） | ✅ 快照日 | ❌ UNKNOWN | ✅ | AkShare SW 无发布时点 |
| 指数日线 | ✅ tradeDate | ❌ UNKNOWN | ✅ | 收盘后可得，但具体发布时点未确证 |
| 流动性（换手/市值/额/量） | ✅ tradeDate | ❌ UNKNOWN | ✅ | 同上 |

> 现状：所有新增表的 available_at 均为 UNKNOWN（未强行 T+1），只记录 effective + retrieved，符合「当前无法确定发布时间 → 标记 UNKNOWN」要求。

---

## 四、对下游（研究/回测）的契约要求

1. **as-of 消费**：任何「历史窗口」只能包含 ≤ 决策时点「已可获得」的数据（复用 `server/data/series` 的 `visibleBars` / `asOf` 语义）。
2. **行业回填防护**：`getIndustryAt` 只返回该时点生效的区间，天然阻断「当前行业回填历史」。
3. **发布时点未知**：下游不得假设 T+1；应在 UNKNOWN 时采用保守决策点（如以 retrievedAt 或明确标注的发布日为准）。

---

## 五、结论

- PIT 语义（effective/available/retrieved）已建立、已测试（VALID/UNKNOWN/时间倒挂/非法日期）。
- 发布时点 available_at 当前为 UNKNOWN，**未**强行 T+1，符合规范。
- 后续若引入「交易所公告日 / 数据源发布契约」作为 available_at，可直接填充字段，无需改动结构。
