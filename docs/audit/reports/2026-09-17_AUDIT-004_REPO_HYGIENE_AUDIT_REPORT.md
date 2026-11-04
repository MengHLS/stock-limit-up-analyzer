# AUDIT-004 · 仓库卫生审计与清理报告

- **日期**：2026-09-17  ·  **执行者**：WorkBuddy  ·  **性质**：只读审计 + 用户裁定后的整理
- **范围**：`C:\work\sourcecode\stock-limit-up-analyzer` 全仓（1652 个文件，不含 `node_modules/`、`.git/`）
- **结论**：**284 个文件**定性为无用/过时/废弃并处置；其中 59 个**收拢归位**（仓库内移动），
  225 个**移出项目外**至隔离区。**零删除**。
- **验收**：`tsc --noEmit` = **exit 0（0 字节输出）**；dev server `:3000` 仍返回 **200**；源码目录零改动。

---

## 1. 方法：为什么不能「按文件类型」清理

本仓库的历史约定是「证据 = 真实 DB > 运行结果 > 代码 > 测试 > 文档 > 假设」。
散落的 `_*.mts` 探针、`.log` 运行结果、历史阶段报告**本身就是交付证据**，
`ROADMAP.md` / `docs/**` / `PROJECT_RULES.md` 会点名引用它们。⇒ **判据必须是「是否被引用」，不是「像不像垃圾」。**

三步只读取证：

| 步骤 | 做法 | 脚本 |
|---|---|---|
| 1 清点 | 按目录/扩展名/体积枚举全部文件 | `inv01_survey.py` |
| 2 引用扫描 | 对 **728 个候选**用 basename **路径感知**匹配，扫 `ROADMAP.md` + `docs/**` + `.workbuddy/**` + 源码 + `scripts/**` | `inv02_refscan.py` |
| 3 目录级核查 | 单独查「目录被引用但目录内单个文件不被引用」的情形 | `inv03_dirrefs.py` |

### 1.1 引用扫描判定分布

| 判定 | 文件数 | 体积 | 处置 |
|---|---|---|---|
| KEEP-AUTH 权威文档引用 | 287 | 8.50 MB | 保留 |
| KEEP-CODE 源码/工具引用 | 31 | 3.35 MB | 保留 |
| B-changelog-memory 仅变更日志/逐日日志提及 | 161 | 1.88 MB | 可动 |
| B2-sibling 仅被证据目录自身索引引用 | 52 | 0.47 MB | 可动（本轮**未动**，见 §6） |
| D-ZERO-REF 全库零引用 | 197 | 31.05 MB | 可动 |

> ⚠️ **第 2 步的第一次实现是错的**：初版沿用「`(?<![A-Za-z0-9_\-./\\])`」边界正则，
> 该 lookbehind **排除了 `/`** ⇒ 形如 `` scripts/verifyX.mts `` 的**带路径引用全部漏掉**，
> `KEEP-AUTH` 被低估成 105。改为「向左/右扩展到整个路径 token，再判断是否 == 候选路径 / 以 `/<候选路径>` 结尾 / 等于 basename」后，
> `KEEP-AUTH` 升到 287。**漏报方向是危险的**（把被引用文件当零引用删掉）。

> ⚠️ **第二次实现的分类口径也错过一次**：`.workbuddy/memory/PROJECT_RULES.md` 与 `MEMORY.md` 是**权威规则文件**，
> 不是「逐日日志」。初版把它们归入 `mem`（=仅日志提及）⇒ `scripts/verifyLimitUpCaliber.mts` 等被 `PROJECT_RULES.md`
> 点名的脚本被误判为可动。已修正为 `auth`。

---

## 2. 六个「看着像垃圾、实则是依赖」的陷阱（逐条 grep 坐实）

| # | 路径 | 依赖方 | 若删后果 |
|---|---|---|---|
| 1 | `scripts/backup/`（4 文件 **28.58 MB**） | `scripts/purgeStLimitUp.ts:27/53` 的 `BACKUP_DIR` | 销毁 2026-09-08 那次 ST 清洗的**可回滚 INSERT SQL** |
| 2 | `scripts/_dump/ce_main_20260907.sql`（1.9 MB） | `scripts/backfillStatusLiquidity_sql.ts`（4 处） | 回填链路断 |
| 3 | `scripts/_baostock_stock_basic_dump.json`（1.3 MB） | `backfillSecurityMasterBaostock.ts` 等 2 处 | universe 取数断 |
| 4 | `patches/wouter@3.7.1.patch` | `package.json` → `pnpm.patchedDependencies` | 补丁失效。**文件级扫描判为「零引用」——是假阴性** |
| 5 | `calibrate_open_expectation.ts` | `server/openExpectation.ts` 的**代码注释**（`client/src/pages/Backtest.tsx` 亦引用） | 注释里的可执行命令失效 |
| 6 | `.cache/ROADMAP.before-47-split.md`（852 KB） | — | §47 拆分**前**的 ROADMAP 唯一备份 |

