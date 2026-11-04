# RESULT-T74-SUBNEW-FILTER-001

> 任务：`T74-SUBNEW-FILTER-001`（151% 策略「次新股要不要从候选池剔除」对照实验）
> 日期：2026-10-07（Asia/Shanghai）
> 结论：**REJECTED —— 剔除次新股不改善收益**（365/180/90 三个阈值全部低于控制臂 151.0958%，Δ = −19.95 ~ −85.71 pp）
> 真实 Run：`RUN-20261007-68FD5C7F`（datasetVersionId `780001`，COMPLETED，约 168 s，EXPLORATORY）

---

## 1. Task

用户先问「151% 策略里有多少是买次新股的（上市一年内）」，在得到只读诊断（`T74-SUBNEW-SHARE-001`：
1429 笔已实现交易中 **51 笔 = 3.57%** 是次新）后，要求「做一下对照实验」验证
**次新股要不要从候选池里剔除**。

## 2. Baseline Version

- 开工前实查 `git status --porcelain`：工作区存在并发会话未提交改动 ⇒ 审计对象是**当前 working tree**。
- 架构基线：`docs/architecture/SYSTEM-BASELINE.md`（本任务以本报告 + `CHANGE-AUDIT.md` 条目为准）。
- 控制臂冻结值来源：`composite-runner-newhigh3-t74` 留档（`closed_loop_backtest_run` id `6210006`，
  `eval-3600005-promoted-t74`，StrategyVersion `3600005@2.0.0`）。

## 3. Relevant Domains

- **Research / 组合执行**：`server/research/compositeRunner/index.ts#buildCompositeSourceRun`
  （新增 `candidateListingFilter`，**排序前**剔除）。
- **数据装配**：`server/researchExperiments/compositeDatasetProvider.ts`（新增
  `extensionSelectionArms[].excludeListedWithinDays` + `listingDateBySecurityId` 装载）。
- **Security Master 只读**：`server/security/repository.ts#loadListedDatesBySecurityIds`（新增，只读）。
- **契约**：`shared/researchExperimentsContracts.ts`（新增可选字段，缺省 = 既有行为）。
- **实验入口**：`research-experiments/first-board-pullback/composite-runner-newhigh3-t74-subnew/**`。

## 4. Pre-existing Facts（实查）

| 事实 | 读数 |
|---|---|
| 目标策略留档 | `closed_loop_backtest_run` id `6210006`：Full `151.0958341843399%` / MaxDD `43.302944323482485%` / 1434 笔 / Runner 触发 161 |
| 已实现交易 | 1429（1434 中 5 笔期末未平仓） |
| 次新成交（建仓日上市龄 < 365 自然日） | **51 笔（3.57%）**，净利 **+10,323.55 元**（总净利 188,837.84 的 **5.47%**），胜率 16/51 = 31.4%，实现 ≥+50% **1 笔** |
| 上市龄分档 | <90 天 9 · 90–180 天 12 · 180–365 天 30 · 365–730 天 48 · >730 天 1330 |
| 上市龄中位数 | 4185 天（≈11.5 年）；最小 22 天（`SH.603132`） |
| 证券主数据 | `research_securities` 5552 行，1429 笔交易 **全部命中** `listedDate` |
| 既有否定证据 | P4 已实测 rank4/5 递补净利为负、0 笔 ≥+50% |

## 5. Changes

**平台侧（全部 additive，缺省 = 既有行为逐字段不变）**

| 文件 | 变更 |
|---|---|
| `shared/researchExperimentsContracts.ts` | `extensionSelectionArms[].excludeListedWithinDays?: number\|null` |
| `server/research/compositeRunner/index.ts` | `BuildCompositeSourceRunInput.candidateListingFilter` + `ListingFilterAccounting` + `baseSecurityIdOf` + `listingAgeDays`（**排序 / 门槛 / 融合之前**执行） |
| `server/researchExperiments/compositeDatasetProvider.ts` | 臂级 `excludeListedWithinDays`、`includeListingDates`、载荷增 `listingDateBySecurityId` |
| `server/security/repository.ts` | 新增只读 `loadListedDatesBySecurityIds`（批量 `IN`，500/批） |
| `research-experiments/compositeRunnerBridge.ts` | 追加 re-export（`baseSecurityIdOf` / `ListingFilterAccounting`） |
| 新增实验 | `research-experiments/first-board-pullback/composite-runner-newhigh3-t74-subnew/**`（experiment / page / README） |
| 注册 | `research-experiments/manifest.ts` · `client/src/researchExperiments/pages.ts` · `client/src/pages/researchExperiments/experimentModes.ts`（分档台账 45 → 46） |
| 测试 | 新增 `tests/server/research/compositeRunner/listingFilter.test.ts`（6 例）· `tests/server/researchExperiments/compositeRunnerT74SubNew.test.ts`（5 例） · `tests/client/.../researchExperimentModeGrouping.test.ts` 台账 45→46 |

**实验设计（唯一自变量）**

```
control            : 无过滤（parity 参照）
excl365 / excl180 / excl90 : 3F 排序前剔除「上市龄 < N 自然日」的候选（允许低名次递补）
冻结：3F 排序 · 每日 top3 · 2 笔 / 5 仓 · EQUITY_RATIO 分层仓位 · SL-18.1 退出链
      candidateExitPolicy=DISABLED · Runner NEW_HIGH_3 / 5 / 74 · 坐标 780001 / 660001 · 成本模型
```

**口径**：上市日 = Security Master `listedDate`（PIT，决策日已知）；上市龄 = **决策日** − 上市日
（自然日）；上市日不可得 ⇒ **不剔除**并如实计数。

