# RESEARCH-006.4.1-B — Candidate → Strategy 前端完整闭环 实施报告

> 状态：**COMPLETE**
> 架构基准：`docs/research/RESEARCH-006.0-architecture.md`（唯一权威）
> 前序：`RESEARCH-006.1-implementation.md`（DATA_READY）/ `006.2`（CODE_READY）/ `006.3`（COMPLETE）/ `006.4.1-A`（Phase A = DONE）
> 本轮范围：Phase B（Promote UI / Promote Dialog / Promote Result / Strategy Provenance / Strategy Version 导航）+ 领域码跨 tRPC 边界修复 + 真实 TiDB 全链验收
> 证据日志（已归档到仓库根，`_*` 前缀非产品代码）：`docs/evidence/_r00641b_verify_pass.log`（真实库全链 PASS 123/0）、`docs/evidence/_r00641b_verify_run2_econnreset.log`（第 2 轮 96/97，含根因 `read ECONNRESET`）、`docs/evidence/_r00641b_fulltest.log`（全量）、`docs/evidence/_r00641b_focused_tests.log`（聚焦）、`docs/evidence/_r00641b_tsc.log`（类型检查，空=零输出）、`docs/evidence/_r00641b_vitebuild.log`（构建）

---

## 1. 架构基准与真实代码审计（§2 / §3 / §6）

**方法**：动代码之前先读**实际实现**（不采信任何报告转述），逐文件核对 006.3 的真实类型与语义。

| 审计对象 | 读到的事实 | 对前端的影响 |
| --- | --- | --- |
| `server/research/strategyCandidate/service.ts#promote` | 入参形状**只有** `{ candidateId, overrides?: { datasetBinding?, datasetDivergenceReason? } }`；返回 **14 字段** | 前端入参不得出现任何 Strategy 定义字段 |
| `server/research/strategyCandidate/router.ts` | `promote` 是 `adminProcedure`；错误走 `toTrpcError` | 前端必须按 `TRPCClientError` 处理 |
| `server/researchCore/candidates.ts:165` `CANDIDATE_TRANSITIONS` | `DRAFT:["REVIEW","ARCHIVED"]` / `REVIEW:["ACCEPTED","REJECTED","DRAFT","ARCHIVED"]` / `ACCEPTED:["CONVERTED","ARCHIVED"]` / `REJECTED:["ARCHIVED"]` / `CONVERTED:["ARCHIVED"]` / `ARCHIVED:[]` | **`DRAFT → REJECTED` 非法**（验收脚本首轮即踩中，见 §13） |
| `createExperimentForm.ts#isUsableVersionStatus` | 全站唯一 READY 口径 = `RESEARCH_USABLE_VERSION_STATUSES = ["READY"]` | Dataset 选择器复用同一函数，禁自建第二套判据 |
| `server/research/strategyCandidate/candidateTypes.ts` | `CANDIDATE_SKETCH_EXTENSION_KEYS` 闭集 7 键；11 个 `STRATEGY_CANDIDATE_*` 错误码 | 前端 hint 表必须逐条对得上真实映射 |
| Dataset Registry 版本坐标 | `datasetVersionId = dataset_version.id`，`datasetVersion`（`v1`/`v2`）**仅 label** | 选择器展示 `#ID / label / datasetCode / READY`，提交只提交 `datasetVersionId` |

**审计结论（与前序报告一致，本轮以代码复核确认）**：
- 006.3 的转正链路是**唯一**入口，本轮**不新增**任何转换器；
- 前端**唯一**可调用的转正 API = `trpc.research.strategyCandidate.promote`；
- 需要新增的 API **只有 1 个只读端点** `getVersionProvenance`（见 §11）。

---

## 2. 交付清单

