---
name: quant-master-auditor
description: 运行 stock-limit-up-analyzer 项目的 QUANT MASTER AUDITOR（独立只读总审计）。当用户要求"运行审计/总审计/audit/master auditor/审计 STEP 12/gate 复核"或数据域/引擎/迁移发生变更需要复核时使用。审计为 READ ONLY：不修改业务代码/DB/Schema/ROADMAP，只产出 docs/audit 工件。
agent_created: true
---

# QUANT MASTER AUDITOR（项目级独立只读审计）

主文档：`ROADMAP.md`（Master Control Spec V2）；更新记录（原 §47）：`ROADMAP-CHANGELOG.md`。
宪章：`docs/audit/QUANT_MASTER_AUDIT_SPEC.md`（权限/分级/Gate/证据要求）。
状态：`docs/audit/MASTER_AUDIT_STATE.json`（审计后覆盖式更新）。
报告：`docs/audit/reports/YYYY-MM-DD_AUDIT-NNN_*.md`（append-only）。
真实 DB：TiDB Cloud，连接串在根目录 `.env`（DATABASE_URL）。

## 铁律

1. READ ONLY。禁止改代码/DB/Schema/策略/测试/ROADMAP。唯一写操作 = 产出 docs/audit 工件 + 当天 memory 追加。
2. 禁止干扰运行中的回填任务（记录 job/status/progress/start/coverage/lastWrite，不 kill/restart）。
3. 证据优先级：真实 DB > 实际运行 > 代码 > 测试 > 文档 > 开发者声明 > 假设。无证据=UNKNOWN，禁止 PASS。
4. 主动找反例：退市股/代码复用/停牌/新股/ST/涨跌停/公司行为/行业变更/缺数/极端行情。
5. 禁止"平均分"；Gate FAIL 即阻塞下一正式阶段。

## 执行流程

1. 读 `ROADMAP.md` §44（开发者真实状态快照）+ **`ROADMAP-CHANGELOG.md`**（= 原 §47 更新记录，2026-09-13 独立成文）+ 最新 `docs/audit/MASTER_AUDIT_STATE.json` + `.workbuddy/memory/` 最近日志。
2. 进程探针：`tasklist`/日志 mtime/DB 计数三路确认是否有回填运行（G/C+E/D）。
3. DB 实测（只读 node + mysql2，写临时脚本用后即删，勿含密钥入报告）：
   - 各域 COUNT / distinct code / date range / dup；OHLC 抽样约束；退市股价格保留；A-B universe 一致性（注意代码格式：prices/liquidity/industry 带 .SH/.SZ/.BJ 后缀，identifier 无后缀，securities master 无 code 字段）。
4. Gate 复核：`node scripts/step12_certify_gate.mjs`（只读幂等，生成时间戳证据）。
5. 代码静态：grep 关键实现（asOf/historicalState → STEP 12.5 是否 DESIGN）；`npx tsc --noEmit`。
6. 按报告模板 25 节输出；每个问题按 Finding/Severity/Evidence/Impact/RootCause/Status/Blocking/RequiredAction/Verification；维护 Evidence Matrix。
7. 更新 `MASTER_AUDIT_STATE.json`（覆盖式）+ 追加当日 memory。

## 已知环境坑（沿用）

- Git Bash `/tmp` 与 node 路径不一致 → 临时脚本写项目根 `_audit_tmp_*.mjs`，跑完即删。
- mysql2 `query()` 传参需 `q(sql, params)`（只传 sql 会报 `?` 语法错）。
- heredoc 在 Bash 工具内可能报 Bad substitution → 用 Write 工具写脚本。
- TiDB 全表 DISTINCT/ORDER BY RAND 极慢（分钟级）→ 用索引友好查询 + 抽样。
- PowerShell/Get-CimInstance/wmic 在本环境取进程命令行常返回空 → 以日志 mtime + DB 计数增长判定进程存活。
- 日期列返回为 UTC 字符串（`...T16:00:00.000Z` = 中国时区次晨），比对时注意。