## 6. Contract Impact

新增 3 个**可选**字段（`excludeListedWithinDays` / `includeListingDates` / `candidateListingFilter`）
与 1 个载荷字段（`listingDateBySecurityId`）。**缺省路径逐字段不变**（控制臂 parity PASS 即证据）。
未改 `RuleGraph` 语义、未改 `canonicalMetrics`、未改 simulator / 执行语义。

## 7. DB Impact

**零 DDL / 零 migration。** 新增 1 条研究 Run 记录（`RUN-20261007-68FD5C7F`，跑的是既有实验框架的
正常留档路径）；全程 SELECT 只读（`research_securities` + 既有数据集 provider）。

## 8. Execution Impact

无。未注册新的生产执行路径；未改 `strategyCore/**`；未创建 StrategyVersion / Candidate。

## 9. 结果（真实 Run `RUN-20261007-68FD5C7F`）

控制臂 parity **PASS**：A `15.787690712129931%` / 1619 笔、C `151.0958341843399%` / 1434 笔、Runner 触发 161
（与 `6210006` 冻结值逐项一致）。`listingDates = 3299`；四臂 `listingUnknownDateCandidates = 0`。

| 臂 | 剔除阈值 | C 收益 % | C 最大回撤 % | Δ vs 控制 (pp) | ≥+50% | ≥+100% | 剔除候选 | 次新成交 | 次新净利 | C 成交 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 控制臂 | — | **151.0958** | **43.303** | 0 | **9** | 2 | 0 | 51 | +10,324 | 1434 |
| `excl365` | < 365 日 | 65.3907 | 50.7716 | **−85.71** | 9 | 2 | 1591 | 0 | 0 | 1444 |
| `excl180` | < 180 日 | 131.1477 | 43.0363 | **−19.95** | **10** | 2 | 904 | 31 | −93 | 1434 |
| `excl90` | < 90 日 | 109.9656 | 44.8163 | **−41.13** | 9 | 2 | 478 | 42 | +6,215 | 1437 |

### 读法

1. **三个阈值全部低于控制臂**：−19.95 / −41.13 / −85.71 pp ⇒ 判据 2（收益 ≥ 151.0958%）**未通过**。
2. **`excl180` 是唯一「≥+50% 笔数增加」的臂（9 → 10）且回撤略降（43.303% → 43.036%）**，但代价是
   收益 −19.95 pp —— 用 19.95 pp 换 1 笔超级票，不符合用户目标（要更多超级票，但不接受收益腰斩）。
3. **剔除阈值与结果无单调关系**（365 最差、180 最好、90 居中）⇒ 再次复现「**动选股 ⇒ 结果随机大幅
   变化**」这一 P0–P9 一贯结论。
4. **机制**：被剔除的名额由低名次**递补**，而 P4 已实测 rank4/5 递补净利为负、0 笔 ≥+50%
   ⇒ 「剔除次新」实际是在**换一批更差的票**。
5. **口径互证**：控制臂复算出的次新成交 51 笔 / 净利 +10,324 / 1 笔 ≥+50%，与只读诊断
   `T74-SUBNEW-SHARE-001`（3.57% / 5.47%）逐项吻合 ⇒ 新链路与独立探针一致。

### 判据核对

| 判据 | 结果 |
| --- | --- |
| 1. 控制臂 parity PASS | ✅ |
| 2. 过滤臂 C 收益 ≥ 151.0958% | ❌ 三条臂全部更低 |
| 3. 过滤臂 C 最大回撤 ≤ 43.303% | ⚠️ 仅 `excl180`（43.036%），但收益已降 19.95 pp |

⇒ **Gate = `REJECTED`**（EXPLORATORY 阶段无 confirmatoryGate，本判定按预设判据人工给出）。

## 10. Baseline Update

- 新增本报告（`docs/research/RESULT-T74-SUBNEW-FILTER-001.md`）；
- `docs/architecture/CHANGE-AUDIT.md` 追加条目；
- `docs/architecture/system-manifest.yaml` 追加 `t74SubNewRunP10`；
- `docs/architecture/SYSTEM-BASELINE.md` 头 minor 递增。

## 11. Remaining Risks

1. **未测「选中后跳过、不递补」**（P9 那种只过滤 intent 的语义）。若关心的是「不买次新」而非
   「换掉次新」，需另跑一臂；但控制臂次新净利为正（+10,324），先验期望同样不高。
2. 上市龄阈值只测了 365 / 180 / 90 三档，未做参数搜索（按纪律不做）。
3. 次新成交的「整体为正」**由 1 笔（`SH.603121` +74.41%、+12,812 元）支撑**，去掉即转负
   ⇒ 任何「依此结论加过滤」的做法都建立在单笔样本上。
4. `researchIntervalIdsByEvent` 类**并发会话改动**仍在工作区；本次未触碰。

## 12. Next Step

- **不要**把「剔除次新」加入候选池（已被本实验否定）。
- 若要继续提高收益，仍应回到既有两条真实缺口：**退出侧**（放宽 Runner 进入 / 盈利后更宽松退出，
  P3 只测了 stopRatio 一档）与**新信息源**（市场/板块状态、资金流/龙虎榜、市值筹码）。
- 「抓更多超级票」的杠杆总结（含本次）仍成立：换排序 / 多买名额 / 扩大止损 / 高点减仓回补 /
  TopN 3→5 / carry / 延迟入场 / 事件 gate / **上市龄过滤** —— **全部被实测否掉**。
