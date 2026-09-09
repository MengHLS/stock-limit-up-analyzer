# stock-limit-up-analyzer 项目长期约定

## 总路线图（强制）
- **`ROADMAP.md`（根目录）是唯一 Master Control 文档**（QUANT RESEARCH MASTER CONTROL SPEC V2），自主推进以它为最高依据。
- **结构**：§0-43 规范铁律/状态机/验收标准；§44 真实状态映射（覆盖式更新）；§45 Entry/Exit 实例化；§46 差异识别；§47 更新记录（append-only，禁止删改历史）。
- **每个任务完成后必须更新**：§44 数据快照（覆盖式）+ §47 追加更新记录（append-only，带时间戳）。
- **状态口径（7 态模型）**：DESIGN / CODE_READY / DATA_READY / VALIDATED / RESEARCH_READY / PRODUCTION_READY / BLOCKED。
- **新增中间层**：STEP 12.5（Historical State Reconstruction）、STEP 12.6（Research Dataset Certification）是 STEP 13 的前置硬门槛。
- **核心 Gate**：`RESEARCH_READY = TRUE` 才允许正式策略结论；代码存在 ≠ VALIDATED，测试通过 ≠ Research Ready。

## 铁律（不可违背）
- 正确性 > 数据真实性 > PIT > 可复现性 > 架构完整性 > 测试 > 速度。
- 证据优先级：真实 DB > 运行结果 > 代码 > 测试 > 文档 > 假设。
- 禁止 mock 冒充真实数据；`RESEARCH_READY=FALSE` 期间不产出正式策略结论。
- PIT（asOf 只看 T 时刻已知信息）、Survivorship（历史池不能用当前列表回填）。

## 数据源战略
- **OHLCV 用 Tushare**（daily 接口未限频）；**其余 6 域用 BaoStock**（免费无配额，最新到 2026-09-04）。
- **BaoStock 硬约束**：单账号单活跃会话 → 回填任务必须**串行**，并发会触发「用户未登录」。C+E 已加 `fetchStockDailyWithRetry`（3 次退避重试）。
- BaoStock Python：`C:/Users/A/.workbuddy/binaries/python/envs/default/Scripts/python.exe`，bridge 在 `scripts/providers/baostock_probe.py`。
- BaoStock stock_basic 有 2000 行分页限制 → 回填 universe 从 `research_security_identifier_history` 读（`--universe-from-db`），不重新拉 stock_basic。

## 回填 CLI 命令
- OHLCV resume：`npx tsx scripts/backfillDaily.ts --start=2019-01-01 --end=2026-09-04`
- C+E：`MARKETDATA_PYTHON="<venv python>" npx tsx scripts/backfillStatusLiquidity.ts --universe-from-db --from=2019-01-01 --to=2026-09-04`
- G：`MARKETDATA_PYTHON="<venv python>" npx tsx scripts/backfillIndustry.ts --universe-from-db`
- 认证 gate：`node scripts/step12_certify_gate.mjs` → `docs/researchReadyGate/research_ready_gate.json`

## 目录命名规范（§49，2026-09-07 定稿）
- 代码模块目录/文件名禁止携带 STEP/C-task 编号（如 signal13、costModel14 已全部更名）；纯语义小驼峰：signalEngine/costModel/executionConstraints/riskAdjustedMetrics/tradeQualityMetrics/parameterSearch/rollingOptimization/robustness/stochasticRobustness/walkForwardRun/oosIsolation/overfittingDetection/lifecycle/marketRegime/paperAccount/signalToPnl。
- 给子代理的 prompt 一律用新目录名；历史文档旧名以 ROADMAP §47 21:45 改名记录为对照。

## 开发约定
- 多 agent 并行（DeepSeek-v4-flash、后台、本地提交不推送）；agent 产出必须「信任但验证」（跑 check + 测试 + 实查 DB）。
- 每个任务完成后：测试 → 验证 → 报告 → 更新 ROADMAP.md → 决定下一任务，形成自主开发闭环。
