# FE-PLAN-002 — 观察 → 研究实验入口（PD-01 组件级实现方案）

> 日期 2026-10-03 · 作者 **Frontend Agent** · 上游 `SPEC-002-PD01-observation-to-experiment.md`
> 状态 **READY for Implementation**（本文件只给方案，**不改代码**）· 目标验收 = SPEC-002 §6 的 AC-1~AC-5
> 🔴 前置结论（已由 Product 记录前提修正）：观察页 **dataset-unaware**，入口**不得携带任何数据集坐标**。

---

## 0. 关键设计决策

| 决策 | 内容 | 理由 |
|---|---|---|
| **D1** | 新增**唯一**共享组件 `ResearchEntryLink`，5 页复用 | 避免 5 处复制文案与链接（后续改文案只改一处） |
| **D2** | 入口**不携带** query string，只跳 `/research-experiments` | 观察页无 `datasetVersionId` 可携带（SPEC-002 §1） |
| **D3** | 文案**强制**包含「需在实验中选择 Dataset 版本」 | SPEC-002 规则 2 的硬要求（防「已对齐」错觉） |
| **D4** | 不引入 `datasetRegistry` 依赖 | SPEC-002 规则 1 / AC-4 |
| **D5** | 视觉上做成**次级入口**（ghost / link 按钮），不抢占页面主操作 | 观察页主任务是看盘，不是建实验 |

## 1. 新增组件（1 个）

**`client/src/components/research/ResearchEntryLink.tsx`**

```text
props: { context?: string }        // 可选：用于文案「从<context>开始做实验」
渲染：
  <Link href="/research-experiments">
    做实验的研究入口（icon: Beaker）
  </Link>
  + 常驻副文案：需在实验中选择 Dataset 版本（观察页与数据集版本不是同一坐标系）
```

- 变体：`variant="inline"`（放在标题行右侧）/ `variant="block"`（放在页面顶部提示条）。
- 组件内**硬编码副文案**，不允许调用方覆盖（D3 的落地方式）。

## 2. 插入点（逐页，共 5 页）

| 页面 | 现状 | 插入方案 |
|---|---|---|
| `client/src/pages/Dashboard.tsx` | 头部为 `<div className="mb-4 flex items-center gap-2">` + `<h1>行情总览</h1>`（`:920-923`） | 在该 `flex` 行右侧加 `<ResearchEntryLink variant="inline" />`（`ml-auto`） |
| `client/src/pages/Market.tsx` | `<h1>大盘分析</h1>`（`:101`） | 在其所在标题行右侧插入 `inline` |
| `client/src/pages/SentimentAnalysis.tsx` | `<h1>情绪分析</h1>`（`:47`） | 同上 |
| `client/src/pages/LeaderCandidates.tsx` | `<h1>龙头候选池</h1>`（`:171`） | 同上 |
| `client/src/pages/LimitUpReview.tsx` | **无 `<h1>`**（头部形态需实现时定位；疑似嵌在子组件/表格头） | 实现时先定位头部容器；若确实无统一头部，则在页面顶部加 `block` 变体 |

> ⚠️ 实现前必须先确认 `LimitUpReview` 的头部归属；若它把标题交给了子组件，**不得**为插入入口而重构该子组件（超出 Scope）。

## 3. 文案规范（强制）

| 元素 | 文案 |
|---|---|
| 主链接 | 「做实验的研究入口」（或「以此为起点做实验」） |
| 副文案（组件内固定） | 「**需在实验中选择 Dataset 版本** —— 观察页与数据集版本不是同一坐标系」 |

🔴 禁止出现的措辞：「已自动匹配数据版本」「按当前数据集创建实验」「继续本数据集的实验」。

## 4. 变更清单

| 文件 | 动作 |
|---|---|
| `client/src/components/research/ResearchEntryLink.tsx` | ➕ 新增 |
| `client/src/components/research/index.ts` | ➕ 导出（若该 barrel 存在，沿用既有导出风格） |
| `client/src/pages/{Dashboard,Market,SentimentAnalysis,LeaderCandidates,LimitUpReview}.tsx` | ✏️ 各 +1 处插入（≈1–3 行/页） |

**明确不改**：`App.tsx`（无新路由）· `AppShell.tsx`（无新侧栏项）· `server/**` · `shared/**`。

## 5. 测试与验收

| 项 | 内容 |
|---|---|
| 单测（新增） | `ResearchEntryLink` 渲染出指向 `/research-experiments` 的链接，且副文案包含「Dataset 版本」 |
| AC-1 | 5 页各有 ≥1 个可达入口 |
| AC-2 | 入口文案含「需在实验中选择 Dataset 版本」（可断言 DOM 文本） |
| AC-3 | 跳转 URL **不含** `datasetVersionId`（可断言 `href`） |
| AC-4 | 5 页**未新增** `datasetRegistry` 引用（可 grep 断言） |
| 类型 / 行尾 | `pnpm run check` 0 错 · `checkEolDrift --strict` = 0 |

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 用户误以为观察页水位 = 某个数据集版本 | D3 固定副文案；禁止「已对齐」类措辞 |
| `LimitUpReview` 头部特殊 ⇒ 插入点不统一 | 允许该页用 `block` 变体；**不允许**为统一而重构页面结构 |
| 5 页改动面广、与并发会话冲突 | 改动前 `git status` 确认 5 个目标文件未被其它会话修改；如被修改则先停下报告（Orchestrator §2 / §14） |
| 入口抢占页面主操作 | D5 明确为次级视觉层级（ghost / link） |

## 7. 交付顺序

```text
1. 基准检查：git status 确认 5 个目标页 + components/research 未被其它会话占用
2. 新增 ResearchEntryLink（含单测）
3. 依次接入 Dashboard → Market → SentimentAnalysis → LeaderCandidates
4. 定位并接入 LimitUpReview（特殊形态）
5. pnpm run check + checkEolDrift + 5 页可达性验证
6. Verification（本轮为**新增只读入口**，判据 = 5 页既有查询与渲染行为不变）
```