**新增 5 文件 / 2,453 行**

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `client/src/components/research/promoteForm.ts` | 261 | **纯函数层**：`PROMOTABLE_STATUS`/`isPromotableStatus`/`NON_PROMOTABLE_STATUSES`/`createDefaultPromoteForm`/`validatePromoteForm`/`buildPromoteInput`/`buildDatasetVersionOptions`/`findDatasetVersionLabel`/`datasetOptionLabel` |
| `client/src/components/research/promoteForm.test.ts` | 393 | 34 例（含键白名单断言 + 运行时 import 后端真常量对表） |
| `client/src/components/research/PromoteCandidateDialog.tsx` | 504 | Promote 弹窗 + 结果态 + 幂等态 + 失败诊断 + 导航 |
| `client/src/components/research/StrategyResearchProvenancePanel.tsx` | 138 | Strategy 侧 Research 溯源**只读区** |
| `scripts/verifyResearch00641Promote.mts` | 1,157 | 真实 TiDB 全链验收（13 节，自建自清） |

**修改 8 文件**

| 文件 | 变化 | 内容 |
| --- | --- | --- |
| `server/research/strategyCandidate/router.ts` | +224（307 → 375） | `withDomainCode` 全面接入 `toTrpcError`；新增只读 `getVersionProvenance` |
| `server/research/strategyCandidate/service.ts` | +725（995 → 1,151） | 新增 `getVersionProvenance`（只读、可缺、不阻断） |
| `server/research/strategyCandidate/router.test.ts` | +194 | 端点清单断言补第 6 个端点；`suspicious` 正则补 `convert` |
| `client/src/adapters/strategyCandidateAdapter.ts` | 404 → 829 | `PromoteResultLike`(14 字段)/`promoteResultToVm`/`strategyVersionPath`/`readRpcDomainCode`/`PROMOTE_DOMAIN_HINTS`(15 键)/`parsePromoteWritebackDetails`/`promoteFailureVm`/`promotionProvenanceToVm`/`PROVENANCE_DISCLAIMER` |
| `client/src/adapters/strategyCandidateAdapter.test.ts` | 50 例 | 14 个失败码 **逐条对照 `toTrpcError` 的 tRPC code** |
| `client/src/pages/research/StrategyCandidateDetail.tsx` | 289 → 312 | ACCEPTED 蓝条 → 「转正为 Strategy」`SectionCard` + `PromoteCandidateDialog` |
| `client/src/pages/StrategyEditor.tsx` | +38（1,277 → 1,315） | 消费 `?strategyId=&version=`（`useSearch()`）+ 挂载溯源面板 |
| `client/src/components/research/index.ts` | +12 | barrel 导出新增 3 项 |

> 说明：`strategyCandidateAdapter.ts` / `StrategyCandidateDetail.tsx` 在 Phase A 新建且**尚未纳入 git 跟踪**，故 `git diff --stat` 不含它们；行数取当前真实值。

---

## 3. 领域码跨 tRPC 边界（§7）

**问题（Phase A 已登记的技术债）**：`toTrpcError` 只透传 `message`、不带 `cause` ⇒ 14 个领域码会**塌缩成 5 个 tRPC code**，前端无法区分错误原因。

**修法（复用仓库既有约定，不改 tRPC code）**：

```ts
// server/research/strategyCandidate/router.ts:65
function withDomainCode(code: string, message: string): string {
  return `[${code}] ${message}`;
}
```

- 全部 `TRPCError` 构造点（`toTrpcError` 内 5 个分支 + 各 procedure 的 catch）**统一**用 `withDomainCode` 包 message；
- **不改变**任何 tRPC 语义 code（`BAD_REQUEST` / `NOT_FOUND` / `CONFLICT` / `PRECONDITION_FAILED` 等原样保留）；
- 消费端**唯一**抠码逻辑在 `strategyCandidateAdapter.ts#readRpcDomainCode`（`/\[([A-Z_]{3,})\]/u`），与 `rpcErrorToDiagnostic` 的既有约定同源；
- `ResearchCandidateError` 无 `code` 字段 ⇒ **刻意不加前缀**（宁可不加，也不臆造码）。

**真实链路实测（§12 汇总，7 次业务失败全部命中后端真实存在的码）**：

