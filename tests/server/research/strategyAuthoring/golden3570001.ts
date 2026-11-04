/**
 * SCOPE-002 §4.2 S0 —— Strategy Version `3570001` 的 **canonical 验收锚点（golden）**。
 *
 * 来源：真实库只读探针（`strategy_versions#3570001.strategyDocumentJson` 的 `definition` + `recipe`），
 * 由 `scripts/_scratch/_dump_3570001_golden.mts` 导出后**逐字**转成本文件 —— 非手抄、非改写。
 *
 * 用途（SCOPE-002 §0.1 DoD / §2.3 A6）：
 *   `diffAgainstVersion({ document: <前端构建的文档>, target: GOLDEN_3570001 })` ⇒ `equal: true`
 *   即证明「纯前端构建出的定义」与 `3570001` 逐字段等价。
 *
 * 🔴 本文件**只是测试锚点**，不是第二套策略语义：它的合法性由
 *    `golden3570001.test.ts` 用既有 `validateCanonicalStrategyDefinition` + `exitPolicyDefinitionErrors`
 *    逐项复核；若复核不再通过 ⇒ 说明锚点或既有语义发生了漂移，必须查明原因，**不得**改测试放行。
 */
import type { StrategyAuthoringGolden } from "../../../../server/research/strategyAuthoring/diff";

/** 锚点来源的版本身份（审计用；不参与 diff）。 */
export const GOLDEN_3570001_META = {
  strategyId: "first-limit-pullback-3f-top3-runner-hold20",
  version: "1.0.0",
  strategyVersionId: 3570001,
  datasetVersionId: 750001,
  fingerprint: "58e16bbd827349e802a2789a469fa9c195d4a23e2b2cbae3f643231a5b1b2199",
} as const;

/** `3570001` 的 `definition` + `recipe`（canonical 验收锚点）。 */
export const GOLDEN_3570001: StrategyAuthoringGolden = {
  "definition": {
    "datasets": [
      {
        "datasetId": "first_limit_pullback",
        "datasetVersion": "v7",
        "datasetVersionId": 750001,
        "note": "由 RESEARCH-006.3 promote 绑定（唯一坐标 dataset_version.id）",
        "role": "PRIMARY"
      }
    ],
    "entry": {
      "conditions": [],
      "event": {
        "description": "事件类型来自候选草稿 entryRule.event=FIRST_LIMIT_UP",
        "params": {
          "limitUpRatio": 0.1
        },
        "type": "FIRST_LIMIT_UP"
      },
      "observationWindow": {
        "end": 15,
        "start": 5,
        "unit": "TRADING_DAY"
      },
      "trigger": {
        "description": "触发时点来自候选草稿 entryRule.extra.trigger",
        "type": "FIRST_VALID_DAY"
      }
    },
    "execution": {
      "commissionModel": "BPS",
      "executionConstraints": [
        "一字板（开盘即涨停）不成交",
        "停牌顺延至下一交易日"
      ],
      "executionTiming": "T_PLUS_1_OPEN",
      "lotSize": 100,
      "priceType": "OPEN",
      "quantityMethod": "TARGET_WEIGHT",
      "signalTiming": "T_CLOSE",
      "slippageModel": "BPS"
    },
    "exit": {
      "rules": [
        {
          "description": "统一退出策略：止损、止盈、时间退出、strongHold 与 runnerBridge 由 policy 配置表达（来源：候选草稿 exitRule.policy）",
          "enabled": true,
          "id": "exit-unified-policy",
          "policy": {
            "capitalRecycle": null,
            "runnerBridge": {
              "decisionHoldingDays": 5,
              "extendToHoldingDays": 20,
              "kind": "PIT_RUNNER_HOLDING_BRIDGE",
              "state": "NEW_HIGH_3"
            },
            "stop": {
              "anchor": {
                "kind": "FIXED_PERCENT",
                "stopRatio": 0.06
              },
              "confirmation": "INTRADAY",
              "escalation": {
                "activationRatio": 0.03,
                "drawdownRatio": 0.08,
                "kind": "PEAK_DRAWDOWN"
              }
            },
            "strongHold": {
              "afterExtendedHold": "TIME_EXIT",
              "atHoldingDays": 5,
              "extendToHoldingDays": 10,
              "minReturnRatio": 0.03,
              "requireAboveMa10": true,
              "requireAboveMa5": true
            },
            "takeProfit": {
              "activationRatio": 0,
              "fastWindow": 5,
              "kind": "MA_CROSS",
              "slowWindow": 10
            },
            "timeExit": {
              "holdingDays": 5,
              "kind": "FIXED_HOLDING_DAYS"
            }
          },
          "priority": 0,
          "trigger": "ON_CLOSE",
          "type": "STOP_LOSS"
        }
      ]
    },
    "parameters": [],
    "position": {
      "maxExposure": 0.8,
      "maxPositions": 5,
      "maxSinglePosition": 0.3,
      "positionRatio": 0.2,
      "sizingMethod": "FIXED_RATIO"
    },
    "risk": {
      "maxDrawdown": 0.25,
      "maxExposure": 0.8,
      "stopLoss": 0.08
    },
    "schemaVersion": "1.0"
  },
  "recipe": {
    "featureVersions": [
      {
        "featureId": "threeFactorCompositeScore",
        "version": "1.0.0"
      }
    ],
    "kind": "signalEngine",
    "point": "close",
    "rankingConfig": {
      "higherIsBetter": true
    },
    "recipeId": "first-limit-pullback-3f-top3",
    "requiredData": [
      "OHLCV"
    ],
    "selectionConfig": {
      "method": {
        "kind": "topN",
        "n": 3
      }
    },
    "signalDescription": "首板回踩 3F 等权合成分（maxAmplitude / meanAmplitude 取 LOW，t1VolumeRatio 取 HIGH，桶位分各 1/3）—— 无硬门槛，合成分可算即入选，横截面按合成分降序取前 3 名",
    "signalFrequency": "daily"
  }
} as const;
