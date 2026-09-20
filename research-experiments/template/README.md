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

## 复制后请逐条确认

- [ ] `descriptor.id` 与目录路径**完全一致**（不一致时页面能打开但 id 会误导）；
- [ ] `datasetRequirement.datasetCode` 是真实存在的数据集语义代码；
- [ ] `requiredColumns` 里每**一个列名都真实存在**（写错会在运行时被拒：
      `EXPERIMENT_METADATA_INVALID`，这是刻意的 —— 否则取值会静默变 null）；
- [ ] 若读了 `postRelativeDays`（rd ≥ 1），必须同时 `usesForwardData: true` 并写 `forwardDataPurpose`；
- [ ] `sampleSummary` 的账是平的（`eligible + excluded === candidate`）；
- [ ] 改了任何**计算**口径 ⇒ 升 `COMPUTATION_VERSION`（它同时进
      `descriptor.version` 与 `customPayload.computationVersion`，只改一处会校验失败）；
- [ ] `pageKey` 已在 `client/src/researchExperiments/pages.ts` 登记
      （忘了登记**不会白屏**，会降级为通用渲染器并明确提示）。

## 别忘了

- 页面**不自己发请求**（执行入口在服务端只有一套：Registry + Runner）；
- 页面**不得** import `experiment.ts` 或任何 `server/**`（它跑在浏览器里）；
- 不引入新的 UI 框架，用 `@/components/ui/*` 与 `recharts`；
- 不在实验里宣称「最优 / 最佳 / 排名」—— 同一份数据上的描述性统计
  挑出来的「最优」是样本内选择，不是结论。
