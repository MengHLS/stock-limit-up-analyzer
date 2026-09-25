# composite-factor-oos-validation-study —— 组合因子 OOS 后置窗口验证组

对应任务书：**`TASK-OOS-COMPOSITE-3F-001.md`**（仓库根目录）。
上游结论：`docs/research/RESULT-COMPOSITE-CONSTRAINED-WEIGHT-001.md`。
产出结论：`docs/research/RESULT-OOS-COMPOSITE-3F-001.md`。

## 这一组回答什么

上一轮（受约束权重三方案）的结论是「`3F` 双振幅+量比等权是头部行为最好、机制最简的那一个」，
但它与其它方案一样，全部是**同一窗口、事后挑成员的样本内比较**。
本组只做一件事：**把这个事先冻结的排序键拿到后置窗口上去证伪**。

- 主判定：`3F`（`maxAmplitude` / `meanAmplitude` / `t1VolumeRatio`，等权各 1/3）
- 描述性参照：`4F-EQ`（上述 + `limitGap`，等权各 1/4）
- 负对照：`12F-EQ`（全部 12 个冻结因子，等权各 1/12）

不新增因子、不搜索权重、不换坐标、不根据验证段结果调整 TopN。

## 🔴 为什么是三个**新** experiment id

平台的窗口是**确认性协议**（`OBSERVATION` / `HOLDOUT`），且真实性由取数层保证：
`server/researchExperiments/datasetPort.ts` 把 `evaluationWindow` 转成 `fromDate` / `toDate`
交给读取层 ⇒ 实验侧不可能「忘了过滤」。

但 `server/researchExperiments/protocol.ts#findHoldoutWindowContamination()` 规定：
同一实验、同一 Dataset 下，任何历史**非 Holdout** Run 只要 `evaluationWindow === null`
（读全窗）或与目标 Holdout 窗口重叠 ⇒ 该 Holdout 被拒（`EXPERIMENT_PROTOCOL_HOLDOUT_CONTAMINATED`）。

而 `3F` / `4F-EQ` / `12F-EQ` 的既有 Run 都是在 v5 全窗上跑的 `EXPLORATORY`
⇒ 在**同一批 id** 上做验证段 Holdout 会被平台正确拒绝。

因此本组新开三个 id，`members` 与 `weighting` 与既有实例**逐字相同**——
「只是换了 id」这一点由**指纹**保证（两个指纹都只覆盖 `code | direction | orientation | weight`
与 `code | orientation | priorVerified | buckets`，**都不含 experiment id**）：

| 方案 | 桶词表指纹（既有实例 = 本组，加载时硬断言） | 成员指纹（既有实例，独立回校对拍） |
|---|---|---|
| `3F` | `fnv1a32:4eae4835` | `fnv1a32:27e759d7` |
| `4F-EQ` | `fnv1a32:abc25319` | `fnv1a32:bbcbb61c` |
| `12F-EQ` | `fnv1a32:f0500413` | `fnv1a32:c258fe26` |

## 🔴 本组**没有**任何自造参数

`descriptor.parameters` 一律为空数组。尤其**不引入**「事件年份过滤」参数：
自造参数会绕过平台的**参数冻结**、**单次 Holdout**、**污染守卫**三条纪律
（分别对应 `EXPERIMENT_PROTOCOL_PARAMETERS_FROZEN` / `EXPERIMENT_PROTOCOL_PHASE_CONFLICT` /
`EXPERIMENT_PROTOCOL_HOLDOUT_CONTAMINATED`）。窗口的唯一来源是 Run 的 `protocol`。

## 协议怎么提

```jsonc
// ① 选择段（只作门槛与冻结载体，主判定不读它）
{ "protocolId": "…", "protocolVersion": "1.0.0", "hypothesisCode": "…",
  "observationWindow": { "startDate": "2019-01-01", "endDate": "2023-12-31" },
  "holdoutWindow":     { "startDate": "2024-01-01", "endDate": "2026-09-04" },
  "phase": "OBSERVATION" }

// ② 验证段（主判定；parentRunId = ①的 Run id；参数由平台从父 Run 继承，改则被拒）
{ "…": "同上除 phase / parentRunId",
  "phase": "HOLDOUT", "parentRunId": "RUN-…" }
```

⚠️ 窗口必须落在 Dataset v5 的 `[2019-01-01, 2026-09-04]` 之内
（`assertProtocolWindowWithinDataset` 会拒绝越界；v5 的 `endDate` 是 **2026-09-04**，
不是任务书草案里写的 2026-09-25）。

## 🔴 Gate 的已知边界（读 Gate 前必看）

`confirmatoryGate` 由模板在**非 EXPLORATORY** 阶段自动产出（见 `shared/compositeFactor/assemble.ts`
的 `buildConfirmatoryGate()`）。但任务书 §4.3 的**条件 3**（`N3`/`N5`/`N10` 中至少 2 档优于
`12F-EQ` 同档）需要**跨 Run** 才能判定，而 `ExperimentRunContext` 里没有任何跨 Run 读口。

⇒ 条件 3 在 Gate 里被如实标为 `INSUFFICIENT`，由结论文档层对照后给出。

⇒ **使用纪律：Gate = `PASS` ≠ 任务书 §4.3 全部通过。** 不得据 Gate `PASS` 单独宣称「通过验证」。

## 注册点（2 处）

1. `research-experiments/manifest.ts`：`import` + 数组展开；
2. `client/src/researchExperiments/pages.ts`：三个 `pageKey` → 同一个页面组件。
