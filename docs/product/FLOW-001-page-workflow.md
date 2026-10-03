# FLOW-001 — 页面功能流程梳理（研究闭环六阶段）

> 日期：**2026-10-03** · 状态：**IMPLEMENTED（§4 侧栏重组已落地；四缺口已由 PRODUCT-DECISIONS-001 裁定并落地为 PD-01/PD-04/PD-03）** · 作者：Product Agent
> 事实来源：`client/src/App.tsx`（44 条路由）· `client/src/components/AppShell.tsx`（侧栏 27 项）· `client/src/pages/**`（页面头注释 + tRPC 调用）· `server/routers.ts`（21 个顶层 key）
> 范围前提：**组合回测 `/backtest` 保持原样**（内容 / 命名 / 位置均不动），不纳入主流程。
> 下游：`docs/product/PRODUCT-DECISIONS-001.md`（四缺口决策）

---

## 1. 一条主流程

```text
①  数据地基            ②  观察与假设          ③  研究实验
   数据域健康              行情总览(首页)          独立实验（列表 → 详情）
   数据集 / 版本           涨停复盘                └ 运行 Run → Raw Result
   历史状态查询            大盘分析                └ Candidate 详情
   行情同步                情绪分析
   上传图片                情绪预警
   操作日志                龙头候选
        │                        │                        │
        │ 交出：READY 的          │ 交出：研究问题           │ 交出：Candidate
        │ datasetVersion         │ (Observation→Hypothesis) │ (含 provenance)
        ▼                        ▼                        ▼
   ④ 策略化：策略列表 → 详情（定义/版本/运行）→ 版本演化
             + 参数搜索 + 绩效仪表盘 + 回测历史 + 回测对比
        交出：冻结的 StrategyVersion + 冻结参数集 + 留档回测
                                 │
                                 ▼
   ⑤ 验证：稳健性（零重跑）· 样本外 OOS（真重跑）· Walk-Forward（逐 Fold 真重跑）
           + Regime / 报告（归因与导出）
        交出：验证结论（必须标注 in-sample / out-of-sample）
                                 │
                                 ▼
   ⑥ 前向与复盘：前向纸面交易 · 模拟盘（3570001 专项）· 复盘工作台
        交出：复盘发现 → 回到 ② （闭环）

   ⚙  工具箱：组合回测 /backtest —— 保持原样，独立入口
```

## 2. 逐阶段定义

| 阶段 | 用户要回答的问题 | 入口页面 | 产出（交接物） |
|---|---|---|---|
| ① 数据地基 | 数据能不能支撑这个研究？ | `/data-health` `/datasets/**` `/historical-state` `/stock-sync` `/upload` `/operation-logs` | READY 的 `dataset_version`（坐标 + 区间 + 口径 + gate） |
| ② 观察与假设 | 市场什么状态？我看到什么异常？ | `/`(首页) `/limit-up` `/market` `/sentiment-analysis` `/leader-candidates` `/sentiment-alerts` | 研究问题（Observation → Hypothesis） |
| ③ 研究实验 | 这个假设历史上成立吗？ | `/research-experiments` → `/:group/:key` → `/runs/:runId` → `/candidates/:id` | Raw Result → Candidate（含坐标与证据指纹） |
| ④ 策略化 | 能变成可执行、可复现的策略吗？ | `/strategies` → `/:id` → `/:id/compare` `/parameter-search` `/performance` `/backtest-runs` `/backtest-compare` | 冻结的 StrategyVersion + 冻结参数集 + 留档回测 |
| ⑤ 验证 | 是不是拟合出来的？ | `/validation` `/validation/robustness` `/validation/oos` `/validation/walk-forward` `/regime-report` | 验证结论（标注 IS / OOS 分离） |
| ⑥ 前向与复盘 | 实盘节奏下还成立吗？执行得怎么样？ | `/paper-trading` `/paper-trading-3570001` `/review-workbench` | 复盘发现 → 回到 ② |

## 3. 交接物（流程骨架）

| 交接 | 交出什么 | 现状 |
|---|---|---|
| ①→② | `datasetVersionId` + 区间 + 口径 | ✅ 有；⚠️ 观察页未显示当前坐标 |
| ②→③ | 研究问题 | 🔴 无承载物（见 PD-01） |
| ③→④ | Candidate + provenance | ⚠️ 详情在、列表不在（见 PD-03） |
| ④→⑤ | 冻结版本 + 冻结参数集 + 搜索 Run | 🔴 前置依赖在 UI 不可见（见 PD-04） |
| ⑤→⑥ | 验证结论（IS/OOS 分离） | ✅ 数据在；✅ **统一状态标识已补齐** —— 策略详情新增「验证状态」Tab（三块验证 × 状态台账 + 深链；只表示「跑没跑过」） |
| ⑥→② | 复盘发现 | ✅ **闭环已在 UI 表达** —— 首页流程带显式写出「↻ ⑥ → 回到 ② 观察」；复盘工作台新增「闭环出口」区（回 ② 观察 ×2 / 去 ③ 研究 ×1），并声明「只回跳，不替你下研究结论」 |

