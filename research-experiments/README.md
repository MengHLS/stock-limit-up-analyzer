# 独立研究实验体系（`research-experiments/`）

> 契约全文、字段清单、禁止事项与完整示例：**`docs/research/EXPERIMENT-CODE-SPEC.md`**。
> 实施报告：`docs/research/RESEARCH-EXPERIMENT-001-final.md`。

这个目录是**独立研究实验**的家。一个实验 = 一个目录 = 一个 `ExperimentDefinition`。

```
research-experiments/
├── manifest.ts                     ← 注册清单（新增实验：加 1 行 import + 1 行数组项）
├── template/                       ← 可直接复制的模板
│   ├── experiment.ts               元数据 + 取数 + 计算
│   ├── result.ts                   结果结构（schema）+ 组装
│   ├── page.tsx                    实验自己的展示页面
│   └── README.md
└── first-board-pullback/
    └── entry-day/                  ← 完整可运行示例（真实数据）
        ├── experiment.ts
        ├── result.ts
        ├── page.tsx
        └── README.md
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

## 三条硬约束（违反会被响亮拒绝，不会静默降级）

1. **不能绕过 Dataset 契约**：实验拿不到 DB，只能通过 `context.dataset` 按
   `datasetRequirements` 声明的列与相对日取数；
2. **未声明 `usesForwardData: true` 时读 `rd ≥ 1` 直接抛错** —— PIT 是结构级闸门，不是注释；
3. **样本账必须平**：`eligible + excluded === candidate` 且 `Σ excludedByReason === excluded`，
   账不平即 `EXPERIMENT_RESULT_INVALID`（否则「样本为什么变少」无从诊断）。

## 与旧 Research 的关系

两套体系**并存**（规格 §14）。旧链路不删、不改；新实验**不得**强制转成
Analysis / Finding / Conclusion 结构，契约里也**不得**出现 `analysisId` /
`findingIds` / `conclusion` / `candidateId` 等旧结构字段。
前端两个入口也刻意分开：`/research`（旧工作台）与 `/research-experiments`（独立实验）。