| 领域码 | tRPC code | 触发场景 |
| --- | --- | --- |
| `STRATEGY_CANDIDATE_NOT_ACCEPTED` | `PRECONDITION_FAILED` | 候选不是 ACCEPTED（DRAFT / REVIEW / REJECTED / ARCHIVED） |
| `STRATEGY_CANDIDATE_PROMOTE_SKETCH_INCOMPLETE` | `PRECONDITION_FAILED` | 草图缺少必填扩展键 |
| `STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID` | `BAD_REQUEST` | 草图含未定义扩展键 |
| `STRATEGY_CANDIDATE_DATASET_VERSION_NOT_FOUND` | `NOT_FOUND` | 执行 Dataset 不存在 |
| `STRATEGY_CANDIDATE_DATASET_DIVERGENCE_REASON_REQUIRED` | `BAD_REQUEST` | 分歧但 reason 为空 / 纯空白 |
| `STRATEGY_CANDIDATE_INVALID_INPUT` | `BAD_REQUEST` | 一致时却填了 reason |
| `STRATEGY_CANDIDATE_TRANSITION_INVALID` | `CONFLICT` | `DRAFT → REJECTED`（非法迁移） |

⇒ **实测可区分领域码 = 6 个（≥6 达标）**，且**每个码给出一句不同的用户可读诊断**（6 种诊断 / 6 个码），不存在「一句话糊弄所有失败」。

---

## 4. Promote 入口与 Dialog（§8 / §9）

- **入口位置**：`StrategyCandidateDetail.tsx` 的「转正为 Strategy」`SectionCard`（`icon={Radio}`）。
- **显隐判据**：`isPromotableStatus(status)` ⇒ **仅** `status === "ACCEPTED"` 时渲染。`CONVERTED` **不显示**（`NON_PROMOTABLE_STATUSES` 覆盖另外 5 态），理由写在纯函数里：`CONVERTED` 的语义是「已经转正」，再给一个转正入口只会诱导用户去点一个必然幂等返回的按钮。
- **Dialog 说明**（原文，`PromoteCandidateDialog.tsx:216`）：
  > Research 来源数据集用于形成研究结论；Strategy 执行数据集在转正时确定。
- Dialog 打开时**不预填**执行数据集（除非用户主动切换模式），避免「看起来已经选好」的错觉；结果区另有一句把「来源 / 执行」两个坐标并列展示。

---

## 5. Execution Dataset 选择（§10 / §11）

**§10 默认继承**：`createDefaultPromoteForm()` ⇒ `mode: "INHERIT"`、`datasetVersionId: null`、`divergenceReason: ""`；UI 显示「继承研究来源数据集」（含来源 `#ID / label`）。

**§11 选择器约束**：
- 数据源 = 既有 `datasetRegistry.listDefinitions` / `getDefinition`（**100% 复用，零新 API**）；
- 只列 `isUsableVersionStatus(version.status)`（= `READY`）的版本；非 READY 的**不渲染**（而不是渲染成灰）；
- 每一项展示 `#ID / label / datasetCode / READY`；
- **提交只提交 `datasetVersionId`**：`buildPromoteInput` 产出的 `overrides.datasetBinding` 形状是 `{ datasetVersionId: number }`，`datasetId` / `label` / `datasetVersion` **结构性不可达**（测试用键白名单断言锁死）。

---

## 6. divergence 双重校验（§12）与 §13 语义判定

### 6.1 规则（前端 UX 层，`validatePromoteForm`）

| 情形 | 前端行为 |
| --- | --- |
| 继承 且 来源非空 | `executionDatasetVersionId = sourceId`，`diverges = false`，**不要求** reason |
| 继承 但 来源为 null | 报错「必须显式选择一个执行 Dataset 版本」（后端无法凭空继承一个不存在的坐标） |
| 覆盖 且 执行 === 来源 | `diverges = false`；若填了 reason ⇒ 报错（后端要求此时必须 NULL） |
| 覆盖 且 执行 ≠ 来源 | `diverges = true`；reason **trim 后**必须非空 |
| `null` / `""` / `"   "` | 一律视为「未填写」⇒ 无效 |

### 6.2 后端仍是最终权威（§15）

