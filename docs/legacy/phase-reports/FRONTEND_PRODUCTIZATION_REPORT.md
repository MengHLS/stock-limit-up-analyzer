# FRONTEND PRODUCTIZATION REPORT
## STEP 13/15/16 — Strategy Editor + Dataset Builder UI 产品化（Phase 2~8 全量交付）

> 交付日期：2026-09-07
> 前置：Phase 1 现状审计见 `docs/FRONTEND_CURRENT_STATE_AUDIT.md`
> 原则：未修改任何后端 API Contract / 数据模型 / StrategyDocument / Dataset / PIT / Gate / Audit 语义。

---

## 一、总体结论

| 维度 | 结果 |
|---|---|
| 后端 API | **零改动**（未触碰 `server/`、`shared/` 任何契约文件） |
| 数据模型 | 未改动 |
| StrategyDocument Contract | 未改动（前端只做 wire↔ViewModel 转换） |
| Dataset Contract | 未改动（`unknown` 字段仍防御性透传，不补全结构） |
| PIT / Gate / Audit 语义 | 未改动（前端不重算 fingerprint / gate / datasetVersion / chain hash） |
| 类型检查 | `tsc --noEmit` 通过 |
| 前端构建 | `vite build` 通过（chunk size 警告为既有，非本次引入） |
| 测试 | 相关 server 测试 77 通过 + 新增前端 adapter 测试 17 通过 |

---

## 二、按 Phase 的 9 项交付（§22）

### Phase 2 — Component / Adapter 拆分
1. **修改文件**（新增 13 个）：
   - `client/src/lib/status.ts`（统一状态语义与颜色，唯一事实来源）
   - `client/src/components/common/`：StatusBadge、MetricCard、EmptyState、ErrorState、TechnicalDetails、SectionCard、DataTable + barrel `index.ts`
   - `client/src/adapters/`：strategyAdapter、datasetAdapter、buildResultAdapter、runResultAdapter + barrel
2. **修改原因**：消除 3 套并行状态颜色 + 无 Adapter 层 + 无公共组件的技术债（§12/§16/§17）。
3. **UI 改动**：无页面级改动，仅新增可复用地基。
4. **API 变化**：无。
5. **Contract 变化**：无（ViewModel 为前端展示形态，不复制领域 schema）。
6. **测试**：`tsc` 通过；后续 adapter 单测 17 例。
7. **构建**：通过。
8. **剩余问题**：DataTable 为轻封装，未接虚拟滚动（§15 可后补）。
9. **下一 Phase**：Strategy Editor UX。

### Phase 3 — Strategy Editor 双模式
1. **修改文件**：`pages/StrategyEditor.tsx` 重写；新增 `components/strategy/`（StrategyHeader / StrategyBasicInfo / RuleEditor / PositionSizingEditor / StrategyJsonEditor + barrel）。
2. **修改原因**：消除「过度暴露 JSON」，普通用户可直观看懂策略规则（§2-1/2/3，§3）。
3. **UI 改动**：
   - 顶部 Header：名称 / ID / 版本 / 数据集 / 生命周期状态 + [校验][保存][保存新版本][运行]
   - 双模式切换 [可视化编辑]（默认）/ [JSON 高级模式]
   - 可视化：基础信息 + Entry/Exit/Risk 结构化条件表（类型/字段/操作/数值/说明 + 添加/删除）+ 仓位规则
   - JSON 高级：保留透传 + validate + 技术详情（recordVersion/fingerprint）
4. **API 变化**：无（validate/bump/compare/lifecycle 原样使用）。
5. **Contract 变化**：无。**注意**：规则间为隐式 AND（后端 DeclaredRule 无 logic 字段），本期显式标注，未引入 OR 字段（需后端契约演进）。
6. **测试**：`tsc` + `vite build` 通过；adapter 往返单测覆盖。
7. **构建**：通过。
8. **剩余问题**：[保存][保存新版本][运行] 后端无端点 → 禁用态 + tooltip（诚实，不伪造）。
9. **下一 Phase**：Dataset Builder UX。

### Phase 4 — Dataset Builder 产品化
1. **修改文件**：`pages/DatasetBuilder.tsx` 重写；新增 `components/dataset/`（DatasetConfigPanel / SourceValidationTable / BuildPipeline / BuildSummary / BuildDiagnostics / DatasetDetailViews + barrel）。
2. **修改原因**：INCONCLUSIVE 解释不足、Source/Final rows 认知冲突、缺诊断链（§2-5~8，§6~§11）。
3. **UI 改动**：
   - 五段结构：Configuration → Source Validation → Build Pipeline → Build Summary → Diagnostics
   - INCONCLUSIVE 产品化：状态 + 原因（NO_ROWS_BUILT/DB_UNAVAILABLE/DATA_NOT_READY/COVERAGE_GAPS）+ 解释 + 建议 + 技术详情
   - Source Rows 与 Final Rows 严格分区展示
   - Build Pipeline 诊断链（10 节点，真实加载事实，不臆造 Filtered rows）
   - 三级信息：一级摘要卡 + 二级校验/管线 + 三级详情（TechnicalDetails 折叠）
