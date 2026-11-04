/**
 * 「策略定义」页信息架构的**结构锁**（源码级契约，与 `pageFlowContracts.test.ts` 同风格）。
 *
 * 锁的是**重排后必须保持的三件事**（都是实测发现过的问题）：
 *   1. 「模式族配置」不得再**无条件置顶**：新建时它只是「起点」的一个选项，默认不渲染；
 *      既有版本把它收进折叠区 —— 否则又会回到"新建页一进来就预填一个用户没选的模式族"；
 *   2. 「定义完成度」概览必须挂在策略定义 Tab 内，且状态**只来自** `definitionSegmentStatuses`
 *      （不得另立必填表 ⇒ 否则"概览说齐了、段里还红着"）；
 *   3. 「跳段」的 DOM 前缀与事件名**只有一个来源**（`definitionDraft.ts`），
 *      不得在组件里各写一份字符串（否则点概览跳不到那一段）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFINITION_BLOCKS } from "@/components/strategy/DefinitionProgressOverview";
import {
  DEFINITION_SEGMENT_KEYS,
  definitionToDrafts,
  validateDefinitionDrafts,
  type DefinitionDrafts,
} from "@/components/strategy/definitionDraft";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const CLIENT = path.join(ROOT, "client", "src");
const read = (rel: string): string => readFileSync(path.join(CLIENT, rel), "utf8");

function productionSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...productionSourceFiles(absolute));
    else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) out.push(absolute);
  }
  return out;
}

const DETAIL = "pages/StrategyDetail.tsx";
const OVERVIEW = "components/strategy/DefinitionProgressOverview.tsx";
const FIELDS = "components/strategy/DefinitionFields.tsx";
const DRAFT = "components/strategy/definitionDraft.ts";
const AUTHORING_GROUP_EDITOR = "components/strategy/AuthoringSlotGroupEditor.tsx";
const EXIT_EDITOR = "components/strategy/ExitPolicySlotEditor.tsx";
const ENTRY_EDITOR = "components/strategy/EntryConditionSlotEditor.tsx";

describe("策略定义页 IA 结构锁", () => {
  it("1) 新建时提供「起点」二选一（空白 canonical / 从模式族生成）", () => {
    const src = read(DETAIL);
    expect(src).toContain("data-strategy-origin");
    expect(src).toContain('data-origin-option="BLANK"');
    expect(src).toContain('data-origin-option="FAMILY"');
    // 默认起点 = 空白 canonical（不是模式族）
    expect(src).toMatch(/useState<"BLANK" \| "FAMILY">\("BLANK"\)/);
  });

  it("2) 模式族面板不再无条件渲染：只出现在起点分支与折叠区里", () => {
    const src = read(DETAIL);
    const occurrences = src.split("<StrategyFamilyPanel").length - 1;
    expect(occurrences).toBe(2); // ① 起点=FAMILY 时 ② 既有版本的折叠区
    const originIdx = src.indexOf("data-strategy-origin");
    const firstFamilyIdx = src.indexOf("<StrategyFamilyPanel");
    expect(originIdx).toBeGreaterThan(-1);
    expect(firstFamilyIdx).toBeGreaterThan(originIdx);
    // 既有版本走折叠区
    expect(src).toContain("data-strategy-family-collapsed");
  });

  it("3) 完成度概览挂在策略定义 Tab 内，且直接吃 syncedDrafts", () => {
    const src = read(DETAIL);
    expect(src).toContain("<DefinitionProgressOverview drafts={syncedDrafts} presetSegments={presetSegments} />");
    const overviewIdx = src.indexOf("<DefinitionProgressOverview");
    const fieldsIdx = src.indexOf("<DefinitionFields");
    expect(fieldsIdx).toBeGreaterThan(overviewIdx); // 概览在明细之前
  });

  it("4) 概览的状态只来自 definitionSegmentStatuses（不另立必填表）", () => {
    const src = read(OVERVIEW);
    expect(src).toContain("definitionSegmentStatuses");
    expect(src).toContain("DEFINITION_SEGMENTS");
    // 不得自己维护一张"必填字段"表
    expect(src).not.toMatch(/REQUIRED_[A-Z_]*\s*[:=]/);
    expect(src).not.toMatch(/const\s+REQUIRED/);
    // 只读：不得改动草稿
    expect(src).not.toContain("onChange");
  });

  it("5) 空段不得显示成「齐」：必需段=待填 / 可选段=可选", () => {
    const src = read(OVERVIEW);
    expect(src).toContain("item.required ? \"待填\" : \"可选\"");
    expect(src).toContain("data-segment-state");
  });

  it("6) 预设槽状态并入概览：信号配方=必填（缺它退回 DEFAULT）、退出政策=可选", () => {
    const detail = read(DETAIL);
    // 概览接收预设状态
    expect(detail).toContain("presetSegments={definitionPresetSegments}");
    // SELECTION 的信号配方仍为必填；EXIT_POLICY 仍为可选
    expect(detail).toContain('selectionAuthoringSlots.find((slot) => slot.slotId === "SIGNAL_RECIPE")');
    expect(detail).toContain('key: "SELECTION"');
    expect(detail).toMatch(/build\(exitPolicySelection, exitPolicyMaterialized, "EXIT_POLICY", "退出政策", "preset-exit-policy", false\)/);
    // 预设区块有可跳转的 DOM id
    expect(detail).toContain('domId="preset-selection"');
    expect(detail).toContain('domId="preset-exit-policy"');
    // 概览组件真的渲染预设芯片
    const overview = read(OVERVIEW);
    expect(overview).toContain("data-preset-chip");
    expect(overview).toContain("data-preset-state");
  });

  it("8) 通用槽下拉显示「规则式中文名」，不把 optionId 当用户文案", () => {
    for (const rel of [AUTHORING_GROUP_EDITOR, EXIT_EDITOR]) {
      const src = read(rel);
      expect(src, rel).toContain(">{option.displayName}</option>");
      expect(src, rel).not.toContain(">{option.optionId}</option>");
    }
  });

  it("9) 旧 PresetEditor / FIELD_PATCH helper 已删除：全仓生产源码不得再引用", () => {
    const productionSources = productionSourceFiles(CLIENT)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(productionSources.includes("PresetEditor"), "PresetEditor").toBe(false);
    expect(productionSources.includes("applyDefinitionFieldPatch"), "applyDefinitionFieldPatch").toBe(false);
    expect(productionSources.includes("definitionFieldPatch"), "definitionFieldPatch").toBe(false);
  });

  it("10) 通用槽编辑器不暴露旧预设 payload / 技术细节入口", () => {
    for (const rel of [AUTHORING_GROUP_EDITOR, EXIT_EDITOR, ENTRY_EDITOR]) {
      const src = read(rel);
      expect(src, rel).not.toContain("materialized.payload");
      expect(src, rel).not.toContain("data-preset-technical-toggle");
    }
  });

  it("11) 通用槽参数只显示中文名 + 取值含义，不把 code 当标签", () => {
    const src = read(AUTHORING_GROUP_EDITOR);
    expect(src).toContain("parameter.label");
    expect(src).toContain("humanAuthoringParameterValue");
    expect(src).not.toContain("{parameter.code}</span>");
  });

  it("12) P-1：执行层零实现的字段不得出现在编辑面", () => {
    const src = read(FIELDS);
    expect(src).not.toContain('name="definition.position.maxSinglePosition"');
    expect(src).not.toContain('name="definition.risk.maxPositions"');
    expect(src).not.toContain('name="position.maxExposure"');
    expect(src).not.toContain('name="risk.maxSinglePosition"');
    expect(src).not.toContain("扩展风控（落到 definition.risk 的具名阈值）");
    expect(src).not.toContain('name="executionAssumptions.backtestConfig.maxPositions"');
  });

  it("13) P-1：被删字段改为技术细节里的只读声明清单", () => {
    const src = read(FIELDS);
    expect(src).toContain("data-declared-only-fields");
    expect(src).toContain("仅声明，不参与回测");
    expect(src).toContain("<TechnicalHint>");
    const keys = [
      "position.maxSinglePosition", "position.maxExposure", "risk.stopLoss",
      "risk.maxDrawdown", "risk.maxExposure", "risk.maxPositions",
      "risk.dailyLossLimit", "risk.concentrationLimit",
    ];
    for (const key of keys) expect(src.includes('["' + key + '"'), key).toBe(true);
  });

  it("14) P-1：maxPositions 是单一编辑点 + 双写（position 与 backtestConfig 同步）", () => {
    const src = read(FIELDS);
    expect(src).toContain("const setMaxPositions");
    expect(src).toContain("onChange={setMaxPositions}");
    const start = src.indexOf("const setMaxPositions");
    const block = src.slice(start, start + 320);
    expect(block).toContain("position: { ...drafts.position, maxPositions: value }");
    expect(block).toContain("cost: { ...drafts.cost, maxPositions: value }");
  });
  it("15) 五块骨架：覆盖全部 7 段且每段恰好归位一次（不漏、不重）", () => {
    expect(DEFINITION_BLOCKS.map(b => b.index)).toEqual([1, 2, 3, 4, 5]);
    expect(DEFINITION_BLOCKS.map(b => b.title)).toEqual(["选股", "出场", "仓位", "成本与成交", "可调参数"]);
    const covered = DEFINITION_BLOCKS.flatMap(b => [...b.segments]);
    expect([...covered].sort()).toEqual([...DEFINITION_SEGMENT_KEYS].sort());
    expect(new Set(covered).size, "有段被归位到多个块").toBe(covered.length);
  });

  it("16) 信任层状态条：三态齐备、在概览之前渲染、提供还原动作", () => {
    const detail = read(DETAIL);
    expect(detail).toContain("<DefinitionTrustStatus");
    expect(detail).toContain("{trustPanel}");
    const trustPanelIdx = detail.indexOf("{trustPanel}");
    const overviewRenderIdx = detail.indexOf("<DefinitionProgressOverview drafts={syncedDrafts}");
    expect(trustPanelIdx).toBeGreaterThan(-1);
    expect(overviewRenderIdx).toBeGreaterThan(trustPanelIdx);
    const status = read("components/strategy/DefinitionTrustStatus.tsx");
    for (const k of ['"MATCH"', '"VARIANT"', '"UNVERIFIED"']) expect(status).toContain(k);
    expect(status).toContain("data-trust-status");
    expect(status).toContain("还原为已验证版本的参数");
  });

  it("17) 信任层判定输入来自「预设默认值比对」，不另立口径", () => {
    const detail = read(DETAIL);
    expect(detail).toContain("changedPresetParams");
    expect(detail).toContain("parameter.defaultValue");
    expect(detail).toContain('loadedTarget === null ? "UNVERIFIED"');
  });
  it("18) I-3：编辑面上不得出现「更多 / 进阶 / 高级」这类空词", () => {
    for (const rel of [FIELDS, AUTHORING_GROUP_EDITOR, EXIT_EDITOR]) {
      const src = read(rel);
      expect(src.includes("更多方案"), rel).toBe(false);
      expect(src.includes("进阶："), rel).toBe(false);
      expect(src.includes("高级选项"), rel).toBe(false);
    }
    expect(read(FIELDS)).toContain("费用模型与执行约束");
  });

  it("19) I-8：≤3 个取值的枚举一律摊成 radio（EnumRadio），≥4 项才用下拉", () => {
    const src = read(FIELDS);
    const radio = [
      "DEFINITION_WINDOW_UNIT_OPTIONS", // 2 项
      "DEFINITION_QUANTITY_METHOD_OPTIONS", // 3 项
      "DEFINITION_SIGNAL_TIMING_OPTIONS", // 2 项
    ];
    const select = [
      "DEFINITION_EVENT_OPTIONS", // 5 项
      "DEFINITION_PRICE_TYPE_OPTIONS", // 5 项
      "DEFINITION_SIZING_METHOD_OPTIONS", // 5 项
      "DEFINITION_TRIGGER_OPTIONS", // 5 项
      "DEFINITION_EXECUTION_TIMING_OPTIONS", // 4 项
    ];
    /** 取 `at` 之前**最近**的一个枚举容器标签（决定这一项是摊开还是下拉）。 */
    const nearestTag = (body: string, at: number): string => {
      const r = body.lastIndexOf("<EnumRadio", at);
      const e = body.lastIndexOf("<EnumSelect", at);
      if (r > e) return "<EnumRadio";
      if (e > r) return "<EnumSelect";
      return "?";
    };
    for (const list of radio) {
      const at = src.indexOf(`options={${list}}`);
      expect(at, list).toBeGreaterThan(-1);
      expect(nearestTag(src, at), `${list} 应摊成 radio`).toBe("<EnumRadio");
    }
    for (const list of select) {
      const at = src.indexOf(`options={${list}}`);
      expect(at, list).toBeGreaterThan(-1);
      expect(nearestTag(src, at), `${list} 应保留下拉`).toBe("<EnumSelect");
    }
  });

  it("20) I-9：重复行里的每个控件都有可见标签（不得只靠 placeholder）", () => {
    const src = read(FIELDS);
    expect(src).toContain("function MiniField(");
    // 曾经只用 placeholder 当标签的几处
    for (const label of [
      'label="阈值"', 'label="优先级"', 'label="比较值"',
    ]) {
      expect(src.includes(label), label).toBe(true);
    }
    expect(src.includes('placeholder="阈值"')).toBe(false);
    expect(src.includes('placeholder="优先级"')).toBe(false);
    expect(src.includes('placeholder="min（TUNABLE 必填）"')).toBe(false);
    expect(src.includes('placeholder="max（TUNABLE 必填）"')).toBe(false);
  });

  it("21) I-10：多数字段必填 ⇒ 只标可选项「可选」（不逐项盖必填章）", () => {
    const seg = read("components/common/SegmentForm.tsx");
    expect(seg).toContain("optional?: boolean");
    expect(seg).toContain("可选");
    const src = read(FIELDS);
    // 条件生效的可选旋钮：单笔比例 / 固定金额
    expect(src).toMatch(/label="单笔比例"[\s\S]{0,80}optional/);
    expect(src).toMatch(/label="固定金额"[\s\S]{0,80}optional/);
    // 缺口的必填文案仍在（可选标注不得把必填抹掉）
    expect(read(DRAFT)).toContain("事件类型（必填）");
  });

  it("22) I-7：通用槽参数使用受控网格布局，不逐项铺满整行", () => {
    for (const rel of [AUTHORING_GROUP_EDITOR, EXIT_EDITOR, ENTRY_EDITOR]) {
      expect(read(rel), rel).toContain("grid gap-1.5 sm:grid-cols-2");
    }
  });

  it("23) P2：四块各有方案编辑器（SELECTION / EXIT_POLICY / POSITION / COST），且块↔方案对应", () => {
    const detail = read(DETAIL);
    // 四个编辑器各自的 DOM id 与 group 过滤
    for (const [domId, group] of [
      ["preset-selection", "SELECTION"],
      ["preset-position", "POSITION"],
      ["preset-cost", "COST"],
    ] as const) {
      expect(detail.includes(`domId="${domId}"`), domId).toBe(true);
      expect(detail.includes(`group.group === "${group}"`), group).toBe(true);
    }
    // 五块里的方案归属（③ 仓位 / ④ 成本与成交 不再是空的 presetKeys）
    const position = DEFINITION_BLOCKS.find(b => b.key === "position");
    const cost = DEFINITION_BLOCKS.find(b => b.key === "cost");
    expect(position?.presetKeys).toEqual(["POSITION"]);
    expect(cost?.presetKeys).toEqual(["COST"]);
    // 概览的预设芯片状态来自调用方算好的 presetSegments（不新增口径）
    expect(detail).toContain("buildAuthoringGroupSegment(");
    expect(detail).toContain('"POSITION", "仓位与持仓数", "preset-position"');
    expect(detail).toContain('"COST", "成本与成交", "preset-cost"');
    expect(detail).toContain('group="SELECTION"');
    expect(detail).toContain('group="POSITION"');
    expect(detail).toContain('group="COST"');
  });

  it("24) P2：③④ 改走通用 AuthoringSlot，不再走 FIELD_PATCH", () => {
    const detail = read(DETAIL);
    expect(detail).toContain("<AuthoringSlotGroupEditor");
    expect(detail).toContain("onPositionSlotApply");
    expect(detail).toContain("onCostSlotApply");
    expect(detail).toContain('applyAuthoringSelection("POSITION"');
    expect(detail).toContain('applyAuthoringSelection("COST"');
    expect(detail).toContain("applyAuthoringSlotResult(previous.drafts, result)");
    // 旧 FIELD_PATCH 路径不得再进入页面主路径
    expect(detail.includes("applyDefinitionFieldPatch")).toBe(false);
    expect(detail.includes("onFieldPatchSelectionChange")).toBe(false);
    expect(detail.includes("positionSelection")).toBe(false);
    expect(detail.includes("costSelection")).toBe(false);
  });

  it("24b) POSITION / COST 槽存在时，DefinitionFields 隐藏旧手输字段，模型字段只读", () => {
    const fields = read(FIELDS);
    const detail = read(DETAIL);

    // 调用方传入通用 boolean / owned-path，不在 DefinitionFields 里硬编码 slotId。
    expect(detail).toContain("hideLegacyPositionFields={positionAuthoringSlots.length > 0}");
    expect(detail).toContain("hideLegacyCostFields={costAuthoringSlots.length > 0}");
    expect(detail).toContain("hiddenFieldPaths={managedDefinitionPaths}");
    expect(fields).toContain("hiddenFieldPaths");
    expect(fields).toContain("hideLegacyPositionFields");
    expect(fields).toContain("hideLegacyCostFields");

    // 旧仓位字段只有在未被槽管理时才渲染。
    for (const hook of [
      'hidePositionField("position.sizingMethod")',
      'hidePositionField("position.maxPositions")',
      'hidePositionField("position.positionRatio")',
      'hidePositionField("position.fixedAmount")',
    ]) {
      expect(fields.includes(hook), hook).toBe(true);
    }

    // 旧成交时点 / 价格类型字段按 managed path 隐藏；成本模型字段组整组隐藏。
    for (const hook of [
      'hideCostField("execution.signalTiming")',
      'hideCostField("execution.executionTiming")',
      'hideCostField("execution.priceType")',
      "!hideLegacyCostFields &&",
    ]) {
      expect(fields.includes(hook), hook).toBe(true);
    }

    // slippageModel / commissionModel 没有编辑控件，只保留只读技术展示。
    expect(fields).not.toContain("options={DEFINITION_COST_MODEL_OPTIONS}");
    expect(fields).toContain("data-legacy-cost-model-readonly");
    expect(fields).toContain("滑点模型（只读）");
    expect(fields).toContain("佣金模型（只读）");
    expect(fields).not.toMatch(/name="execution\.(slippageModel|commissionModel)"[\s\S]{0,200}<EnumRadio/);

    // 未被槽覆盖的真实字段仍保留编辑面。
    for (const hook of [
      'name="definition.execution.quantityMethod"',
      'name="definition.execution.lotSize"',
      'name="execution.executionConstraints"',
    ]) {
      expect(fields.includes(hook), hook).toBe(true);
    }
  });

  it("25) P3：⑤ 是派生视图（候选来自 generic slot 参数），不提供手写 code 入口", () => {
    const fields = read(FIELDS);
    // 有 generic 来源时才渲染候选面板；无来源时明确空态，不再提供手写参数入口。
    expect(fields).toContain("searchParameterSources = []");
    expect(fields).toContain("searchParameterSources.length > 0 ? (");
    expect(fields).toContain("deriveSearchParameterCandidates(drafts, sources)");
    expect(fields).toContain("data-search-candidates");
    expect(fields).toContain("data-search-parameter-empty");
    expect(fields).toContain("不再提供手工参数 code 输入");
    expect(fields).toContain("data-parameter-declaration-readonly");
    expect(fields).toContain("参数由上方方案声明；本面板只控制是否加入搜索空间");
    expect(fields.includes("ParameterRowForm")).toBe(false);
    expect(fields.includes("emptyParameterRow()")).toBe(false);
    expect(fields.includes("添加待搜索参数")).toBe(false);
    // 来源由调用方按「已选 generic slot × vocabulary option.parameters」组装，顺序 = ①–④。
    const detail = read(DETAIL);
    expect(detail).toContain("searchParameterSources={searchParameterSources}");
    expect(detail).toContain("const searchParameterSources = useMemo<readonly SelectedPresetParameters[]>");
    expect(detail.includes('pick(exitPolicySelection, "② 出场")')).toBe(false);
    expect(detail).toContain('addAuthoringSource("① 选股"');
    expect(detail).toContain('addAuthoringSource("② 买入条件"');
    expect(detail).toContain('addAuthoringSource("③ 仓位"');
    expect(detail).toContain('addAuthoringSource("④ 成本与成交"');
    expect(detail).toContain('addAuthoringSource("退出政策"');
    expect(detail).toContain('declaredRoleByCode.get(parameter.code.trim()) === "TUNABLE"');
    // 派生模块本身不得含参数 code 字面量清单（只认词表给的 code）
    const module = read("components/strategy/searchParameterCandidates.ts");
    expect(module).toContain("parameter.code");
    expect(module).not.toMatch(/const\s+[A-Z_]*CODES\s*=\s*\[/);
  });

  it("26) P3：死参数防火墙 —— 未被规则引用的候选不可勾选", () => {
    const module = read("components/strategy/searchParameterCandidates.ts");
    expect(module).toContain("referencedParameterCodes");
    expect(module).toContain("REJECTED_UNREFERENCED");
    expect(module).toContain("PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER");
    // UI 侧：禁用 + 说明原因，不是静默放过
    const fields = read(FIELDS);
    expect(fields).toContain("const disabled = !checked && !candidate.referenced");
    expect(fields).toContain("该参数没有被规则引用：搜索它不会改变任何结果");
    // 参数引用只认两种声明式来源（条件参数引用 + 出场规则 parameter）
    expect(module).toContain("PARAMETER_REFERENCE");
    expect(module).toContain("rule.original?.parameter");
  });

  it("27) P5：四块的方案/参数使用被本地计数（不发网络），且用途有明文边界", () => {
    const detail = read(DETAIL);
    expect(detail).toContain("recordPresetUsage");
    expect(detail).toContain("recordPresetUsage(`${group}:${input.slotId}`");
    // 计数只在「相对默认值改了几项」上做文章（不是统计按键次数）
    expect(detail).toContain("(input.parameters[parameter.code] ?? parameter.defaultValue) !== parameter.defaultValue");
    const module = read("components/strategy/authoringUsageLog.ts");
    expect(module).toContain("localStorage");
    // 用途边界写在模块头注释里：只本地、不发网络、可清空
    expect(module).toContain("绝不发网络请求");
    expect(module).toContain("clearAuthoringUsage");
    expect(module).toContain("≥2 周");
  });

  it("28) P2：出场拆 9 槽，且 46 个实验（EXIT_BASE）不再出现在前端", () => {
    const detail = read(DETAIL);
    // 推荐组合入口只收 EXIT_POLICY（EXIT_BASE 已按裁定从前端删掉）
    expect(detail).toContain('item.slot === "EXIT_POLICY"');
    expect(detail.includes('item.slot === "EXIT_POLICY" || item.slot === "EXIT_BASE"')).toBe(false);
    expect(detail).toContain("onExitStartPresetChange");
    // 9 个槽的编辑器
    expect(detail).toContain("<ExitPolicySlotEditor");
    expect(detail).toContain("slots={exitAuthoringSlots}");
    expect(detail).toContain("data-exit-slots-empty");
    const editor = read("components/strategy/ExitPolicySlotEditor.tsx");
    expect(editor).toContain("data-exit-policy-start");
    for (const hook of ["data-exit-policy-slots", "data-exit-slot-more-toggle", "data-exit-slot-research-toggle", "data-exit-slot="]) {
      expect(editor.includes(hook), hook).toBe(true);
    }
    // 只提供逐槽「恢复该方案默认参数」，不提供整表 Reset（NN/g I-13）
    expect(editor).toContain("恢复该方案默认参数");
    expect(editor).not.toContain("恢复全部");
  });

  it("29) P2：前端**不自行拼 policy** —— EXIT_POLICY 接入通用 AuthoringSlot 协议", () => {
    const detail = read(DETAIL);
    expect(detail).toContain("recognizeAuthoringSlots");
    expect(detail).toContain("applyAuthoringSlot");
    expect(detail).toContain("applyAuthoringSlotResult(previous.drafts, result)");
    const editor = read("components/strategy/ExitPolicySlotEditor.tsx");
    // 前端不得出现"拼装/识别"的服务端实现名，也不得 import 服务端模块
    for (const forbidden of ["mergeExitPolicyPatch", "materializeExitPolicySlotOption", "recognizeExitPolicySlot("]) {
      expect(editor.includes(forbidden), forbidden).toBe(false);
    }
    expect(editor).not.toContain("from \"server/");
    // 认不出时必须如实说明并保持原样
    expect(editor).toContain("本表单不识别（保持原样）");
  });

  it("30) P3：两个假旋钮不提供编辑面，只在技术细节里如实标注", () => {
    const editor = read("components/strategy/ExitPolicySlotEditor.tsx");
    expect(editor).toContain("data-exit-declared-only-fields");
    expect(editor).toContain("uneditedExitPolicyFields");
    // 两类标注必须分开（不参与回测 vs 会参与回测）
    expect(editor).toContain("仅声明，不参与回测");
    expect(editor).toContain("会参与回测");
    // 只读块只在技术模式渲染
    expect(editor).toContain("<TechnicalHint>");
    // 不得给 contexts / capitalRecycle 做编辑控件
    expect(editor.includes("capitalRecycle: {")).toBe(false);
    expect(editor.includes("policy.capitalRecycle =")).toBe(false);
  });

  it("31) P4：信任层按槽比对，且「还原」把整份退出政策换回打开的那个版本", () => {
    const detail = read(DETAIL);
    // 基准来自**已落库文档**，不是本地草稿
    expect(detail).toContain("const baselineExitPolicy = useMemo<Record<string, unknown> | null>");
    expect(detail).toContain("if (savedDocument === null) return null;");
    expect(detail).toContain("baselineAuthoringRecognition");
    // 逐槽差异：换方案一条，调参数逐项一条
    expect(detail).toContain("const changedExitSlots = useMemo<readonly DefinitionTrustChangedParam[]>");
    expect(detail).toContain('code: "换方案"');
    // 三态用「预设参数 + 退出槽」的合并差异
    expect(detail).toContain("const changedDefinitionParams = useMemo<readonly DefinitionTrustChangedParam[]>");
    expect(detail).toContain("changedDefinitionParams.length > 0 || dirty");
    // 还原 = 整份 policy 替换（逐槽回默认未必等于原政策）
    expect(detail).toContain("applyExitPolicyRule(envelope, baselineExitPolicy)");
  });

  it("32) 紧凑化：出场槽一行一槽 + 参数折叠（按用户反馈 2026-10-03）", () => {
    const editor = read("components/strategy/ExitPolicySlotEditor.tsx");
    // 一行一槽：标签 / 下拉 / 参数折叠入口 都在同一行容器里
    expect(editor).toContain("data-exit-slot={slot.slotId}");
    expect(editor).toContain("data-exit-slot-select={slot.slotId}");
    expect(editor).toContain("data-exit-slot-params-toggle={slot.slotId}");
    // 槽的人话问题走 title（不占正文高度）
    expect(editor).toContain("title={slot.question}");
    // 参数默认折叠：只有点了「参数（N）」才渲染输入框
    expect(editor).toContain("showParams && params.length > 0");
    // 每个槽不再各套一张卡片（那是"一堵墙"的来源）
    expect(editor.includes("rounded-md border bg-card p-2.5")).toBe(false);
    // 「恢复该方案默认参数」只在**参数被改过**时出现（默认态省掉一行按钮）
    expect(editor).toContain("{tuned && (");
    // 通用 POSITION / COST 槽沿用同一「参数折叠」纪律。
    expect(read(AUTHORING_GROUP_EDITOR)).toContain("data-authoring-slot-params-toggle={slot.slotId}");
  });

  it("33) 9 槽**不依赖**推荐组合：没选整包也要看得见（含起步基准说明）", () => {
    const detail = read(DETAIL);
    // 槽的渲染条件是"有效 policy"，不是"文档里已有 policy"
    expect(detail).toContain("const effectiveExitPolicy = currentExitPolicy ?? ((vocabulary?.exitPolicyBasePolicy ?? null) as Record<string, unknown> | null);");
    expect(detail).toContain("{effectiveExitPolicy === null ? (");
    expect(detail).toContain("data-exit-slots-base-note");
    // 识别与改槽都走通用 target；definition 里没有政策时由服务端回落到 SL-00 基准
    expect(detail).toContain("target: currentAuthoringTarget");
    expect(detail).toContain("definition: currentCanonicalDefinition,");
    // P4：推荐组合已被「起点」行取代（不再是独立卡片），且明确可留空
    expect(read("components/strategy/ExitPolicySlotEditor.tsx")).toContain("不用推荐组合");
    // 起步基准来自词表（前端不得硬编码一份 policy）
    expect(detail).not.toContain("FIXED_PERCENT");
  });

  it("34) B 档：方案区（presetPanel）彻底消失，四块各自的方案行挂到自己的段首", () => {
    const detail = read(DETAIL);
    // presetPanel 已不存在
    expect(detail.includes("presetPanel")).toBe(false);
    // 四块通过 presetBlocks 注入
    expect(detail).toContain("presetBlocks={");
    for (const key of ["selection:", "exit:", "position:", "cost:"]) {
      expect(detail.includes(key), key).toBe(true);
    }
    // 段首渲染：① 选股 / ④ 出场 / ⑤ 仓位 / ⑥ 成本
    const fields = read(FIELDS);
    expect(fields).toContain("{presetBlocks?.selection}");
    expect(fields).toContain("{presetBlocks?.exit}");
    expect(fields).toContain("{presetBlocks?.position}");
    expect(fields).toContain("{presetBlocks?.cost}");
    // 段④ 不再把「统一退出政策行」当普通规则渲染
    expect(fields).toContain("function isUnifiedExitPolicyRow(");
    expect(fields).toContain("isUnifiedExitPolicyRow(row) ? null : (");
  });

  it("35) 统一退出政策行不再被判「缺阈值」（此前一整套合法政策永远挂红字）", () => {
    const base = definitionToDrafts({ entry: {} });
    if (base.kind !== "structured") throw new Error("期望 structured");
    const drafts: DefinitionDrafts = {
      ...base.drafts,
      exitRules: [
        {
          original: { id: "exit-unified-policy", type: "STOP_LOSS", trigger: "ON_CLOSE", policy: { stop: {} } },
          type: "STOP_LOSS", trigger: "ON_CLOSE", threshold: "", thresholdUnit: "", priority: "0", enabled: true,
        },
      ],
    };
    const labels = validateDefinitionDrafts(drafts).errors.join(" | ");
    expect(labels).not.toContain("既没有阈值也没有参数/条件");
    // 反例：**没有** policy 的空阈值行仍然要报（豁免只给统一政策行）
    const plain: DefinitionDrafts = {
      ...base.drafts,
      exitRules: [{ ...drafts.exitRules[0]!, original: { id: "r1", type: "STOP_LOSS", trigger: "ON_CLOSE" } }],
    };
    expect(validateDefinitionDrafts(plain).errors.join(" | ")).toContain("既没有阈值也没有参数/条件");
  });

  it("36) P2/P3/P4 一轮：当前值 + 一行人话总述 + 起点行（推荐组合不再是独立卡片）", () => {
    const editor = read("components/strategy/ExitPolicySlotEditor.tsx");
    expect(editor).toContain("data-exit-slot-value");
    expect(editor).toContain("summarizeSlotValues");
    expect(editor).toContain("data-exit-policy-summary");
    expect(editor).toContain("summarizeExitPolicySlots");
    expect(editor.includes(">已改<")).toBe(false);
    expect(editor).toContain("data-exit-policy-start");
    expect(editor).toContain("data-exit-policy-reset-base");
    expect(editor).toContain("改为实验基准");
    const detail = read(DETAIL);
    expect(detail).toContain("onExitStartPresetChange");
    expect(detail).toContain("onExitResetToBase");
    expect(detail).toContain("startOptions=");
    // 出场 / 仓位 / 成本 / 选股都不再有独立 PresetEditor 卡
    expect(detail.includes("<PresetEditor")).toBe(false);
    expect(detail).toContain('domId="preset-selection"');
  });

  it("7) 跳段的 DOM 前缀与事件名只有一个来源（definitionDraft）", () => {
    const draft = read(DRAFT);
    expect(draft).toContain("export const DEFINITION_SEGMENT_DOM_PREFIX");
    expect(draft).toContain("export const DEFINITION_FOCUS_SEGMENT_EVENT");
    expect(draft).toContain("export function dispatchDefinitionFocusSegment");

    const fields = read(FIELDS);
    // 组件内不得再各写一份前缀字符串
    expect(fields).not.toContain('const SEGMENT_DOM_PREFIX');
    expect(fields).toContain("DEFINITION_SEGMENT_DOM_PREFIX");
    // 明细监听事件（展开 + 滚动）
    expect(fields).toContain("DEFINITION_FOCUS_SEGMENT_EVENT");

    const overview = read(OVERVIEW);
    expect(overview).toContain("dispatchDefinitionFocusSegment");
  });
});