前端校验只决定按钮可用性与提示文案；**所有失败路径都在真实库上被验证过**（§13）：分歧缺 reason / 纯空白 reason / 一致却填 reason，三者**均被后端独立拒绝**，且**零新增**（策略侧 8 表 + 候选表行数不变）。

### 6.3 §13 判定：`sourceDatasetDivergenceReason` 的真实语义（**有代码证据**）

- `commitCandidateConversion` **确会**回写 `candidate.sourceDatasetDivergenceReason`；
- 但它是**转正时的执行覆盖记录**（一致时**必须为 NULL**），而**不是**研究来源快照的一部分 —— 与之相对，`sourceDatasetVersionId` **从不被覆盖**（真实验收证实：Divergence 场景下候选的 `sourceDatasetVersionId` 仍是研究来源 `390002`，执行坐标 `390001` 只落在版本行与溯源行）；
- ⇒ **判定 = 本就属于 Promotion Execution Override**，因此**按 §13 指示不擅自重构**，只在本报告说明实际语义。前端据此把它读作「本次转正覆盖记录」，显示在结果态的「分歧原因」一行。

---

## 7. 前端唯一入口与 UX（§14 / §15 / §16）

- **唯一入口**：全前端只有 `trpc.research.strategyCandidate.promote`（`PromoteCandidateDialog.tsx:84`）。`strategyCandidateUiContract.test.ts` 用正则只认真实调用写法，断言「转正 API 只有 1 个」「候选 UI 不出现 `strategyDefinition` / `definition` / `strategyDocumentJson`」「候选 UI 不直写 `strategies` / `strategy_versions`」「不出现 `strategy_drafts` / `researchDataset`」。
- **Loading（§16）**：`promote.isPending` 期间按钮文案 = 「正在转正...」+ 转圈图标；`disabled`，且**Dialog 不可关闭**（`onOpenChange` 在 pending 时直接忽略）⇒ 结构性防重复提交。
- 失败态与成功态互斥渲染，不会同时出现。

---

## 8. 成功 / 幂等展示与重读（§17 / §18 / §19）

- **成功（§17）**：结果区展示 `Strategy ID` / `Strategy Version ID` / `Version` / `Execution Dataset`，附导航「查看 Strategy Version」→ `/strategy-editor?strategyId=<id>&version=<semver>`（落点是**既有**策略页 + 坐标参数，**不新增第二套页面**）。
- **幂等（§18）**：`idempotent === true` 时标题与正文**明确**显示
  > 该候选已经转正，本次未创建新的 Strategy Version
  并**明说**没有产生新的 Strategy / Version / 溯源行；**绝不**显示「创建成功」。
- **重读（§19）**：成功后 `invalidate` `research.strategyCandidate.get` + `researchEngine.listCandidates`，状态**从服务端重读**。前端**不存在**任何 `candidate.status = "CONVERTED"` 的本地赋值（契约测试断言无此类写形态）。

---

## 9. 导航与溯源只读展示（§20 / §21 / §22）

- **不新建页面**：`StrategyEditor` 消费 `useSearch()` 里的 `strategyId` / `version`（`urlLoadHandled` 保证只消费一次），加载目标版本后把 `loadedTarget` 交给溯源面板。
- **只读端点**：新增 `research.strategyCandidate.getVersionProvenance`（`publicProcedure`，`.query(`），实现纪律：只按 Strategy 侧坐标查、**不要求** Research 任何行存在、上游存活探测**全部容错**（失败只记 `missingUpstreams`，**绝不让读取失败**）、执行绑定 label 走 Dataset Registry 只读端口取不到即 `null`（不猜）。
- **Provenance 面板**：`SectionCard title="Research 溯源（只读）"`，展示 8 行快照（来源候选 / 结论 / 实验 / Run / 来源 Dataset 坐标 + label / 执行 Dataset 坐标 / 分歧原因 / 指纹），缺失上游逐条标「（来源已不存在）」并给 `missingNote`，底部 `PROVENANCE_DISCLAIMER`。
- **§22 只读**：面板内**没有**任何编辑 / 删除 / 覆盖 / 重新绑定入口；测试断言溯源端点源码里是 `.query(` 且无 `update` / `delete` / `set` / `unlink` 写形态。

