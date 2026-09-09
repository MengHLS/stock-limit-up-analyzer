/**
 * PositionSizingEditor — 仓位规则（任务 §3.5）。
 *
 * 可视化仓位模式 + 最大持仓数。模式严格映射后端 PositionSizingDeclaration 三值
 * （equal-weight / fixed-fraction / rank-weighted），不引入契约外的「Custom」。
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/common";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Percent } from "lucide-react";
import {
  POSITION_SIZING_KINDS,
  positionSizingLabel,
  type PositionSizingKind,
  type StrategyViewModel,
} from "@/adapters/strategyAdapter";

export function PositionSizingEditor({
  vm,
  onChange,
}: {
  vm: StrategyViewModel;
  onChange: (next: StrategyViewModel) => void;
}) {
  const p = vm.positionSizing;
  const setKind = (kind: PositionSizingKind) =>
    onChange({
      ...vm,
      positionSizing: {
        ...p,
        kind,
        fraction: kind === "fixed-fraction" ? (p.fraction ?? 0.05) : p.fraction,
      },
    });

  return (
    <SectionCard
      title="仓位规则（Position Sizing）"
      icon={Percent}
      description="声明式仓位分派，不执行；执行由后续回测引擎消费"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5 md:col-span-1">
          <Label>仓位模式</Label>
          <Select
            value={p.kind}
            onValueChange={v => setKind(v as PositionSizingKind)}
          >
            <SelectTrigger className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POSITION_SIZING_KINDS.map(k => (
                <SelectItem key={k} value={k}>
                  {positionSizingLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ps-max">最大持仓数</Label>
          <Input
            id="ps-max"
            type="number"
            min={1}
            value={p.maxPositions}
            onChange={e =>
              onChange({
                ...vm,
                positionSizing: {
                  ...p,
                  maxPositions: Math.max(1, Number(e.target.value) || 1),
                },
              })
            }
          />
        </div>

        {p.kind === "fixed-fraction" && (
          <div className="space-y-1.5">
            <Label htmlFor="ps-frac">每仓资金比例（0~1）</Label>
            <Input
              id="ps-frac"
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={p.fraction ?? 0}
              onChange={e =>
                onChange({
                  ...vm,
                  positionSizing: {
                    ...p,
                    fraction: Math.min(
                      1,
                      Math.max(0, Number(e.target.value) || 0)
                    ),
                  },
                })
              }
            />
          </div>
        )}
      </div>
    </SectionCard>
  );
}
