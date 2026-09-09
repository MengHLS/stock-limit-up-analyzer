/**
 * RuleEditor — 结构化规则编辑器（任务 §3.3 / §3.4 / §3.6）。
 *
 * 通用组件，用于 Entry / Exit / Risk 三类规则（后端统一为 DeclaredRule 声明式描述符）。
 * 以「类型 / 字段 / 操作 / 数值 / 说明」表格展示，支持 [+ 添加条件] 与删除。
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
import { Plus, Trash2 } from "lucide-react";
import {
  emptyRule,
  RULE_KINDS,
  RULE_OPERATORS,
  type RuleKind,
  type RuleViewModel,
} from "@/adapters/strategyAdapter";

const KIND_LABELS: Record<string, string> = {
  threshold: "阈值",
  "time-based": "时间",
  state: "状态",
  event: "事件",
};

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
  defaultKind = "threshold",
  fieldPlaceholder = "如 candidate.rank",
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  rules: RuleViewModel[];
  onChange: (rules: RuleViewModel[]) => void;
  defaultKind?: RuleKind;
  fieldPlaceholder?: string;
}) {
  const update = (i: number, patch: Partial<RuleViewModel>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rules.filter((_, idx) => idx !== i));
  const add = () => onChange([...rules, emptyRule(defaultKind)]);

  return (
    <SectionCard
      title={title}
      description={description}
      icon={Icon}
      right={
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="mr-1 h-3.5 w-3.5" /> 添加条件
        </Button>
      }
    >
      {rules.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          暂无规则，点击「添加条件」新建。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28 text-xs">类型</TableHead>
                <TableHead className="text-xs">字段</TableHead>
                <TableHead className="w-20 text-xs">操作</TableHead>
                <TableHead className="w-28 text-xs">数值</TableHead>
                <TableHead className="text-xs">说明</TableHead>
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
                            {KIND_LABELS[k]} · {k}
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
                      className="h-8 font-mono text-xs"
                    />
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
                            {op}
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
      <p className="mt-2 text-[11px] text-muted-foreground">
        规则之间为{" "}
        <span className="font-medium text-foreground">AND（全部满足）</span>{" "}
        关系；
        描述字段是唯一完整语义，字段/操作/数值为机器可读片段（供审计与未来执行器引用）。
      </p>
    </SectionCard>
  );
}
