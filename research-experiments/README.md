# 独立研究实验体系（`research-experiments/`）

> 契约全文、字段清单、禁止事项与完整示例：**`docs/research/EXPERIMENT-CODE-SPEC.md`**（A~P 16 节）。
> 实施报告：`docs/research/RESEARCH-EXPERIMENT-001-final.md` ~ `RESEARCH-EXPERIMENT-004-final.md`。
>
> 🔴 **004 起结果会被持久化**：Run 元数据进 TiDB，结果与产物进对象存储（MinIO）
> ⇒ 历史 Run **关掉页面后仍在，不需要重跑**。产物声明见规范 §P。

这个目录是**独立研究实验**的家。一个实验 = 一个目录 = 一个 `ExperimentDefinition`。

```
research-experiments/
├── manifest.ts                     ← 注册清单（新增实验：加 1 行 import + 1 行数组项）
├── robustnessBridge.ts             ← 跨阶段 Robustness 核心的唯一引桥（**只有它** reach server/**）
├── template/                       ← 可直接复制的模板
│   ├── experiment.ts               元数据 + 取数 + 计算
│   ├── result.ts                   结果结构（schema）+ 组装
│   ├── page.tsx                    实验自己的展示页面
│   └── README.md
└── first-board-pullback/
    ├── entry-day/                  ← 完整可运行示例（不使用未来数据）
    │   ├── experiment.ts
    │   ├── result.ts
    │   └── page.tsx
    ├── fundamental-study/          ← EXP-001：首板后回踩第一性研究（描述性）
    │   ├── experiment.ts
    │   ├── result.ts
    │   └── page.tsx
    └── stability-validation/       ← EXP-002：条件稳定性验证（复用 Robustness 核心方法）
        ├── experiment.ts
        ├── result.ts
        └── page.tsx
```

## 为什么要有这套东西

旧研究链路的形态是**固定**的：

```
Research → Analysis → Finding → Conclusion
```

它适合「平台替你设计分析」，但不适合「我脑子里有一个具体的实验，想直接算」。
独立实验体系允许每个实验：

- 有自己的**参数**（不是只能填平台的字段）；
- 有自己的**结果结构**（不必硬塞进 Finding / Conclusion）；
- 有自己的**展示页面**（不必挤在同一个通用结果页里）；
- **直接使用 Dataset**（也可以完全不碰策略）。

## 新增一个实验 = 两步

```bash
# 1) 复制模板
cp -r research-experiments/template research-experiments/<你的组>/<你的实验>
# 2) 改 id / pageKey，然后在两个注册点各加一行：
#    research-experiments/manifest.ts              （服务端发现）
#    client/src/researchExperiments/pages.ts       （前端页面）
```

**不需要**改：Research Core、Strategy Core、tRPC 路由、数据库。

跑完之后的持久化是**自动的**（004）：Run 元数据进 TiDB，结果与产物进对象存储（MinIO）。
无论你写不写额外代码，都会存下 `result.json` + `logs/run.log` + `manifest.json`；
**要留下自定义文件**（逐事件明细 CSV / 图片 / 大块数据）就在 `run()` 里多调一次
`context.artifact({ name, role, body, … })`（字段与禁止事项见规范 §P）。

## 四条硬约束（违反会被响亮拒绝，不会静默降级）

1. **不能绕过 Dataset 契约**：实验拿不到 DB，只能通过 `context.dataset` 按
   `datasetRequirements` 声明的列与相对日取数；
2. **未声明 `usesForwardData: true` 时读 `rd ≥ 1` 直接抛错** —— PIT 是结构级闸门，不是注释；
3. **样本账必须平**：`eligible + excluded === candidate` 且 `Σ excludedByReason === excluded`，
   账不平即 `EXPERIMENT_RESULT_INVALID`（否则「样本为什么变少」无从诊断）。
4. 🔴 **「账平」不等于「全量」**：上面两条式子只覆盖**进了候选**的事件，
   被扫描上限截掉的事件**压根不在 `candidate` 里 ⇒ 两条式子在它们身上恒真、毫无保护**
   （实测事故：数据集声明 23978、候选 20000，中间 3978 个事件静默消失）。
   需要全量时**唯一合法做法**是声明 `datasetRequirement.eventScanPolicy: "FULL_DATASET"`
   （声明式放行，**不是**删阀、**不是**只调大 `maxEvents`）+ 用 `dataset.eventPages()` 流式分页，
   并让结果出 `unscannedEventCount`（`0` = 全量成立，`null` = 总数未知）。细节见规范 §E.6 / §H.4。

## 可以消费既有的能力吗？（能，而且**只能通过引桥**）

本体系自己的边界是「**不改** Research Core / Strategy Core / tRPC / DB」——
这**不等于**「实验必须从零造轮子」。已经存在、且方法学上跨阶段通用的能力**应当复用**：

| 想做的事 | 正确做法 | 反面教材（明禁） |
| --- | --- | --- |
| 策略 / 参数搜索的稳定性扰动 | 经由 `@experiments/robustnessBridge` 调既有 Robustness 核心 | 在 `research-experiments/**` 里再写一套「研究侧鲁棒性引擎」 |

`robustnessBridge.ts` 是**唯一**允许从实验作者面 reach `server/**` 的文件：

- 它**零实现、零状态**，只有 re-export（引桥里加逻辑 = 在核心与实验之间长出第二个语义层）；
- 它被明确切成两段：`export type { … }`（可被 `page.tsx` 间接引用，`import type` 会被完全擦除）
  与 `export { … }`（**只允许** `experiment.ts` 用 —— 页面引它会违反「页面不得引 server 运行时」）；
- 搬家 / 改名只需要改这一处。

**「复用」的准确含义**：复用**方法**（baseline-first / 变体执行 / evaluator 注入 / 容差判定 /
指纹 / 样本账守恒），以及**结果层的持久化机制**（Run 元数据进 TiDB、结果与产物进对象存储）。
不复用的东西同样明确：**不给 Robustness 新开表、不加 migration、不建第二套结果表**。

先例：`first-board-pullback/stability-validation`（EXP-002）——
它把一个 Run 铺成 3 维度 × 16 变体，调 `runMultiDimensionRobustness` 出稳定性矩阵，
自己只负责「读 Dataset → 逐变体真重算 → 组装结果」。

## 与旧 Research 的关系（`9cg` 后已变）

🔴 旧链路**已整体退役**：`server/researchCore/**` 与 `server/researchEngine/**` 已整体删除，
12 张旧表 RENAME 为 `archive_research_*`，`trpc.research.*` 改名 `trpc.strategyDomain.*`，
旧前端路由 `/research*` `/findings*` `/conclusions*` **全部 404**。

所以今天只有**一个**入口：`/research-experiments`（左侧栏「研究 → 独立实验」）。

新实验**仍然不得**出现 `analysisId` / `findingIds` / `conclusion` / `candidateId`
等旧结构字段 —— 这条约束没有随旧链路退役而放松，它是「独立」二字的定义。