4. **API 变化**：无（仍 `researchDataset.build`）。
5. **Contract 变化**：无（`unknown` 字段仍防御性渲染）。
6. **测试**：`tsc` + `vite build` 通过；buildResultAdapter 单测 8 例覆盖 NO_ROWS_BUILT/Source vs Final/Pipeline/派生状态。
7. **构建**：通过。
8. **剩余问题**：Build Duration 为前端计时（后端不返回）。
9. **下一 Phase**：状态/错误/诊断系统统一。

### Phase 5 — 状态/错误/诊断系统统一
1. **修改文件**：`pages/DataHealth.tsx`（第三处并行状态色收敛到 `styleForStatus`）。
2. **修改原因**：§12 统一状态颜色，消除「每页自行定义」。
3. **UI 改动**：颜色不变（emerald/amber/red 与旧值逐字一致），仅来源统一。
4. **API 变化**：无。 5. **Contract 变化**：无。
6. **测试**：`tsc` + `vite build` 通过。
7. **构建**：通过。
8. **剩余问题**：无。
9. **下一 Phase**：Run Workbench。

### Phase 6 — Run Workbench 结构预留
1. **修改文件**：`components/strategy/RunConfigPanel.tsx`、`RunResultPlaceholder.tsx`；`pages/StrategyEditor.tsx` 增加「运行工作台」Tab。
2. **修改原因**：§4/§5，为后续运行/回测结果预留结构。
3. **UI 改动**：回测配置（时间范围/初始资金/手续费/滑点/最大持仓/运行模式）+ [运行策略]（禁用）+ 结果占位（7 指标卡 + 6 详情 Tab，全部 Empty State）。
4. **API 变化**：无（无 run 端点）。
5. **Contract 变化**：无。
6. **测试**：`tsc` + `vite build` 通过。
7. **构建**：通过。
8. **剩余问题**：`runResultAdapter` 已定义 `parseRunResult`，接后端后即可填充。
9. **下一 Phase**：响应式/视觉打磨。

### Phase 7 — 响应式/可用性/视觉打磨
1. **修改文件**：prettier 格式化全部新增文件；移除 Header 死代码。
2. **修改原因**：统一风格、消除死代码。
3. **UI 改动**：无行为变化。
4-7. API/Contract 无变化；测试/构建通过。
8. **剩余问题**：chunk size 警告（既有，可后做 code-split）。
9. **下一 Phase**：全量回归。

### Phase 8 — 全量回归
- `tsc --noEmit`：通过（exit 0）。
- `vite build`：通过（15.9s，2871→2880 模块）。
- 测试：`server/researchContracts + strategySchema + researchDataset` **77 通过**；`client/src/adapters` **17 通过**（新增）。
- 逐项确认：旧功能（validate/bump/compare/lifecycle/describe/transition/build）全部保留；API 未破坏；StrategyDocument/Dataset/PIT/Audit 语义未变。

---

## 三、关键设计决策（供后续评审）

1. **AND/OR 未引入**：后端 `DeclaredRule` 无逻辑字段，为守 Contract 铁律，可视化编辑标注「规则间 AND」，不造 OR 字段。
2. **Position Sizing 无 Custom**：仅映射契约三值（equal-weight / fixed-fraction / rank-weighted）。
3. **保存/运行按钮禁用**：后端无对应端点，诚实禁用 + tooltip，不伪造「已保存/已运行」。
4. **Pipeline 不臆造 Filtered rows**：只展示后端真实返回的「加载 rows / 覆盖日期 / Final rows」。
5. **无损往返**：StrategyDocument 经 `extra` 透传未知字段；`ParameterViewModel.hasDefaultValue` 区分「无默认值」与「defaultValue:null」。
6. **ViewModel 非 schema 复制**：前端 ViewModel 是展示形态，权威 schema 仍在 `server/research/strategySchema/types.ts`。

## 四、文件清单

**新增（27）**：`lib/status.ts`；`components/common/`×8；`adapters/`×6；`components/strategy/`×9；`components/dataset/`×7；`adapters/*.test.ts`×2。
**修改（4）**：`pages/StrategyEditor.tsx`、`pages/DatasetBuilder.tsx`、`pages/DataHealth.tsx`、`vitest.config.ts`（include 增加 client 测试）。

## 五、剩余问题与后续建议

1. **Run/Backtest 端点缺失**：Phase 6 结构已就绪，接后端 `research.run` 端点后即可填充 `parseRunResult`。
2. **AND/OR 契约演进**：若需 OR 组合规则，需后端先扩展 DeclaredRule（加 logic 字段 + validate 语义），前端再做，本期守约不做。
3. **code-split**：chunk > 500kB 为既有问题，建议后续 `manualChunks` 或路由级 `React.lazy`。
4. **前端 UI 组件测试**：已覆盖 adapter（纯逻辑）；组件级渲染测试（jsdom + testing-library）可后续补。
5. **虚拟滚动**：DataTable 已 sticky header，超大数据量虚拟滚动可后补。