---

## 10. Strategy 独立性（§23 / §24）

真实验收（§13-§10）：转正成功后**删掉自建的候选行**，再验证 —— Strategy 主体、版本行、Bundle、溯源行**全部仍可加载**；溯源面板如实显示「来源已不存在」但**不阻断**策略打开；**零反向依赖**（Strategy 侧不得 import / 认识 `researchCore` / `strategyCandidate`，由 `importBoundary.test.ts` 的允许清单式断言守护）。

---

## 11. 分层与新增 API 统计（§25 / §26）

- **分层**：`UI (PromoteCandidateDialog) → adapter / pure function (promoteForm.ts + strategyCandidateAdapter.ts) → tRPC → domain service`。JSX 里**不做**字段推导与坐标换算。
- **新增 API = 1 个只读端点**（`getVersionProvenance`）；Dataset 查询**目标新增 0 个**，实测**确实复用** `datasetRegistry` 既有端点，未新增任何 Dataset 接口。
- **列表复用** `researchEngine.listCandidates`，**没有**为「全局候选列表」发明第二套接口。

---

## 12. 测试（§27）

| 层 | 文件 | 例数 | 覆盖 |
| --- | --- | --- | --- |
| 纯函数 27.1 | `promoteForm.test.ts` | 34 | `ACCEPTED → true`；其余**六态**（DRAFT/REVIEW/REJECTED/CONVERTED/ARCHIVED + 空值）→ false |
| Dataset 27.2 | `promoteForm.test.ts` | （含上） | inherit / same → 不要求 reason；different → 必填；`null` / `""` / `"   "` → invalid |
| 入参 27.3 | `promoteForm.test.ts` | （含上） | 键白名单断言：入参**只有** `candidateId`（+可选 `overrides`），**绝不含**定义字段 |
| 错误映射 27.4 | `strategyCandidateAdapter.test.ts` | 50 | 14 个失败码**逐条**对照 `toTrpcError` 的 tRPC code；断言各码诊断**互不相同** |
| UI Contract 27.5 | `strategyCandidateUiContract.test.ts` | 9 | 只有 1 个 `promote` 入口；无第二转换入口；无禁止词汇 |

**聚焦批次（实跑）**：`client/src/adapters/strategyCandidateAdapter.test.ts` + `client/src/components/research/{promoteForm,strategyCandidateUiContract}.test.ts` + `server/research/strategyCandidate/` ⇒ **9 文件 / 237 例全过**，其中：

- 前端 **3 文件 / 93 例**（adapter 50 + promoteForm 34 + uiContract 9）；
- 桥服务端 **6 文件 / 144 例**（importBoundary 10 + provenance 4 + service 49 + definitionBuild 35 + service.promote 30 + router 16）。

---

## 13. 真实 TiDB 全链验收（§28 ~ §36）

脚本 `scripts/verifyResearch00641Promote.mts`（1,157 行，13 节），走 **`appRouter.createCaller()`**（**禁 Service 直调**），与 `PromoteCandidateDialog` **完全相同的 procedure 与入参形状**，最后用**裸 SQL 独立复核**，并把**真实 tRPC 错误**送进**前端映射函数**验证领域码可区分。

### 13.1 验收环境与只读选取

- 选取 `Conclusion #480001`（DRAFT）· `Experiment #240002` · 研究来源 `Dataset 390002`（v2 / READY）；可绑定的 READY 版本 = `390002(v2)` / `390001(v1)`（**只有这两个**，Divergence 场景因此可真实构造）。
- **只读选取、不修改任何既有行**；找不到合资格结论即 FAIL 退出，**绝不伪造坐标**。

### 13.2 结果

```
验收结果：PASS（123 项，失败 0 项）        EXIT=0
{"tests":123,"failed":0,"pass":true,
 "observedDomainCodes":[6 个]}
```

### 13.3 §28 首次 Promote（继承研究来源 Dataset，不提交 datasetBinding）