## 4. 侧栏信息架构重组（✅ 已实现 2026-10-03；28 项一项不丢）

> 🔴 **本文件早先的自相矛盾已修正**：草案曾把「组合回测」放进 ⚙ 工具箱，与 §5 的「🔒 不挪位置」冲突。
> 以 §5 为准（用户要求组合回测暂时保持原样）⇒ 最终实现里组合回测**留在 ④ 策略**，不设工具箱分组。

```text
① 数据        数据域健康 · 数据集 · 历史状态查询 · 行情同步 · 上传图片 · 操作日志          (6)
② 观察        涨停复盘 · 大盘分析 · 情绪分析 · 龙头候选 · 情绪预警                      (5)
③ 研究        独立实验 · 候选                                                          (2)
④ 策略        策略 · 参数搜索 · 绩效仪表盘 · 回测历史 · 回测对比 · 最终评估(专项) · 组合回测   (7)
⑤ 验证        验证总览 · 稳健性 · 样本外 OOS · Walk-Forward · Regime / 报告             (5)
⑥ 前向与复盘   前向纸面交易 · 模拟盘(专项) · 复盘工作台                                  (3)
```

原分组为「复盘分析 / 研究 / 策略 / 验证 / 交易 / 系统」（按**功能来源**）；现按**用户所处的研究闭环阶段**划分。

**结构锁**：`tests/client/src/pages/pageFlowContracts.test.ts` §14–§18（分组顺序 · 28 项集合 · 归位 · 组合回测不动 · 旧预览入口）。

**首页入口（原 §4 备注「建议改造成流程入口 + 今日观察」）**：✅ 已落地为**加法式**六阶段入口带
`client/src/components/research/ResearchFlowNav.tsx`（`current="OBSERVE"`），**行情总览区块一个未删**；
六阶段与侧栏逐条一致由 §20 钉死。决策见 `PRODUCT-DECISIONS-001.md` PD-05。

## 5. 关键迁移动作（✅ = 已于 2026-10-03 落地）

| 路由 | 动作 | 优先级 | 状态 |
|---|---|---|---|
| `/data-health` `/datasets/**` `/historical-state` `/stock-sync` `/upload` `/operation-logs` | 由「研究/系统」→「① 数据」 | P1 | ✅ |
| `/regime-report` | 由「系统」→「⑤ 验证」 | P1 | ✅ |
| `/review-workbench` | 由「系统」→「⑥ 前向与复盘」 | P1 | ✅ |
| `/paper-trading` | 由「交易」→「⑥ 前向与复盘」 | P2 | ✅ |
| ~~观察类页面补显「当前 `datasetVersionId`」~~ | ❌ **撤销** | ~~P2~~ | 观察页 **dataset-unaware**（读 `limit_up_records` 等 legacy 表），**没有可显示的坐标**；强行显示会造假。见 `SPEC-002` §1 与 `PRODUCT-DECISIONS-001` PD-01「前提修正」 |
| `/walk-forward`（旧预览） | 保持可达，统一从「⑤ 验证总览」进入 | P2 | ✅（已不在侧栏；入口见 `ValidationIndexPage`） |
| `/strategy-final-evaluation` `/paper-trading-3570001` | 标记「专项页」，长期收敛进策略详情标签 | P3 | ✅ **标记已落地**（侧栏标签加「（专项）」，并注明绑定单一策略 3570001）；⏳ 长期收敛进策略详情标签仍待后续 |
| `/backtest` 组合回测 | 🔒 **保持原样**（不挪位置 / 不改名 / 不改内容） | — | ✅ |

## 6. Non-goals 与后续

- ❌ 不动组合回测（内容 / 命名 / 位置）
- ❌ 不拆 `sentiment.*` 端点桶 —— **跨域**，交 Architecture Agent 独立出 Scope（现状：6+ 页面共用该 tRPC key）
- ❌ 不裁定 Finding / Conclusion 语义 —— 已由 PD-02 裁定**不暴露**
- ⏳ **P3 遗留**：`/strategy-final-evaluation` / `/paper-trading-3570001` 的「专项页」标记与长期收敛进策略详情标签

> §6（原四缺口）已全部由 `docs/product/PRODUCT-DECISIONS-001.md` 裁定，并落地为 PD-01 / PD-04 / PD-03（见 `SPEC-001..003` / `FE-PLAN-001..002` / `docs/architecture/SCOPE-001-*.md`）。