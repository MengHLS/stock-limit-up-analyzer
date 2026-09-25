# `shared/compositeFactor` —— COMPOSITE_FACTOR_EXPERIMENT_V1

> 组合因子通用实验模板。**在 `shared/singleFactor`（SINGLE_FACTOR_EXPERIMENT_V1）之上**，
> 只补「多个因子 → 一个排序键」这一层；交易 / 结果 / PIT / Benchmark / 指标全部复用。

## 1. 与单因子模板的分工（谁负责什么）

| 能力 | 提供方 | 组合模板是否重写 |
| --- | --- | --- |
| 冻结坐标（入场 T+6 / 退出 T+10 / 成本 20bps） | `singleFactor/coordinate.ts` | ❌ 不重写（`assertTemplateCoordinate()` 校验） |
| PIT 取数 + 信息截止闸门 + 真实交易日 | `singleFactor/pitAccess.ts` | ❌ 不重写 |
| 统一入场 / 退出 + 逐笔对拍 | `singleFactor/entryExit.ts` | ❌ 不重写 |
| 横截面排序 + 取前 N | `singleFactor/ranker.ts` | ❌ 不重写（合成分**当作** `factorValue` 交给它） |
| 等权仓位 + 成本模型 | `singleFactor/positionCost.ts` | ❌ 不重写 |
| 基准 = 当日池等权 | `singleFactor/benchmark.ts` | ❌ 不重写 |
| 指标 / 复利净值 / 回撤 / 日度超额 / Bootstrap / 三态判定 | `singleFactor/metrics.ts` | ❌ 不重写 |
| **方向调整 + 统一标准化 + 加权 + 合成分** | **本目录 `scoring.ts`** | ✅ 组合模板唯一新增 |
| **档位维度（TopN 3/5/10/20）× 日集（OWN / FIXED）** | 本目录 `analyse.ts` | ✅ |
| 结果六段（Overall / TopN / Benchmark / Excess / TimeSlice / TradeDetails） | 本目录 `assemble.ts` | ✅ |

## 2. 文件地图

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 契约常量与类型（唯一真源；**零 node 依赖**，可被页面安全引用） |
| `hash.ts` | 稳定哈希 + Bootstrap 种子（按 `契约\|档位\|日集\|用途`，与组合个数/顺序无关） |
| `members.ts` | 成员解析器（从 `singleFactor/factorResolver` + 冻结契约适配，**不新增因子定义**） |
| `scoring.ts` | 合成内核：标准化 / 方向调整 / 权重 / 合成分（纯函数） |
| `analyse.ts` | 评估层：合并 4 档 × 2 日集 × 按年切片 + 随机 N 分布 |
| `assemble.ts` | 结果装配：表 / 统计 / CSV 产物 / `customPayload` + zod schema |
| `template.ts` | **唯一入口**：`defineCompositeFactorExperiment(config)` |
| `index.ts` | 出口 |

## 3. 新增一个组合因子实验（两步）

```ts
// 1) research-experiments/<组>/<你的实验>/experiment.ts
import { defineCompositeFactorExperiment } from "../../shared/compositeFactor";

export const myExperiment = defineCompositeFactorExperiment({
  id: "<组>/<你的实验>",          // 必须等于 pageKey
  name: "……",
  description: "……",
  source: "stock-limit-up-analyzer/<组>",
  tags: ["composite-factor"],
  pageTitle: "……",
  members: [
    { code: "turnover", direction: "LOW" },   // code 必须在成员目录里
  ],
  normalization: "BUCKET_POSITIONAL",          // 或 CROSS_SECTION_PERCENTILE
  weighting: { mode: "EQUAL" },                // CUSTOM 已预留
});
```

```txt
2) 注册（各加 1 行）
   research-experiments/manifest.ts               → import + 数组项
   client/src/researchExperiments/pages.ts        → pageKey → 页面组件
```

**不需要**写任何交易 / 结果 / PIT / Benchmark / 指标代码。

## 4. 两条硬约束（违反会响亮失败，不会静默降级）

1. **方向不允许在组合里重估**：成员 `direction` 必须与冻结契约的 `orientation` 一致
   （`+1 ⇔ HIGH`、`-1 ⇔ LOW`）。想让因子反向就换因子或新开契约，不能"在组合里掰过来"。
2. **不插补**：任一成员在该样本上不可评估（**由标准化结果判定**，不由原始值判定）⇒ 该样本
   不进样本。`limitGap` 的 `null` 是**合法桶** `UNKNOWN`，不是缺失 —— 这条规则与
   `FROZEN-BUCKET-CONTRACT-001 §3.3` 的"完备用例"逐字一致。

配套的逐笔对拍（`template.ts`）：入场/退出相对日、价格、日期、`netReturn`
必须与公共底座 `derive.ts` 逐位一致（容差 `1e-12`）⇒ 一旦两套语义漂移，Run 立刻失败。

## 5. 标准化方法（统一，一次 Run 只允许一种）

| 方法 | 定义 | 何时用 |
| --- | --- | --- |
| `BUCKET_POSITIONAL`（**默认**） | `(idx+0.5)/k`，桶位中点（FBC §3.1） | 有冻结桶词表的因子（12 个现有因子） |
| `CROSS_SECTION_PERCENTILE` | `count(同日 peer ≤ v)/N` | 尚无冻结桶词表的新因子 |

两种都是**单调映射 + 不含拟合**（不搜索边界、不估参数）。⚠️ 两者不可混引（换方法 = 换排序键）。

## 6. 权重

- `{ mode: "EQUAL" }`（第一阶段唯一启用的形态）⇒ 每个成员 `1/n`；
- `{ mode: "CUSTOM", weights: {...} }`（**接口已预留**）：键集合必须与成员集合完全相等、
  权重必须是有限正数、归一化到 `Σw = 1`；任何一条不满足都抛错（不做静默兜底）。

## 7. 结果里必须读的三件披露

1. **日集口径**：`OWN` 下各档日集不同 ⇒ 跨 N 比较读 `FIXED`；
2. **CI 种子**：稳定哈希 ⇒ 与 12F / Top-N 既有实验的 CI 端点不逐位相同（点估计可比）；
3. **多重比较**：`customPayload.verdictRowCount` 是带判定的行数（逐表行数求和），
   按 `α=0.05` 折算假阳性期望。
