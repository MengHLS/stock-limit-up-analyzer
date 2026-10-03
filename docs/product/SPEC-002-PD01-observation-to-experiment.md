# SPEC-002 — 观察 → 研究实验的入口（PD-01）

> 日期 2026-10-03 · 状态 **READY for Frontend（含 1 处前提修正）** · 上游 `PRODUCT-DECISIONS-001.md` PD-01
> ⚠️ **本规格修正了 PD-01 的原始前提**（见 §1 的「已发现约束」）——原表述为「带 `datasetVersionId` 预填」，但该前提在当前代码上**不成立**。

---

## 1. Problem 与「已发现约束」

**原始问题**：从②观察到③研究实验没有通道 —— 用户看到异常后，要自己记住看的是哪一版数据、再手动去实验列表里找对应实验。

🔴 **已发现约束（实查 2026-10-03）**：**观察类页面全部是 dataset-unaware**。

| 页面 | 数据源 | 是否知道 `datasetVersionId` |
|---|---|---|
| `/`(首页) · `/market` | `market.*` · `limitUp.*` | ❌ 否 |
| `/limit-up` | `limitUp.*` · `watchlist.*` | ❌ 否 |
| `/sentiment-analysis` · `/sentiment-alerts` | `sentiment.*` | ❌ 否 |
| `/leader-candidates` | `sentiment.*` | ❌ 否 |

即：这些页面读的是 **legacy 表**（`limit_up_records` 等），**根本不存在**「当前 `datasetVersionId`」这个坐标可携带。
⇒ 原方案「从观察页带 `datasetVersionId` 预填到实验详情」**不可实现**（会误导用户以为观察与数据集版本已对齐）。

## 2. User Goal（修正后）

用户在观察到值得研究的现象后，**一键进入研究实验入口**，并且**清楚知道**：实验需要**自己选择** Dataset 版本，观察页的水位与数据集版本不是同一坐标系。

## 3. User Flow（修正后 · 采用 Option A）

```text
② 观察页（如 /sentiment-analysis 看到某个情绪规律）
   ↓  点击「以此为起点做实验」（新增的轻量入口）
③ 研究实验列表 /research-experiments
   ↓  用户按「模式 / 口径」选中一个实验
实验详情 /research-experiments/:group/:key
   ↓  Dataset 版本选择器（**已有**，坐标进 URL）
   用户显式选择一个 datasetVersionId  →  运行
```

**入口按钮的语义边界**：它是「**跳转入口**」，不是「预填坐标」。文案必须写明「实验需要选择 Dataset 版本」。

## 4. Inputs / Outputs

| | 内容 |
|---|---|
| Inputs | 无新增输入（不需要 datasetVersionId） |
| Outputs | 跳转到 `/research-experiments`；**不携带**任何数据集坐标 |

## 5. Business Rules

| # | 规则 |
|---|---|
| 1 | 观察页**不得**显示或推断 `datasetVersionId`（它们与数据集版本无对应关系） |
| 2 | 入口按钮文案必须包含「选择 Dataset 版本」的提示，禁止暗示「已自动对齐数据版本」 |
| 3 | 不新建「研究问题」实体 / 表 / 页面（**实验即假设的载体**） |
| 4 | 不改 `researchExperiments.*` 契约；实验详情的 `?datasetVersionId=` 既有行为不变 |
| 5 | 观察页与实验页的**语义边界**必须在 UI 上可见（观察 ≠ 数据集版本坐标系） |

## 6. Acceptance Criteria（逐条可测）

| # | 判据 |
|---|---|
| AC-1 | 观察类页面存在进入研究实验的入口（≥1 处，路径可达） |
| AC-2 | 入口文案明确写出「需在实验中选择 Dataset 版本」 |
| AC-3 | 跳转**不携带**任何 `datasetVersionId` 参数 |
| AC-4 | 观察页**未新增**任何 `datasetRegistry` 依赖（保持 dataset-unaware） |
| AC-5 | `pnpm run check` 0 错；相关测试不新增失败 |

## 7. Non-goals

- ❌ 不建「研究问题」实体 / 页面 / 表
- ❌ 不在观察页引入 `datasetRegistry` 查询
- ❌ 不改实验详情的数据集选择逻辑
- ❌ 不做「观察 → 自动生成实验」的编排

## 8. Risks

| 风险 | 处置 |
|---|---|
| 用户误以为观察页的水位 = 某个数据集版本 | 规则 1 + AC-2 的文案强制 |
| 「实验即假设载体」在实验数增长后失效（**>50 个实验**或**同一模式族 >15**） | 触发重评：是否需要一个「问题 / 假设」索引层（PD-01 已登记该触发条件） |

## 9. 备选方案（Option B，**本次不采用**）

在观察页显示「当前最新可用 `dataset_version`」并携带进实验。
**不采用的原因**：① 观察页数据源与数据集版本**无对应关系**，携带会造成「已对齐」的虚假印象；② 会给 5 个观察页引入 `datasetRegistry` 耦合；③ 违反规则 1。
若未来观察页改为「基于 `dataset_version` 取数」，此方案可重新评估。

## 10. Dependencies

- 目标页：`/research-experiments`（已存在）
- 复用组件：`components/common/PageHeader` / `EmptyState`
- 无后端依赖、无契约变更