**陷阱 1 的连带判断**：`purgeStLimitUp.ts:53` 是 `mkdirSync(BACKUP_DIR, { recursive: true })` ⇒
目录被移走后**脚本不会崩**，下次 `--apply` 会自建空 `scripts/backup/`；
代价仅是「2026-09-08 那批的回滚 SQL 离开项目目录」（可从隔离区取回）。已按用户裁定移出。

---

## 3. 处置结果（284 项 = 225 移出 + 59 归位）

### 3.1 移出项目外 → `C:/work/sourcecode/_cleanup-quarantine-20260917/stock-limit-up-analyzer`

| 桶 | 文件数 | 体积 | 内容 |
|---|---|---|---|
| `cat1-scratch-scripts` | 14 | 0.04 MB | 零引用 ad-hoc DB 探针 + 根目录 0 字节误产物 |
| `cat2-evidence-stale` | 180 | 2.98 MB | `docs/evidence/` 中仅被变更日志提及或零引用的运行产物 |
| `cat4-regenerable` | 26 | 4.79 MB | `dist/` + `.idea/` + `.cache/` 静态快照（均可重建） |
| `cat5-backup-dir` | 5 | 28.58 MB | `scripts/backup/` 整目录 |

**`cat1-scratch-scripts` 逐项**（判据：全库零引用、无持久化输出、却堆在生产脚本目录 `scripts/` 里）

- `scripts/_bt_time.ts` — 823 B
- `scripts/_ce_full_backfill.log` — 0 B
- `scripts/_ce_v2_backfill.log` — 1653 B
- `scripts/_cover.ts` — 535 B
- `scripts/_coverage_audit_raw2.json` — 25616 B
- `scripts/_dbprobe.mts` — 913 B
- `scripts/_idx.ts` — 604 B
- `scripts/_join.ts` — 663 B
- `scripts/_profile.ts` — 1901 B
- `scripts/_qt.ts` — 1123 B
- `scripts/_sel.ts` — 614 B
- `scripts/_verify.ts` — 1817 B
- `scripts/_verify_ce.ts` — 2676 B
- `事件日高点` — 0 B

**`cat5-backup-dir` 逐项**

- `scripts/backup/limit_up_st_records_2026-09-08T18-46-28-786Z.json` — 7756500 B
- `scripts/backup/limit_up_st_records_2026-09-08T18-46-28-786Z.sql` — 6782375 B
- `scripts/backup/limit_up_st_records_2026-09-08T18-46-53-606Z.json` — 7756500 B
- `scripts/backup/limit_up_st_records_2026-09-08T18-46-53-606Z.sql` — 6782375 B
- `scripts/backup/st_name_fix_targets.json` — 885428 B

`cat2` / `cat4` 的完整清单见隔离区 `MANIFEST.tsv`（225 行，含 `bucket / tracked / bytes / path / destination`）。

### 3.2 仓库内归位 → `docs/legacy/phase-reports/`

- 59 份历史阶段报告（`PHASE1_STEP*` / `STEP_*` / `WORK_*` / `step-dataset-*` / 早期 `PERF-*`、`MASTER_*`）
- 全部用 `git mv` 执行 ⇒ git 记为 `R`，可一步回滚
- `docs/` 根目录文件数 **79 → 20**
- 索引与回滚命令：`docs/legacy/phase-reports/README.md`

**为什么归位而不是移出**：这些文件是项目的**阶段性决策记录**，只被 `ROADMAP-CHANGELOG.md` 与逐日日志历史提及，
没有任何当前文档依赖它们。移出会破坏「历史可追溯」，留在 `docs/` 根又会与当前有效文档混淆 ⇒ 给它们一个固定坐标。

