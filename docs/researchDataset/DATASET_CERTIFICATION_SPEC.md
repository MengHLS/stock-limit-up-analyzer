# DATASET_CERTIFICATION_SPEC — Research Dataset 认证规范

> 版本：v1.0 | 日期：2026-09-09 | 权威实现：`server/researchDataset/certify.ts` + `capability.ts`

---

## 1. 认证 vs Gate（关键区分）

| 概念 | 回答 | 判定 | 产物 |
|---|---|---|---|
| **gate**（builder 产物） | 「数据能不能拼出来」 | FAIL / PASS / INCONCLUSIVE | 构建期事实 |
| **certification**（本模块） | 「能否作为正式研究实验环境」 | CERTIFIED / CONDITIONAL / REJECTED | 研究资格 |

**铁律**：certification 消费 gate，但**更严格**——即便 gate=PASS，固定快照或依赖历史 PIT 不完整的 Industry/Liquidity/CA，也只能 CONDITIONAL，不得 CERTIFIED。

## 2. 状态词汇

### 2.1 能力三态（capability.ts）

`AVAILABLE / CONDITIONAL / UNAVAILABLE` — 由真实数据事实派生，不是「UI 是否有」。

### 2.2 认证三态（certify.ts）

`CERTIFIED / CONDITIONAL / REJECTED`。

## 3. 认证决策树（确定性，早命中即定案）

```
1. gate = FAIL                          → REJECTED
2. gate = INCONCLUSIVE                  → CONDITIONAL（证据不足，不能证明安全）
3. gate = PASS 且固定快照               → CONDITIONAL（NON_RESEARCH_SAFE，含未来知识）
3b. gate = PASS 但 policySet 缺 pit/survivorship → CONDITIONAL（防篡改护栏）
4. gate = PASS 且 requireIndustry 且 industry≠AVAILABLE    → CONDITIONAL
5. gate = PASS 且 requireLiquidity 且 liquidity≠AVAILABLE  → CONDITIONAL
6. gate = PASS 且 requireCA 且 ca≠AVAILABLE                → CONDITIONAL
7. 其余 gate = PASS                     → CERTIFIED
```

## 4. 依赖声明（requirements）

认证只对「研究实际消费的可选域」判 CONDITIONAL；未声明的域不参与研究、不影响认证。

```ts
interface DatasetCertificationRequirements {
  industry?: boolean;      // 依赖历史行业归属（行业筛选/中性化/因子）
  liquidity?: boolean;     // 依赖历史流动性/市值
  corporateActions?: boolean; // 依赖公司行为（复权/除权）
}
```

## 5. 能力事实（facts，来自元数据探测）

```ts
interface DatasetCapabilityFacts {
  industryHistoricalPit: DatasetCapabilityStatus;
  liquidityHistoricalCoverage: DatasetCapabilityStatus;
  corporateActionPit: DatasetCapabilityStatus;
}
```

## 6. 派生规则（capability.ts，纯函数）

| 事实 | AVAILABLE | CONDITIONAL | UNAVAILABLE |
|---|---|---|---|
| `industryHistoricalPit` | distinct effectiveFrom > 1 | ≤ 1（单点快照） | 无数据 |
| `liquidityHistoricalCoverage` | 覆盖对齐 OHLCV 窗口 | 有数据但未对齐 | 无数据 |
| `corporateActionPit` | announcementDate 无缺失 | 有缺失 | 无数据 |

## 7. 真实 E2E 认证结果（2026-09-09 实查）

| 运行 | gate | 认证 | researchSafe |
|---|---|---|---|
| 冒烟（dataReady=false） | INCONCLUSIVE | CONDITIONAL | false |
| 正式（dataReady=true，baseline 仅需 OHLCV） | **PASS** | **CERTIFIED** | **true** |

- 正式运行 `datasetVersion = rd-1.0.0-1-fd1c487f2fe19e27`，Run `RUN-EXP-E2E-B9F42F-D4D1` 已落库。
- 认证理由：`构建 gate=PASS 且逐日 PIT、survivorship-safe、无依赖历史 PIT 不完整的可选域`。

## 8. 禁止越级（继承 §0.2）

- `CODE_READY ≠ CERTIFIED`；`TEST PASS ≠ CERTIFIED`；`UI 可选择 ≠ DATA AVAILABLE`。
- Industry 历史 PIT = CONDITIONAL 是**数据现实**，禁止 fake READY（任务显式要求保持 CONDITIONAL）。