14 个返回字段**逐一核对** + 裸 SQL 独立复核：

- `candidateId` 240034 / `strategyId = cand-240034`（**后端派生，前端不拼**）/ `strategyVersionId = 330008` / `strategyVersion = 1.0.0` / `origin = DIRECT` / `candidateStatus = CONVERTED` / `provenanceId = 120008`；
- `datasetDivergence = false` ⇒ `sourceDatasetDivergenceReason = null`（**一致时必须 NULL**）；`sourceDatasetVersionId = 390002` = `executionDatasetVersionId`；
- 裸 SQL：`strategies.currentVersionId` 指向版本行；`strategy_versions.datasetVersionId = 390002`（执行坐标）；版本初始状态 `Draft`；`strategyDocumentJson` 非空（canonical SoT 已落库）；`definition.datasets[PRIMARY]` 绑定 `{datasetId: first_limit_pullback, datasetVersion: v2, datasetVersionId: 390002}`；
- 裸 SQL：溯源行 `origin = DIRECT`、`sourceCandidateId = 240034`（**快照值，非 FK**）、`sourceConclusionId` / `sourceExperimentId` 登记完整、`sourceDatasetVersionId = 390002`（**不是**执行坐标）；
- 前端映射：`promoteResultToVm` 标题 = 「转正成功」；文案含 Strategy 坐标与执行 Dataset；「查看 Strategy Version」→ `/strategy-editor?strategyId=cand-240034&version=1.0.0`；
- §19 服务端重读：候选已是 `CONVERTED` 且 `strategyDefinitionId` 非空（**前端没有也不能自己伪造**）。

### 13.4 §29 第二次 Promote（幂等闸门）

`idempotent = true`；复用**同一** `strategyVersionId`（330008）与**同一** `provenanceId`；复用**同一** `fingerprint`；**候选表 + 策略侧 8 表行数不增**；前端文案 = 「该候选已经转正，本次未创建新的 Strategy Version」并**明说**没有产生新的 Strategy / Version / 溯源行。

### 13.5 §29 Divergence（执行 Dataset ≠ 研究来源）

`datasetDivergence = true`；执行坐标 = 显式指定的 `390001`；**研究来源坐标仍是 390002**（执行绑定**不覆盖**来源快照）；分歧原因原样记录；裸 SQL 复核：候选 `sourceDatasetVersionId` **未被覆盖**、候选分歧原因已落库、版本行 `datasetVersionId` = 执行坐标、溯源 `sourceDatasetVersionId` = 研究来源坐标。

### 13.6 失败路径全部「零新增」

| 场景 | 领域码 | 零新增 |
| --- | --- | --- |
| 分歧缺 reason | `..._DATASET_DIVERGENCE_REASON_REQUIRED` | ✓ |
| 分歧 + 纯空白 reason | `..._DATASET_DIVERGENCE_REASON_REQUIRED` | ✓ |
| 一致时却填 reason | `..._INVALID_INPUT` | ✓ |
| DRAFT / REVIEW / REJECTED / ARCHIVED | `..._NOT_ACCEPTED`（4 次） | ✓ |
| 草图缺失 | `..._PROMOTE_SKETCH_INCOMPLETE` | ✓ |
| 草图含未定义扩展键 | `..._PROMOTE_SKETCH_INVALID` | ✓ |
| 执行 Dataset 不存在 | `..._DATASET_VERSION_NOT_FOUND` | ✓ |

另有**正向**断言：`DRAFT → REJECTED` **被状态机拒绝**（`CONFLICT`；`REJECTED` 只能从 `REVIEW` 到达）—— 这条断言来自首轮验收脚本自己的**误判纠正**（脚本原写成 `DRAFT → REJECTED`，是把状态机记错了；真实状态机见 §1 表）。「零新增」的判据 = 每次失败前后 **策略侧 8 表 + 候选表**逐表计数不变。

### 13.7 §20 / §22 只读溯源端点

