/**
 * STEP 14 / C-14.3 — 执行与约束模型：声明构造工厂（纯函数，规范化 + 默认值）。
 *
 * 全部字段取默认值即可得到一份「研究链可执行」的规范声明：
 *   - maxPositionCount / perSecurityEquityCap / totalEquityCap = null（不限 / 不声明）；
 *   - lotSize = 100；blockLimitUpBuy / blockLimitDownSell = false；
 *   - buyBanned / sellBanned = []；executionModel = NEXT_OPEN；allowPartialFill = false；
 *   - marketClaims 全为研究链当前语义字面量；boards = {}。
 *
 * 列表字段（buyBanned / sellBanned）经 sortUniqueSecurityIds 升序去重，保证传入任意
 * 乱序/重复输入都产出规范形（validate 的 canonical 检查因此总能通过）。
 */

import type { ExecutionConstraintDeclaration, MarketRuleClaims } from "./types";
import {
  DEFAULT_DIRECTION_POLICY,
  DEFAULT_LOT_SIZE,
  EXECUTION_CONSTRAINT_DECLARATION_KIND,
  EXECUTION_CONSTRAINT_DECLARATION_VERSION,
} from "./types";

/** securityId 列表升序去重（不修改入参）。 */
export function sortUniqueSecurityIds(values?: readonly string[]): readonly string[] {
  if (values === undefined || values.length === 0) return [];
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

type GroupInput<G> = Partial<G>;

/** 构造入参：必填 initialCapital；其余分节按需覆盖（未给的分节走默认值）。 */
export interface CreateExecutionConstraintDeclarationInput {
  readonly label?: string;
  readonly initialCapital: number;
  readonly positions?: GroupInput<ExecutionConstraintDeclaration["positions"]>;
  readonly lot?: GroupInput<ExecutionConstraintDeclaration["lot"]>;
  readonly restrictions?: GroupInput<ExecutionConstraintDeclaration["restrictions"]>;
  readonly timing?: GroupInput<ExecutionConstraintDeclaration["timing"]>;
  readonly marketClaims?: GroupInput<MarketRuleClaims>;
}

/** 构造规范形声明（纯函数；列表字段规范化，其余字段填默认值）。 */
export function createExecutionConstraintDeclaration(
  input: CreateExecutionConstraintDeclarationInput
): ExecutionConstraintDeclaration {
  const restrictionInput = input.restrictions ?? {};
  const marketClaimInput = input.marketClaims ?? {};
  return {
    recordKind: EXECUTION_CONSTRAINT_DECLARATION_KIND,
    recordVersion: EXECUTION_CONSTRAINT_DECLARATION_VERSION,
    ...(input.label !== undefined ? { label: input.label } : {}),
    capital: { initialCapital: input.initialCapital },
    positions: {
      maxPositionCount: null,
      perSecurityEquityCap: null,
      totalEquityCap: null,
      ...input.positions,
    },
    lot: { lotSize: DEFAULT_LOT_SIZE, ...input.lot },
    restrictions: {
      blockLimitUpBuy: restrictionInput.blockLimitUpBuy ?? false,
      blockLimitDownSell: restrictionInput.blockLimitDownSell ?? false,
      buyBanned: sortUniqueSecurityIds(restrictionInput.buyBanned),
      sellBanned: sortUniqueSecurityIds(restrictionInput.sellBanned),
    },
    timing: {
      executionModel: "NEXT_OPEN",
      allowPartialFill: false,
      ...input.timing,
    },
    marketClaims: {
      tPlus1: true,
      decisionPoint: "close",
      directionPolicy: DEFAULT_DIRECTION_POLICY,
      suspensionMode: "REJECT_NO_BAR",
      corporateActions: "NOT_APPLIED",
      boards: {},
      ...marketClaimInput,
    },
  };
}