**为什么落在 `docs/legacy/phase-reports/` 而不是新建 `docs/archive/`**：
`docs/legacy/` 已存在且自述为「归位归档」（2026-09-13 收仓库根目录的非 `_*` 文件）。
新建第二个归档根目录本身就制造新的根目录噪音。

---

## 4. 执行期安全闸门（缺一不可）

| # | 闸门 | 结果 |
|---|---|---|
| 1 | 清单**程序枚举**（非手工转录） | 由 `inv02_refs.tsv` + 文件系统遍历生成 |
| 2 | 禁移目录前缀 + 路径越界检查 | 通过 |
| 3 | **受保护清单**（25 项）与桶**零交集** | 通过 |
| 4 | 只移不删，且**移后逐项校验 sha256** | 284/284 一致 |
| 5 | **新鲜度护栏**：20 分钟内被写过的 git-visible 文件一律不动 | 首次触发于 `dist/`（并行会话 12:21 的 `vite build`）⇒ 对 gitignored 的 `cat4` 豁免后通过 |
| 6 | 产出 `MANIFEST.json` + `MANIFEST.tsv` + `RESTORE.sh` + `ROLLBACK-git.sh` | 已产出 |

### 4.1 事后断言

```
1) git-status delta 可由 manifest 解释
   pre-state 之后的 188 条新状态 = 128 D + 59 R + 1 ??
   唯一「未解释」项 = ?? .ai/   <-- 并行会话 12:34 新建的 MCP 配置目录，非本次清理产物
2) 保留项 21/21 逐一 test -e 通过（含 ROADMAP.md / ROADMAP-CHANGELOG.md /
   .cache/ROADMAP.before-47-split.md / patches/wouter@3.7.1.patch / scripts/_dump/ ...）
3) 源码目录零删改：server 573 / client 209 / shared 11 / drizzle 61 / tests 250，D+R 计数全 0
4) 去向完整性：cat1 14/14、cat2 180/180、cat3 59/59、cat4 26/26、cat5 5/5
5) npx tsc --noEmit -> exit 0，stdout 0 字节
6) curl --noproxy '*' http://127.0.0.1:3000/ -> 200（dev server 未受影响）
```

---

## 5. 回滚

```bash
# A. 移出项目外的 225 项：逐项还原（只补缺失，绝不覆盖）
bash "C:/work/sourcecode/_cleanup-quarantine-20260917/stock-limit-up-analyzer/RESTORE.sh"

# B. 其中已被 git 跟踪的项，不必用隔离区副本，直接回仓：
bash "C:/work/sourcecode/_cleanup-quarantine-20260917/stock-limit-up-analyzer/ROLLBACK-git.sh"

# C. 归位的 59 份文档：
git reset -q && git checkout -- docs/PHASE1_STEP4_AUDIT_REPORT.md   # 见 docs/legacy/phase-reports/README.md 全量命令
```

---

## 6. 本轮**未**处理（如实登记，不夹带）

1. **52 个 `B2-sibling` 文件**（仅被 `docs/evidence/README.md` 自动生成的索引 + 同目录兄弟脚本引用）。
   这类引用是**元数据而非权威引用**，按判据可动；但**用户本轮未勾选**，因此一项未动。
2. **`.cache/stock-price-day-index.json`（4.06 MB）与 `.cache/leader-candidate-backtest/`**：
   属运行时缓存、可重建，但**dev server 正在运行中**，移走有与在途请求抢文件的风险 ⇒ 本轮跳过。
   停服后可清（`server/stockPriceIndex.ts` / `server/leaderCandidateBacktestSnapshot.ts` 会重建）。
3. **`scripts/checkEolDrift.mjs`**：并行会话于 12:30 新建，本轮完全不碰。
4. **`server/**` 的 6 处未提交改动**（STEP-0 研究链孤儿回收）：属在途交付，本轮完全不碰。
5. **面人类的根级文档**（`AUDIT-DRS-001-EVIDENCE.md` / `DEVELOPMENT_PLAN.md` / `TASK_TRACKING.md` / `README.MD`）：
   即使部分引用较弱也**默认保留**。

---

## 7. 防复发

`.gitignore` 追加 3 条**根锚定**规则（[REPO-HYGIENE-SCRIPTS-SCRATCH-001]）：

```
/scripts/_*.ts
/scripts/_*.mts
/scripts/_*.mjs
```