`getVersionProvenance` 与 `promote` 返回值**一致**（`strategyVersionId` / `provenanceId` / `origin` / 4 个来源字段 / 执行坐标 / 分歧原因 / `missingUpstreams`）；前端 VM 8 行完整、来源与执行两个坐标**并列保留**；空 `strategyId` 在传输层被拒（`BAD_REQUEST`）；源码里是 `.query(` 且**无任何写形态**。

### 13.8 §23 / §34 Strategy 独立性（真实删除上游）

上游健在时 `loadVersion` / `loadBundle` / `getVersionBundle` 全成功 ⇒ **删掉自建候选行**（模拟研究上游消失；既有结论 / 实验**未受影响**）⇒ 三个读取**仍然全成功**；溯源仍可读，`missingUpstreams = ["SOURCE_CANDIDATE"]` 如实列出，前端提示既说「来源候选已不存在（研究上游记录可能已被删除）」也说「**这不影响该策略的读取与执行**」；来源快照值本身仍在（快照不因上游删除而消失）；溯源行仍在（**零 FK ⇒ 不级联删除**）；`research.strategy.list` 仍包含该策略。**结论：Strategy 脱离 Research 后完全独立可用，且无反向依赖。**

### 13.9 §35 / §36 自建自清与逐表守恒

- **自建自清**：精确删除自建策略 `cand-240034` / `cand-240035`（含版本 / 5 张投影 / 溯源）与 12 个自建候选（`240034~240045`）；**无残留**。
- **逐表守恒（13 张严格表）**：`research_strategy_candidate` / `strategies` / `strategy_versions` / `strategy_version_datasets` / `strategy_parameters` / `strategy_entry_rules` / `strategy_exit_rules` / `strategy_execution_rules` / `strategy_research_provenance` **全 0 → 0**；`research_experiment` 2→2、`research_conclusion` 10→10、`dataset_version` 2→2、`dataset_definition` 1→1。
- **3 张 observed-only 表**（并行研究会话会写、本脚本从不写，故只记录差值不作失败判据）：`research_run` 11→11、`research_analysis` 190→190、`research_result` 3427→3427，**全部 Δ0**。

### 13.10 🔴 如实登记：§9 的跨境瞬时读错误（**不是**产品缺陷）

本 STEP 共跑 **3 次**完整验收，**3 次都在 §9「第一次用 Drizzle 连接池读 `loadProjections`（5 条并发查询）」处命中传输层瞬时错误**：

| 轮次 | 结果 | 失败点 | 根因（实证） |
| --- | --- | --- | --- |
| #1 | 96/97（`exit 1`） | `strategy_exit_rules` 的 SELECT | `String(err)` 丢了根因 ⇒ **无法定位**（由此发现脚本缺陷） |
| #2 | 96/97（`exit 1`） | 同上 | 加了 cause 链诊断后读到 **`read ECONNRESET`** |
| #3 | **123/123（`exit 0`）** | `strategy_version_datasets` 的 SELECT | 重试谓词命中传输层错误 ⇒ 重试 1 次后**成功** |

**为什么能确定是传输层而非 SQL / 逻辑缺陷**：

1. **同一批查询独立复现稳定成功** —— 用完全相同的 Drizzle 代码路径单独跑这 5 条查询，**5/5 OK**；
2. **`information_schema` 列签名逐列与 select 列表一致**（15 列，含 `ordinal` / `conditionJson`），表存在、行数可查；
3. **两次命中的是不同语句**（#2 = `strategy_exit_rules`，#3 = `strategy_version_datasets`）⇒ 不绑定任何特定表 / 列；
4. 第 #3 轮**重试即成功** ⇒ 不可能是不存在的列或不合法 SQL；
5. 位置固定为「**长时间只用裸 mysql2 连接、Drizzle 池空闲之后，第一次用池读**」⇒ 与「对端回收空闲连接、复用时 `ECONNRESET`」的机制一致；这在**本仓库是已知类别**（`server/researchEngine/readRetry.ts` 即为此而建）。

