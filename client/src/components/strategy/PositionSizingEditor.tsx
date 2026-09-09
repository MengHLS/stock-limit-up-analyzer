/**
 * PositionSizingEditor — 仓位与资金规则（任务 §3.5）。
 *
 * 可视化仓位模式 + 初始资金 + 最大持仓数 + 每仓资金比例。
 * 模式严格映射后端 PositionSizingDeclaration 三值
 * （equal-weight / fixed-fraction / rank-weighted），不引入契约外的「Custom」。
 * 「最大持仓数」同时同步 executionAssumptions.backtestConfig.maxPositions（§17 追溯一致）。
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
import { Info, Percent } from "lucide-react";
import {
  POSITION_SIZING_KINDS,
  positionSizingDescription,
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

  /** 最大持仓数（同步 positionSizing 与 backtestConfig）。 */
  const setMaxPositions = (value: number) => {
    const maxPositions = Math.max(1, value || 1);
    onChange({
      ...vm,
      maxPositions,
      positionSizing: { ...p, maxPositions },
    });
  };

  return (
    <SectionCard
      title="仓位与资金规则"
      icon={Percent}
      description="声明式仓位分派与初始资金，不执行；执行由后续回测引擎消费"
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="ps-capital">初始资金（元）</Label>
          <Input
            id="ps-capital"
            type="number"
            min={0}
            step={10000}
            value={vm.initialCapital}
            onChange={e =>
              onChange({
                ...vm,
                initialCapital: Number(e.target.value) || 0,
              })
            }
          />
          <p className="text-[11px] text-muted-foreground">
            回测账户起点资金，用于计算仓位数与收益率。
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>仓位模式</Label>
          <Select
            value={p.kind}
            onValueChange={v => setKind(v as PositionSizingKind)}
          >
            <SelectTrigger className="w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POSITION_SIZING_KINDS.map(k => (
                <SelectItem key={k} value={k}>
                  {positionSizingLabel(k)}（{k}）
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
            onChange={e => setMaxPositions(Number(e.target.value))}
          />
          <p className="text-[11px] text-muted-foreground">
            同时持有的最大股票数量。
          </p>
        </div>

        {p.kind === "fixed-fraction" && (
          <div className="space-y-1.5">
            <Label htmlFor="ps-frac">每仓资金比例（0 ~ 1）</Label>
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
            <p className="text-[11px] text-muted-foreground">
              每只占用初始资金的固定比例（如 0.1 = 10%）。
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <span className="font-medium text-foreground">
            {positionSizingLabel(p.kind)}：
          </span>{" "}
          {positionSizingDescription(p.kind)}
        </div>
      </div>
    </SectionCard>
  );
}
