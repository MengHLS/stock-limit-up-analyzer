# 模板实验 —— 复制这个目录开始写你自己的实验

## 4 步开始

1. 把整个目录复制成 `research-experiments/<你的组>/<你的实验>/`；
2. 改 `experiment.ts` 里的 `descriptor.id` = `<你的组>/<你的实验>`（与目录一致，小写 kebab-case）；
3. 改 `pageKey`（通常与 id 相同），在 `client/src/researchExperiments/pages.ts` 里登记一行；
4. 在 `research-experiments/manifest.ts` 的数组里加一行。

```bash
cp -r research-experiments/template research-experiments/my-group/my-experiment
```

**import 路径不用改** —— 契约一律从 `@shared/researchExperimentsContracts` 引（别名，与目录深度无关）。

## 这个模板做了什么

只读 `ds_*_event` 与 `ds_*_prefix`（`rd=0`），按选定维度（`boardType` / `market`）
统计事件数与占比。**不使用事件日之后的数据**（`usesForwardData: false`）——
这是最安全、最不容易写错的起点。

| 文件 | 回答的问题 |
| --- | --- |
| `experiment.ts` | 研究什么、怎么算（元数据 + 取数 + 计算） |
| `result.ts` | 结果长什么样（自有 zod schema + 表格 / 统计 / 图表组装） |
| `page.tsx` | 怎么展示（只消费 `descriptor` 与 `outcome` 两个 props） |

## 结果会自动持久化（004）

跑完之后平台自动把结果与产物写进对象存储（MinIO）+ 把 Run 元数据写进 TiDB，
**关掉页面再打开仍能查看历史 Run，不需要重跑**。

什么都不做也会得到：`result.json`（结果信封）+ `logs/run.log`（你的 `log(...)` 行）
+ `manifest.json`（产物索引）。

**要留下自定义文件**（逐事件明细 CSV / 图片 / 大块数据）就显式声明一次：

```ts
artifact({
  name: "cohort-detail.csv",          // Run 前缀下的相对名字；禁绝对路径 / 含 ..
                                      // 🔴 **不要**自己写 `tables/` / `charts/` 前缀 ——
                                      //    角色段由下面的 `role` 拼，写了会变成 `tables/tables/…`
  role: "table",                      // "table" | "chart" | "log" | "artifact" ⇒ 决定角色段
  body: toCsv(rows),                  // string 或 Uint8Array
  contentType: "text/csv",            // 可省，按扩展名推断
  label: "逐事件明细",                 // 显示在页面上的中文标签
});
```

🔴 小表格 / 指标 / 图表数据**不要**落成文件 —— 直接放进返回值里的 `tables` /
`statistics` / `charts`，页面直接渲染。把几十 MB 塞进结果体是规格 §17 明确要避免的。
细节见 `docs/research/EXPERIMENT-CODE-SPEC.md` **§P**。

## 复制后请逐条确认

- [ ] `descriptor.id` 与目录路径**完全一致**（不一致时页面能打开但 id 会误导）；
- [ ] `datasetRequirement.datasetCode` 是真实存在的数据集语义代码；
- [ ] `requiredColumns` 里每**一个列名都真实存在**（写错会在运行时被拒：
      `EXPERIMENT_METADATA_INVALID`，这是刻意的 —— 否则取值会静默变 null）；
- [ ] 若读了 `postRelativeDays`（rd ≥ 1），必须同时 `usesForwardData: true` 并写 `forwardDataPurpose`；
- [ ] **要不要全量扫描**？模板默认 `eventScanPolicy: "PLATFORM_LIMIT"`（最多 20000 个事件）。
      只有当你需要「候选 = 数据集全量」时才改成 `"FULL_DATASET"`，并且**同时**做两件事：
      ① 事件读取改成流式分页 `for await (const page of dataset.eventPages())`；
      ② 结果里出 `unscannedEventCount` 并让它在页面**首屏可见**
      （`eligible + excluded === candidate` 覆盖不到「压根没被扫到」的事件 —— 详见规范 §E.6）；
- [ ] `sampleSummary` 的账是平的（`eligible + excluded === candidate`）；
- [ ] 改了任何**计算**口径 ⇒ 升 `COMPUTATION_VERSION`（它同时进
      `descriptor.version` 与 `customPayload.computationVersion`，只改一处会校验失败）；
- [ ] `pageKey` 已在 `client/src/researchExperiments/pages.ts` 登记
      （忘了登记**不会白屏**，会降级为通用渲染器并明确提示）；
- [ ] （004）要留档的大文件都调了 `context.artifact(...)`，`name` 是**相对名字且不含角色段**
      （禁 `/` 开头、禁含 `..`、禁自己写 `tables/` / `charts/` 前缀；非法名字会**当场抛**
      `EXPERIMENT_ARTIFACT_KEY_INVALID`）；
- [ ] （004）**没有**把几十 MB 明细塞进 `customPayload` / `tables` —— 那是给页面直接渲染的小数据。

## 别忘了

- 页面**不自己发请求**（执行入口在服务端只有一套：Registry + Runner）；
- 页面**不得** import `experiment.ts` 或任何 `server/**`（它跑在浏览器里）；
- 需要复用**既有跨阶段能力**（如 Robustness 稳定性方法）时，经由 `@experiments/robustnessBridge`
  引 —— 那是实验作者面**唯一**允许 reach `server/**` 的文件。**不要**在实验目录里再写一套
  同名引擎（`research-experiments/**` **零实现**地引桥，只有 re-export）。详见
  `research-experiments/README.md` 的「可以消费既有的能力吗」一节；
- 不引入新的 UI 框架，用 `@/components/ui/*` 与 `recharts`；
- 不在实验里宣称「最优 / 最佳 / 排名」—— 同一份数据上的描述性统计
  挑出来的「最优」是样本内选择，不是结论。