**处置（`scripts/**` 内，未改任何产品代码）**：给**只读**溯源端点调用加了**明示的**传输层重试（≤3 次、每次打印 `⚠️` 与「第 N 次才成功」；**只认** `ECONNRESET` / `ETIMEDOUT` / `EPIPE` / `socket hang up` / `ECONNREFUSED`，**领域错误与断言错误立刻冒泡**）；**写操作（`promote` / `transition` / `update` / `createFromConclusion`）一律不重试** —— 重试写会破坏幂等证据。这**不是**「把断言改绿」：断言一条未动，且每次重试都留在日志里。

**⚠️ 由此登记的真实技术债（本轮刻意不修）**：生产读路径 `server/research/strategyPersistence/db.ts#loadProjections`（以及同类只读投影读）**没有**重试 —— 用户打开一个带溯源的 Strategy 页时，同样的瞬时错误会让溯源区显示读取失败。修它需要改 `server/**`（会热重启并**杀死在途研究 Run**，见项目铁律）⇒ **不在本 STEP 内动**，已登记为 006.5+ 的候选修复项（最小改法 = 把既有 `withReadRetry` 覆盖到该读路径，零口径变更）。

---

## 14. 全量测试、边界检查与用户闭环（§38 ~ §43）

### 14.1 §38 / §39 测试与构建（全部实跑）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc --noEmit` | **exit 0**（零输出） |
| 生产构建 | `npx vite build` | **RC=0**（vite 7.1.9 / 3014 modules / 17.55 s） |
| 聚焦测试 | 前端 3 + 桥 6 文件 | **9 文件 / 237 例全过**（前端 93 / 桥 144） |
| 全量测试 | `npx vitest run` | **228 文件 / 3742 例：15 失败 / 7 文件** |
| 真实 TiDB | `node --import tsx scripts/verifyResearch00641Promote.mts` | **PASS 123 / 失败 0 / `exit 0`** |

**全量测试的 15 个失败 = 既有环境依赖基线，逐项一致 ⇒ 新增失败 0**：`dataHealth`(1，gate 快照期望，属数据域治理待裁)、`image.uploadAndRecognize`(1)、`limitUp`(1)、`limitUp.watch`(4)、`marketData`(4)（以上为真实 DB 直连依赖）、`tushare.secret`(1，缺 token)、`tushareTradingCalendar`(3，外部网络超时)。文件总数 227 → 228（+1 = 本轮新增的 `promoteForm.test.ts`）。

### 14.2 §40 最终代码边界检查（全绿）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Dataset Registry / `drizzle/` 无无关修改 | `git status --porcelain -- server/datasetRegistry drizzle` | **空（零改动）** |
| `StrategyDefinition` schema 未改 | `git status --porcelain -- server/research/strategySchema` | **空（零改动）** |
| 无 `strategy_drafts` | 全库 grep | 仅出现在**契约测试的禁止词表**与 `0036` 迁移注释里，**不是表** |
| 无第二转正入口 | `grep "promote:"` / `createStrategyVersion(` | `promote` 生产定义点**仅** `router.ts:307`（adminProcedure）；`createStrategyVersion` 生产调用点**仅** `service.ts:948` → `strategyPromotionPort`；前端调用 `promote` **仅** adapter + `PromoteCandidateDialog` |
| 无 `rd-*` 当坐标 | grep 本会话改动文件 | 仅出现在注释（「label 不是坐标」）与 **Strategy 字段引用文法** `prefix.rd-1.close` 中，**未参与任何绑定判定** |
| 未用 `researchDataset` | grep 候选 UI | **空（零使用）** |


### 14.3 未做（按 §43 停止）

**本轮未开始，且不是本轮的缺陷**：Backtest / Parameter Search / Evaluation / Robustness / OOS / WFO / Simulated Trading / Production Execution / `cloneVersion` / `origin = INHERITED`。

**明确保持不存在**（验收脚本与契约测试双重断言）：`strategy_drafts` 表、第二个转正入口、前端直写 `strategies` / `strategy_versions`、前端构造完整 `StrategyDefinition`。

### 14.4 下一阶段

**由项目路线统一决定**（§43）。本报告不含任何下一阶段的启动动作。