describe("ENTRY_CONDITION 定义页结构锁", () => {
  it("37) 服务端入场槽渲染在第②段，未识别保持原样", () => {
    const editor = read(ENTRY_EDITOR);
    for (const hook of [
      "data-entry-condition-slots",
      "data-entry-condition-slot=",
      "data-entry-condition-select=",
      "data-entry-condition-value=",
      "data-entry-condition-params-toggle=",
      "data-entry-condition-empty",
      "data-entry-condition-unrecognized=",
      "data-entry-condition-summary",
    ]) {
      expect(editor.includes(hook), hook).toBe(true);
    }
    expect(editor).toContain("本表单不识别（保持原样）");
    expect(editor).toContain("humanEntryParameterValue");
    expect(editor).toContain("RATIO");
    expect(editor).not.toContain("from \"server/");
    expect(editor).not.toContain("materializeEntryConditionSlotOption");
    expect(editor).not.toContain("recognizeEntryConditionSlot(");
    expect(read(FIELDS)).toContain("{presetBlocks?.entryCondition}");
  });

  it("38) 识别和应用都走服务端，apply 成功后才写草稿并置 dirty", () => {
    const detail = read(DETAIL);
    expect(detail).toContain("recognizeAuthoringSlots");
    expect(detail).toContain("applyAuthoringSlot");
    expect(detail).toContain("<EntryConditionSlotEditor");
    expect(detail).toContain("onEntryConditionSlotApply");
    expect(detail).toContain("applyAuthoringSlotResult(previous.drafts, result)");
    expect(detail).toContain('group === "ENTRY_CONDITION"');
    expect(detail).toContain('"仓位规则槽没改成"');
    expect(detail).toContain('"成本与成交规则槽没改成"');
    const successStart = detail.indexOf("const changedCount = option === null");
    const dirtyIndex = detail.indexOf("setDirty(true);", successStart);
    expect(successStart).toBeGreaterThan(-1);
    expect(dirtyIndex).toBeGreaterThan(successStart);
    expect(detail).toContain("recordPresetUsage(`${group}:${input.slotId}`, input.optionId, changedCount)");
  });

  it("39) managedConditionIds 过滤手动条件，未知条件仍展示", () => {
    const fields = read(FIELDS);
    expect(fields).toContain("managedConditionIds");
    expect(fields).toContain("const managedConditionIdSet = useMemo(() => new Set(managedConditionIds)");
    expect(fields).toContain("visibleConditionRows");
    expect(fields).toContain("data-entry-condition-manual-empty");
    expect(fields).toContain("入场槽已管理");
    expect(fields).toContain("未知 / 未识别条件仍按原样展示");
    expect(read(DETAIL)).toContain("managedConditionIds={entryConditionManagedConditionIds}");
  });

  it("40) TUNABLE 参数进入⑤候选来源，FIXED 不进入；概览纳入入场条件", () => {
    const detail = read(DETAIL);
    expect(detail).toContain('addAuthoringSource("② 买入条件"');
    expect(detail).toContain('declaredRoleByCode.get(parameter.code.trim()) === "TUNABLE"');
    expect(detail).toContain('item.group === "SELECTION"');
    expect(detail).toContain('item.group === "ENTRY_CONDITION"');
    expect(detail).toContain('item.group === "POSITION"');
    expect(detail).toContain('item.group === "COST"');
    expect(read(OVERVIEW)).toContain('presetKeys: ["SELECTION", "ENTRY_CONDITION"]');
  });

  it("41) SELECTION / EXIT_POLICY / ENTRY_CONDITION 统一走通用 AuthoringSlot 协议，旧专用端点不再被调用", () => {
    const detail = read(DETAIL);
    // 通用协议：词表按 group 下发 + 一条 target recognition + 一条 apply
    expect(detail).toContain("vocabulary?.authoringSlotGroups");
    expect(detail).toContain("trpc.strategyDomain.authoring.recognizeAuthoringSlots.useQuery");
    expect(detail).toContain("trpc.strategyDomain.authoring.applyAuthoringSlot.useMutation");
    expect(detail).toContain('item.group === "SELECTION"');
    expect(detail).toContain('item.group === "EXIT_POLICY"');
    expect(detail).toContain('item.group === "ENTRY_CONDITION"');
    // 旧专用端点名称一律不得再出现在 StrategyDetail 的调用里
    for (const forbidden of [
      "recognizeExitPolicySlots",
      "applyExitPolicySlot",
      "recognizeEntryConditionSlots",
      "applyEntryConditionSlot",
    ]) {
      expect(detail.includes(forbidden), forbidden).toBe(false);
    }
    // 旧的逐块词表字段不再是主来源
    expect(detail.includes("vocabulary.exitPolicySlots")).toBe(false);
    expect(detail.includes("vocabulary?.entryConditionSlots")).toBe(false);
  });

  it("42) SELECTION 接入通用槽：RECIPE 专用 PresetEditor 主路径移除，旧事件/窗口/触发字段可隐藏", () => {
    const detail = read(DETAIL);
    const fields = read(FIELDS);
    expect(detail).toContain("const selectionAuthoringSlots = useMemo");
    expect(detail).toContain("const selectionRecognitions = useMemo");
    expect(detail).toContain('group="SELECTION"');
    expect(detail).toContain("onSelectionSlotApply");
    expect(detail).toContain('applyAuthoringSelection("SELECTION"');
    expect(detail).toContain("const nextRecipe = result.recipe ?? null");
    expect(detail.includes("recipeSelection")).toBe(false);
    expect(detail.includes("recipeMaterialized")).toBe(false);
    expect(detail.includes("<PresetEditor")).toBe(false);
    expect(detail).toContain("hideLegacySelectionFields={selectionAuthoringSlots.length > 0}");

    expect(fields).toContain("hideLegacySelectionFields");
    expect(fields).toContain('hideSelectionField("entry.event.type")');
    expect(fields).toContain('hideSelectionField("entry.event.params")');
    expect(fields).toContain('hideSelectionField("entry.observationWindow")');
    expect(fields).toContain('hideSelectionField("entry.trigger.type")');
    expect(fields).toContain('hideSelectionField("entry.trigger.params")');
    expect(fields).toContain("{presetBlocks?.selection}");
  });
});
