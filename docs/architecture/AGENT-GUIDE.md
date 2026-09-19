# AGENT-GUIDE — 后续 Agent 使用规范

> Baseline **v1.0.0** · 2026-09-19
> 面向以后在本仓库工作的 WorkBuddy Agent。
> 🔴 **你不需要每次重新理解整个项目。**

---

## 1. 默认读取顺序（普通开发任务）

```text
1. docs/architecture/SYSTEM-BASELINE.md          ← 总入口（含 ADR / 风险 / 协议）
2. docs/architecture/system-manifest.yaml        ← 机器可读 Domain 索引
3. docs/architecture/CHANGE-AUDIT.md             ← 「上一次发生了什么」
4. 当前 Domain 对应文档（DOMAIN-MAP / DATA-FLOW / EXECUTION-FLOW /
   DATABASE-MAP / CONTRACT-MAP / DEPENDENCY-MAP 的**相关章节**）
5. 当前任务相关代码
6. 必要的上游 / 下游代码（只取直接依赖与直接消费者）
```

**按需细读**

| 任务类型 | 必读 | 可选 |
|---|---|---|
| 改某 Domain 逻辑 | `DOMAIN-MAP.md` 该节 + `DEPENDENCY-MAP.md` §2/§4 | `CONTRACT-MAP.md` 相关条 |
| 改数据结构 / 新表 | `DATABASE-MAP.md` §2（migration 机制）+ §3 表清单 | `ROADMAP.md` §49 命名规范 |
| 改契约 / 指标 | `CONTRACT-MAP.md` 相应条 + §附录检查清单 | `EXECUTION-FLOW.md` §4 |
| 改执行链 / 回测 | `EXECUTION-FLOW.md` §2/§3/§4 | `DATA-FLOW.md` §2.5 |
| 改前端 | `SYSTEM-BASELINE.md` §9 | `AppShell.tsx` / `App.tsx` |
| 查「现在到底什么状态」 | `SYSTEM-BASELINE.md` §5 + `system-manifest.yaml` | 真实库只读探针 |

**项目规则**：`.workbuddy/memory/PROJECT_RULES.md`（硬禁令唯一细则源）+ `MEMORY.md`（压缩索引）+ 当日 `.workbuddy/memory/YYYY-MM-DD.md`。

---

## 2. 什么时候必须做全局审计（`GLOBAL AUDIT REQUIRED`）

**只有**满足下列任一条时才重新全局审计（触发条目编号必须写进 `CHANGE-AUDIT.md`）：

1. Domain 新增
2. Domain 删除
3. Domain 边界变化
4. 核心数据流变化
5. `Dataset → Research → Strategy → Backtest` 主链变化
6. Database 核心 Schema 大规模变化
7. 核心 Contract 变化
8. `StrategyRuntime` 改变职责
9. Backtest Execution Architecture 改变
10. 多个 Domain 同时大规模重构
11. Baseline 与代码出现重大冲突
12. 无法通过增量审计确定真实影响范围

**其余一律 Incremental Audit。**

---

## 3. Agent 禁止行为（硬约束）

| # | 禁止 |
|---|---|
| 1 | **自己重新定义项目架构**（架构以 `SYSTEM-BASELINE.md` + 代码为准） |
| 2 | **绕过 Baseline** 直接凭记忆或旧报告开工 |
| 3 | **把旧代码当生产代码**（LEGACY 清单见 `SYSTEM-BASELINE.md` §11） |
| 4 | **把 PLANNED / DESIGN 当 READY / IMPLEMENTED**（禁止把 `PLANNED` 写成 `READY`） |
| 5 | **为了当前任务擅自修改其他 Domain** |
| 6 | **修改历史数据而不登记** |
| 7 | **修改 Contract 而不更新 `CONTRACT-MAP.md`** |
| 8 | **为了让 Baseline 看起来正确而修改代码**（冲突时以代码/DB/实测为准） |
| 9 | 系统性创建 `SYSTEM-BASELINE-002/003`、`ARCHITECTURE-001/002`、`BACKTEST-003/004` 这类拆分编号 |
| 10 | 跑 `db:push` / `drizzle-kit generate` / 手写 `_journal.json` |
| 11 | 在用户使用页面时改 `server/**`（会热重启并**杀死在途 Run**）或跑重库脚本 |
| 12 | 把未装配阶段改成静默 success（必须保持 `CL_RUNNER_NOT_INJECTED` 如实 BLOCKED） |
| 13 | 修改 `closed_loop_backtest_run` 历史行 / 回填 v0 政策 |
| 14 | 新建第二套 SoT（`backtestCore/**`、`strategy_rules/parameters/runs` 表、第二套 `canonicalMetrics`） |

---

## 4. 任务报告统一格式（建议）

```text
1.  Task
2.  Baseline Version          ← 你读取的是哪个版本
3.  Relevant Domains
4.  Pre-existing Facts        ← 来自 Baseline
5.  Changes
6.  Contract Impact
7.  DB Impact
8.  Execution Impact
9.  Tests
10. Baseline Update           ← 更新了哪些基线文件
11. Remaining Risks
12. Next Step
```

> 目的：以后不需要重新阅读几十份历史报告才能理解状态。

---

## 5. 完成任务后的 Baseline 更新规则