只锚定 `scripts/` **直下**、且以 `_` 开头的 TS 文件 —— 精确覆盖本轮 `cat1` 的那一类，
不误伤 `scripts/providers/*.py`（产品依赖，`server` 的 `pythonBridge` 子进程调用）
与 `scripts/_dump/`（被 `backfillStatusLiquidity_sql.ts` 引用）。

⚠️ **gitignore 不影响已跟踪文件** ⇒ 这 3 条只防未来新增，补不了既有的（既有已由本轮处置）。

---

## 8. 🔴 本轮实测推翻的两条既有记录

### 8.1 行尾：CRLF 文件不止 3 个

`PROJECT_RULES.md` 登记「全仓纯 CRLF 只有 3 个（`PROJECT_RULES.md` / `client/src/App.tsx` /
`client/src/components/AppShell.tsx`），其余 1584 个全纯 LF」。

**实测 `./.gitignore` = `CRLF 141 / LF 141` ⇒ 纯 CRLF**，是**第 4 个**。

=> 该条「只有 3 个」应改为「至少 4 个」，或按原纪律「**逐文件实测，禁按文件名/目录推断**」重新全仓清点。
本报告的行尾写入即按实测执行：`.gitignore` 用 CRLF 追加（改后 `CRLF 149 / LF 149`，
断言「原文逐字节为新文前缀」通过），报告与索引用 LF。

### 8.2 「目录级引用」是文件级扫描的系统性盲区

`scripts/backup/` 的 4 个大文件在**文件级**扫描下全部是 `D-ZERO-REF`（零引用），
但它们所在的**目录**被 `purgeStLimitUp.ts` 引用。`patches/` 同理（被 `package.json` 引用）。

=> **任何引用扫描都必须补一遍「目录名级」核查**，否则会把「整目录被引用」误判成「目录内每个文件都零引用」。

---

## 9. 证据与再跑方法

| 产物 | 位置 |
|---|---|
| 隔离区（225 项 + 4 个脚本） | `C:/work/sourcecode/_cleanup-quarantine-20260917/stock-limit-up-analyzer/` |
| 权威「什么去了哪」清单 | 同上 `MANIFEST.tsv`（225 行 TSV） |
| 一键还原 | 同上 `RESTORE.sh` |
| git 快捷回滚 | 同上 `ROLLBACK-git.sh` |
| 归档索引 | `docs/legacy/phase-reports/README.md`（59 项） |
| 分析脚本（可复跑） | 同上 `analysis/`（`inv01`~`inv06`、`exec_cleanup.py`、`verify_cleanup.py`、`finish_cleanup.py`） |
| 本报告 | `docs/audit/reports/2026-09-17_AUDIT-004_REPO_HYGIENE_AUDIT_REPORT.md` |

> 分析脚本按既有纪律**写到了仓外** `C:\work\sourcecode\_scratch\`，收尾时复制进隔离区 `analysis/` 存档；
> 项目内不新增过程脚本。


---

## 10. 收尾状态（执行后实测）

| 项 | 结果 |
|---|---|
| 仓库文件数（不含 `node_modules/`、`.git/`） | 1654 |
| `git status --porcelain` | `128 D` + `59 R` + `68 ??` + `11 M` |
| `npx tsc --noEmit` | **exit 0** |
| `curl --noproxy '*' http://127.0.0.1:3000/` | **200** |
| `docs/` 根目录文件数 | 79 → **20** |
| 仓库根目录条目 | 35 → **34**（`事件日高点` 已清） |

**空目录收尾**：`dist/` 与 `scripts/backup/` 在文件移出后成为**纯空目录**，已一并删除 ——
按仓库纪律「新建/遗留的空目录本身就是新的目录噪音」。两者均可重建
（`dist/` 由 `npx vite build`，`scripts/backup/` 由 `purgeStLimitUp.ts:53` 的 `mkdirSync(recursive)` 自建）。

**`.idea/` 被 IDE 自愈**：移出 18 个文件后，**正在运行的 IDE 立即重建了 `.idea/dataSources/data_sources_history.xml`**。
⇒ `.idea/` 类本地 IDE 状态在 IDE 开启时清理会被部分撤销，属预期行为，未再干预。

**`128 D` 的口径提醒**：这 128 条 `D` 是**移动出仓库**（不是删除），内容全部可从
`RESTORE.sh`（隔离区副本）或 `ROLLBACK-git.sh`（git 历史）恢复。
它会**污染并行会话对 `git status` 的判读** —— 若看到本批 `D`，请勿误判为「大规模删代码」。
