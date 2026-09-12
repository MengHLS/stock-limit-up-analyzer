# RESEARCH-006.1 前状态审计（真实 TiDB）

## 1. 全库表总数

58

## 2. research_* 表（19 张）

| 表 | 行数 | 列数 |
| --- | ---: | ---: |
| research_analysis | 19 | 9 |
| research_analysis_condition | 11 | 10 |
| research_analysis_metric | 0 | 7 |
| research_analysis_template | 0 | 6 |
| research_analysis_template_item | 0 | 9 |
| research_artifact | 0 | 9 |
| research_conclusion | 7 | 11 |
| research_datasets | 7 | 19 |
| research_experiment | 2 | 12 |
| research_experiment_batches | 0 | 10 |
| research_experiments | 0 | 8 |
| research_hypothesis | 0 | 10 |
| research_result | 674 | 9 |
| research_run | 8 | 13 |
| research_runs | 2 | 12 |
| research_securities | 5552 | 11 |
| research_security_identifier_history | 5552 | 9 |
| research_security_status_history | 15925 | 12 |
| research_strategy_candidate | 0 | 14 |

## 3. research_strategy_candidate 真实列

| 列 | 类型 | NULL | KEY |
| --- | --- | --- | --- |
| id | bigint | NO | PRI |
| experimentId | bigint | NO | MUL |
| conclusionId | bigint | YES | MUL |
| strategyDefinitionId | varchar(64) | YES | MUL |
| name | varchar(200) | NO |  |
| description | text | YES |  |
| entryRuleJson | longtext | YES |  |
| filterRuleJson | longtext | YES |  |
| exitRuleJson | longtext | YES |  |
| riskRuleJson | longtext | YES |  |
| parameterSpaceJson | longtext | YES |  |
| status | varchar(20) | NO | MUL |
| createdAt | timestamp | NO |  |
| updatedAt | timestamp | NO |  |

索引（5）：PRIMARY(id), idx_research_candidate_conclusion(conclusionId), idx_research_candidate_experiment(experimentId), idx_research_candidate_status(status), idx_research_candidate_strategy(strategyDefinitionId)
FK：[]

## 4. strategy_research_provenance 是否存在

存在 = **false**

## 5. strategy_* / dataset_* 行数

| 表 | 行数 |
| --- | ---: |
| dataset_build_config | 2 |
| dataset_build_config_board | 2 |
| dataset_build_config_event | 2 |
| dataset_build_job | 4 |
| dataset_definition | 1 |
| dataset_version | 2 |
| ds_first_limit_pullback_event | 25108 |
| ds_first_limit_pullback_outcome | 75324 |
| ds_first_limit_pullback_path | 487692 |
| ds_first_limit_pullback_post | 487692 |
| ds_first_limit_pullback_prefix | 527268 |
| strategy_entry_rules | 0 |
| strategy_execution_rules | 0 |
| strategy_exit_rules | 0 |
| strategy_parameters | 0 |
| strategy_version_datasets | 0 |
| strategy_versions | 0 |

## 6. 全库 FK 计数

全库 FK 总数 = **0**
