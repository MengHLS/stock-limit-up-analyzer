# RESEARCH-006.0 只读审计探针结果

## 1. 表存在性与行数

| 表 | 存在 | 行数 |
| --- | --- | --- |
| research_experiment | YES | 2 |
| research_hypothesis | YES | 0 |
| research_run | YES | 8 |
| research_analysis | YES | 19 |
| research_analysis_condition | YES | 11 |
| research_analysis_metric | YES | 0 |
| research_result | YES | 674 |
| research_conclusion | YES | 7 |
| research_strategy_candidate | YES | 0 |
| research_artifact | YES | 0 |
| research_analysis_template | YES | 0 |
| research_analysis_template_item | YES | 0 |
| strategy_versions | YES | 0 |
| strategy_parameters | YES | 0 |
| strategy_entry_rules | YES | 0 |
| strategy_exit_rules | YES | 0 |
| strategy_execution_rules | YES | 0 |
| strategy_version_datasets | YES | 0 |
| dataset_definition | YES | 1 |
| dataset_version | YES | 2 |
| dataset_build_job | YES | 4 |

## 2. `research_conclusion` 真实列

| 列 | 类型 | 可空 | 默认 |
| --- | --- | --- | --- |
| id | bigint | NO |  |
| experimentId | bigint | NO |  |
| hypothesisId | bigint | YES |  |
| conclusionType | varchar(32) | NO |  |
| title | varchar(200) | NO |  |
| conclusion | text | NO |  |
| evidenceJson | longtext | YES |  |
| confidence | double | YES |  |
| status | varchar(20) | NO | DRAFT |
| createdAt | timestamp | NO | CURRENT_TIMESTAMP |
| updatedAt | timestamp | NO | CURRENT_TIMESTAMP |

索引：
- PRIMARY (idx) → id
- idx_research_conclusion_experiment (idx) → experimentId
- idx_research_conclusion_hypothesis (idx) → hypothesisId
- idx_research_conclusion_status (idx) → status
外键数量：0

## 2. `research_strategy_candidate` 真实列

| 列 | 类型 | 可空 | 默认 |
| --- | --- | --- | --- |
| id | bigint | NO |  |
| experimentId | bigint | NO |  |
| conclusionId | bigint | YES |  |
| strategyDefinitionId | varchar(64) | YES |  |
| name | varchar(200) | NO |  |
| description | text | YES |  |
| entryRuleJson | longtext | YES |  |
| filterRuleJson | longtext | YES |  |
| exitRuleJson | longtext | YES |  |
| riskRuleJson | longtext | YES |  |
| parameterSpaceJson | longtext | YES |  |
| status | varchar(20) | NO | DRAFT |
| createdAt | timestamp | NO | CURRENT_TIMESTAMP |
| updatedAt | timestamp | NO | CURRENT_TIMESTAMP |

索引：
- PRIMARY (idx) → id
- idx_research_candidate_conclusion (idx) → conclusionId
- idx_research_candidate_experiment (idx) → experimentId
- idx_research_candidate_status (idx) → status
- idx_research_candidate_strategy (idx) → strategyDefinitionId
外键数量：0

## 3. Research 侧状态分布


### research_experiment.status
- {"status":"COMPLETED","c":2}

### research_run.status
- {"status":"COMPLETED","c":7}
- {"status":"FAILED","c":1}

### research_analysis.status
- {"status":"COMPLETED","c":18}
- {"status":"PENDING","c":1}

### research_conclusion.status
- {"status":"DRAFT","c":7}

### research_conclusion.conclusionType
- {"conclusionType":"SUPPORTED","c":5}
- {"conclusionType":"PARTIALLY_SUPPORTED","c":2}

### research_strategy_candidate.status
(空)

### strategy_versions.status
(空)

### dataset_version.status
- {"status":"READY","c":2}

### dataset_definition.datasetCode
- {"datasetCode":"first_limit_pullback","c":1}

## 4. strategy_versions 真实列（检查是否存在 research provenance 列）

id, strategyId, version, strategyDocumentJson, versionRecordJson, fingerprint, datasetVersion, universeId, codeVersion, createdAt, parentVersionId, status, description, updatedAt, datasetVersionId

## 5. 结论 evidenceJson 抽样（是否含 analysisId）

- #330001 exp=240002 hyp=null SUPPORTED/DRAFT ev={"disclaimer":"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。","policy":{"alpha":0.05,"materialityAbs":0.005,"minSampleCount":30,"stabilityMinConsistentRatio":0.6,"strongSampleMultiple":2},"hypothesisId":null,"hypothesisStatement":"(未登记假设陈述)","primaryAnalysis":
- #300001 exp=240002 hyp=null SUPPORTED/DRAFT ev={"disclaimer":"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。","policy":{"alpha":0.05,"materialityAbs":0.005,"minSampleCount":30,"stabilityMinConsistentRatio":0.6,"strongSampleMultiple":2},"hypothesisId":null,"hypothesisStatement":"(未登记假设陈述)","primaryAnalysis":
- #270001 exp=240002 hyp=null SUPPORTED/DRAFT ev={"disclaimer":"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。","policy":{"alpha":0.05,"materialityAbs":0.005,"minSampleCount":30,"stabilityMinConsistentRatio":0.6,"strongSampleMultiple":2},"hypothesisId":null,"hypothesisStatement":"(未登记假设陈述)","primaryAnalysis":
- #210002 exp=180001 hyp=null SUPPORTED/DRAFT ev={"disclaimer":"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。","policy":{"alpha":0.05,"materialityAbs":0.005,"minSampleCount":30,"stabilityMinConsistentRatio":0.6,"strongSampleMultiple":2},"hypothesisId":null,"hypothesisStatement":"(未登记假设陈述)","primaryAnalysis":
- #210001 exp=180001 hyp=null PARTIALLY_SUPPORTED/DRAFT ev={"disclaimer":"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。","policy":{"alpha":0.05,"materialityAbs":0.005,"minSampleCount":30,"stabilityMinConsistentRatio":0.6,"strongSampleMultiple":2},"hypothesisId":null,"hypothesisStatement":"(未登记假设陈述)","primaryAnalysis":

## 6. research_result / research_analysis 是否含 dataset 坐标列

- research_result: 无 dataset 相关列
- research_analysis: 无 dataset 相关列
- research_run: 无 dataset 相关列