| 变更类型 | 必须做的事 |
|---|---|
| 只有实现细节变化 | **只更新** `CHANGE-AUDIT.md` |
| Domain 状态跃迁 / 新增 entry point / 新增 contract | 更新 `CHANGE-AUDIT.md` + `SYSTEM-BASELINE.md` + `system-manifest.yaml`（版本 **minor**） |
| 触发 `GLOBAL AUDIT REQUIRED` 任一条 | 全局审计 + 更新**全部**基线文件（版本 **major**），并在 `CHANGE-AUDIT.md` 写明触发条目编号 |
| 发现 Baseline Drift | 执行 Drift Audit（见下）+ 写入 `CHANGE-AUDIT.md` |

---

## 6. Baseline Drift 处置（Agent 视角）

**你必须做的事**：发现「Baseline 说 A / 代码是 B」时，**不要静默继续**。

```text
1. 停下当前任务
2. 输出 BASELINE_DRIFT 记录（drift / actual / detectedBy / correctedAt / reason）
3. 修正 Baseline 文档（**不改代码**）
4. 写入 CHANGE-AUDIT.md
5. 恢复任务
```

**已有 11 条历史 drift 已登记**（`SYSTEM-BASELINE.md` §12.4，H-1 ~ H-11）——遇到它们**不需要重新讨论**，直接引用。

---

## 7. 本项目特有陷阱（开工前必看）

| # | 陷阱 | 依据 |
|---|---|---|
| 1 | **改 `server/**` 会热重启并杀死在途 Run**（在途 = `RUNNING`；`PENDING` + 空 `inputSnapshot` 的草稿禁收敛） | PROJECT_RULES |
| 2 | **同一文件多处编辑必须串行** —— 并行两个 Edit ⇒ 后写覆盖先写，前者静默丢失 | PROJECT_RULES |
| 3 | **`datasetVersion`（label）不是坐标**，`datasetVersionId` 才是 | `DATA-FLOW.md` §1 |
| 4 | **`dataReady: true` 必须显式传**，否则 `INCONCLUSIVE` | `runAudit.ts:74` |
| 5 | **`index_daily` 是交易日历唯一来源**；停更会静默 no-op 却报成功 ⇒ 补数须 `--force` | — |
| 6 | **`/backtest` 并存两套交易语义**（快照 = 等权；顶层 = 固定 100 股）⇒ 禁加 cap | — |
| 7 | **止损三落点互不相通**；`server/engine/**` **完全不执行**止损 | `EXECUTION-FLOW.md` §7 E-7 |
| 8 | **`limit_up_records.boardCount` 基本全 NULL** ⇒ 不可作真源；连板高度用 `shared/ladderHeight.ts` | — |
| 9 | **年化口径唯一 = 252**，且**算式形式也算口径**（代数等价但浮点不同） | AD-07 |
| 10 | **`resultJson` 新增段必须可选**，否则历史留档读取会炸 | C-13 |
| 11 | **留档写入必须重试**（长运行后连接被静默重置）⇒ 别改成「失败即抛」 | AD-17 |
| 12 | **未装配阶段不得改成静默 success** | AD-16 |
| 13 | **取号真源 = ROADMAP「编号台账」行**（禁「末条 +1」）；取号前先对远端 | PROJECT_RULES |
| 14 | **`client/**` 只禁 import `server/**` 运行时值**；`@shared/*` 允许 | §9 |
| 15 | 🔴 **基线里的行号只是 `auditedAt` 快照** —— 本项目 `server/**` 处于高频编辑（且可能有并发会话）⇒ 定位一律用「**路径 + 符号名**」grep，行号对不上**不算 drift** | `SYSTEM-BASELINE.md` §12.5 BD-02 |
| 16 | 🔴 **基线描述的是「工作区」不是 HEAD** —— 开工前先 `git status --porcelain` 看是否有未提交改动；有则先确认「你审计的是哪一份代码」 | `SYSTEM-BASELINE.md` §12.5 BD-01 |

---

## 8. 工具环境注意（本机实测）

| 项 | 事实 |
|---|---|
| 沙箱 Bash | **缺 coreutils**（`ls`/`head`/`dirname` 均不可用）⇒ 目录/文件枚举用 Python 或 Glob |
| `git` / `node` | **不认 `/c/...`** 路径 ⇒ 必须传 `C:/...` |
| Win stdout | 常不返回 ⇒ **长任务输出落盘再读** |
| 长任务输出 | 🔴 **禁接管道**（EPIPE ⇒ 脚本中止并清空自身留档）；后台跑 + 读 `.out.txt` |
| 改文件 | Python bytes + `os.replace` + 回读；`str.replace` 每处**必须 assert count == 1** |
| 前端验收 | 无头 Chrome + Node `WebSocket` 直连 CDP 量 DOM；端口须**实测空闲**，输出**必须落盘** |
| 探针/报告落点 | one-off 脚本 `_scratch\`（仓外）；报告 `docs/research/`；探针 `docs/evidence/`（**须登记 `README.md`**） |

---

## 9. 一句话总结

> **先读 Baseline → 确定 Domain → 只审计本 Domain ±直接上下游 ±涉及契约 → 开发 → 更新 CHANGE-AUDIT（必要时升基线版本）。**
> 只有当任务真正改变了**领域边界 / 主链 / 核心契约 / 数据库核心 schema** 时，才回到全局审计。
