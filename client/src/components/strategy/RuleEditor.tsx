/**
 * RuleEditor — 结构化规则编辑器（任务 §3.3 / §3.4 / §3.6）。
 *
 * 通用组件，用于 Entry / Exit / Risk 三类规则（后端统一为 DeclaredRule 声明式描述符）。
 * 以「类型 / 字段 / 操作符 / 数值 / 说明」表格展示，支持：
 *   - [+ 自定义条件]：新增空白条件；
 *   - [添加预设条件]：按类别（入场/退出/风险）快速填入常用中文条件；
 *   - 字段输入带常用字段联想（datalist），操作符/类型中文化。
 *
 * 诚实纪律：后端 DeclaredRule 无 AND/OR 逻辑字段，rules 为平铺数组、语义为隐式 AND。
 * 为遵守「不修改 StrategyDocument Contract」铁律，本期以「规则之间为 AND 关系」显式标注，
 * 不引入 OR 字段（需后端契约演进后才可支持）。
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/common";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LucideIcon } from "lucide-react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import {
  emptyRule,
  presetToRule,
  ruleFieldLabel,
  ruleKindDescription,
  ruleKindLabel,
  ruleOperatorLabel,
  rulePresetsForCategory,
  RULE_FIELD_LABELS,
  RULE_KINDS,
  RULE_OPERATORS,
  type RuleCategory,
  type RuleKind,
  type RuleViewModel,
} from "@/adapters/strategyAdapter";

function operandToInput(op: RuleViewModel["operand"]): string {
  if (op === null || op === undefined) return "";
  return String(op);
}

function inputToOperand(text: string): number | string | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return n.toString() === t && Number.isFinite(n) ? n : t;
}

export function RuleEditor({
  title,
  description,
  icon: Icon,
  rules,
  onChange,
  category = "entry",
  defaultKind = "threshold",
  fieldPlaceholder = "如 candidate.rank",
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  rules: RuleViewModel[];
  onChange: (rules: RuleViewModel[]) => void;
  /** 规则类别，决定「添加预设条件」下拉展示的预设集合。 */
  category?: RuleCategory;
  defaultKind?: RuleKind;
  fieldPlaceholder?: string;
}) {
  const update = (i: number, patch: Partial<RuleViewModel>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rules.filter((_, idx) => idx !== i));
  const add = () => onChange([...rules, emptyRule(defaultKind)]);

  const presets = rulePresetsForCategory(category);
  const datalistId = `rule-fields-${category}`;

  function addPreset(label: string) {
    if (!label) return;
    const preset = presets.find(p => p.label === label);
    if (preset) onChange([...rules, presetToRule(preset)]);
  }

  return (
    <SectionCard
      title={title}
      description={description}
      icon={Icon}
      right={
        <div className="flex items-center gap-2">
          <select
            value=""
            onChange={e => addPreset(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground hover:text-foreground"
            aria-label="添加预设条件"
          >
            <option value="">＋ 添加预设条件…</option>
            {presets.map(p => (
              <option key={p.label} value={p.label}>
                {p.label} · {p.description}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={add}>
            <Plus className="mr-1 h-3.5 w-3.5" /> 自定义条件
          </Button>
        </div>
      }
    >
      {rules.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          暂无规则，点击「＋ 添加预设条件」快速填充，或「自定义条件」空白新建。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28 text-xs">类型</TableHead>
                <TableHead className="text-xs">字段</TableHead>
                <TableHead className="w-28 text-xs">操作符</TableHead>
                <TableHead className="w-24 text-xs">数值</TableHead>
                <TableHead className="text-xs">说明（中文语义）</TableHead>
                <TableHead className="w-10 text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r, i) => (
                <TableRow key={r.id} className="align-middle">
                  <TableCell>
                    <Select
                      value={r.kind}
                      onValueChange={v => update(i, { kind: v })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RULE_KINDS.map(k => (
                          <SelectItem key={k} value={k}>
                            {ruleKindLabel(k)} · {ruleKindDescription(k)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={r.field}
                      onChange={e => update(i, { field: e.target.value })}
                      placeholder={fieldPlaceholder}
                      list={datalistId}
                      className="h-8 font-mono text-xs"
                    />
                    {r.field && RULE_FIELD_LABELS[r.field] && (
                      <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                        {ruleFieldLabel(r.field)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={r.operator || "none"}
                      onValueChange={v =>
                        update(i, {
                          operator:
                            v === "none"
                              ? ""
                              : (v as RuleViewModel["operator"]),
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {RULE_OPERATORS.map(op => (
                          <SelectItem key={op} value={op}>
                            {ruleOperatorLabel(op)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={operandToInput(r.operand)}
                      onChange={e =>
                        update(i, { operand: inputToOperand(e.target.value) })
                      }
                      placeholder="数值"
                      className="h-8 font-mono text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={r.description}
                      onChange={e => update(i, { description: e.target.value })}
                      placeholder="人类可读语义（必填）"
                      className="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-red-600"
                      onClick={() => remove(i)}
                      aria-label="删除规则"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <datalist id={datalistId}>
        {Object.entries(RULE_FIELD_LABELS).map(([field, label]) => (
          <option key={field} value={field}>
            {label}
          </option>
        ))}
      </datalist>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3 shrink-0" />
        规则之间为{" "}
        <span className="font-medium text-foreground">AND（全部满足）</span>{" "}
        关系；「说明」是唯一完整语义，字段/操作符/数值为机器可读片段（供审计与未来执行器引用）。
      </p>
    </SectionCard>
  );
}
