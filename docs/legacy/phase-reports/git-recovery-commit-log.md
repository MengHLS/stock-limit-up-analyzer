# Git 恢复记录：本地未推送提交清单

> 生成时间：2026-09-09 12:24
> 背景：`.git/refs` 目录丢失 + `objects/pack/*.pack` 数据文件丢失，导致 git 报 "not a git repository"。
> 恢复方式：备份整个项目 → 重新 init → 从远程 origin/main（`0d60b56`）重建历史 → 保留工作区文件。
> 结果：以下 20 个本地 commit 的历史对象已无法从本地恢复，但其**文件改动全部保留在工作区**，当前显示为「未提交修改」。

## 远程基线

- 远程 origin/main 最新提交：`0d60b56c821c847ed7002d8e4a45a86272aec4a0`（Merge remote-tracking branch 'origin/main'）

## 本地未推送的 20 个 commit（按时间正序，从旧到新）

| # | hash | 提交消息 |
|---|------|----------|
| 1 | `a62cfaa3` | STEP 12: 历史数据集生产回填产物（engineKeyBridge + backfill 改造 + 生产修复 + 认证报告） |
| 2 | `e1241048` | test: 修复 stockPriceSyncPage 页面演进(StockPriceSync→StockSync)后的测试漂移 |
| 3 | `e3125f68` | STEP 12 WORK B: Security Master + Identifier History 落库（namechange provider + 确定性 securityId + 幂等 upsert + 回填 CLI） |
| 4 | `4ae05bc1` | STEP 12 WORK D+F: Corporate Actions 与 Index 真实数据回填（tushareProvider/indexStorage + 回填 CLI + 真实落库验证） |
| 5 | `a085c738` | STEP 13: Research Engine 实现规划（只读调研，3 个缺失数据源 + engineKeyBridge 落库） |
| 6 | `4a46e4ff` | STEP 12: 用 BaoStock 全量替代 Tushare 回填 6 个研究域（B全量+G行业+D全量+F指数补全+C+E状态流动性） |
| 7 | `62b4267c` | STEP 12: 回填 CLI 支持 --universe-from-db（从 identifier_history 读 5552 股 universe，绕过 BaoStock stock_basic 2000 行分页限制） |
| 8 | `dc9bdf65` | docs: 记录 BaoStock 全量替代 Tushare 战略转变与 6 域回填进度 |
| 9 | `1991155f` | STEP 12 WORK H: Research Ready Gate 认证收口 + C+E 回填加登录重试机制 |
| 10 | `8f050564` | docs: 记录 CEGH 收口进度与 BaoStock 登录竞争诊断 |
| 11 | `6207625f` | docs: 建立项目总路线图 ROADMAP.md + 固化持续更新约定 |
| 12 | `21a04d6c` | docs: 落地 QUANT RESEARCH MASTER CONTROL SPEC V2 为唯一 Master Control 文档 + 真实状态映射(7态模型) + Entry/Exit 实例化 |
| 13 | `461fec5a` | docs: 同步项目长期记忆到 V2 规范（7态模型 + STEP 12.5/12.6 中间层） |
| 14 | `2b786f79` | STEP 12 WORK A: OHLCV 全量回填完成(889万行/1863交易日/0重复) + 串行编排器 + gate 快照更新 |
| 15 | `8c6148f4` | docs: WORK G Industry 全量回填完成(5212行/83行业) + 重启 C+E 串行链 |
| 16 | `58667172` | STEP 12.5/12.6/13: 补提交已验证代码(historicalState/researchDataset/datasetAccess/signal13/experimentLineage + CLI + 审计体系) |
| 17 | `f111535c` | docs: 同步 C-13.2/C-13.3 交付记录(signal13/experimentLineage) |
| 18 | `93b92b53` | fix: C+E 回填加 DB 写重试+逐股隔离(ECONNRESET 不再崩溃整个进程) |
| 19 | `105e6b8a` | docs: 记录 C+E ECONNRESET 修复与二次重启 |
| 20 | `25a6e979` | 部分后的及部分前端 |

## 后续建议

- 当前工作区相对 origin/main 有 **26 个修改文件 + 147 个新增文件**（含 `.git.broken/` 备份目录）。
- 建议：review 后按上面的消息重新分批提交，或一次性提交全部改动。
- `.git.broken/` 目录是损坏的旧 `.git` 备份（含完整 reflog），确认不再需要后可删除。
- 全量备份位置：`C:\work\sourcecode\stock-limit-up-analyzer-backup-20260909.tar.gz`
