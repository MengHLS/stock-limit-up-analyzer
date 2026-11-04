import {
  DEFAULT_FOUNDATION_COST,
  type FoundationCostConfig,
} from "./types";

export function resolveFoundationCost(
  input: Partial<FoundationCostConfig> | undefined
): FoundationCostConfig {
  return {
    commissionBpsPerSide:
      input?.commissionBpsPerSide ??
      DEFAULT_FOUNDATION_COST.commissionBpsPerSide,
    slippageBpsPerSide:
      input?.slippageBpsPerSide ?? DEFAULT_FOUNDATION_COST.slippageBpsPerSide,
    impactBpsPerSide:
      input?.impactBpsPerSide ?? DEFAULT_FOUNDATION_COST.impactBpsPerSide,
    stampDutyBps: input?.stampDutyBps ?? DEFAULT_FOUNDATION_COST.stampDutyBps,
  };
}

export function buyAdjustedPrice(
  rawPrice: number,
  cost: FoundationCostConfig
): number {
  return (
    rawPrice *
    (1 +
      (cost.commissionBpsPerSide +
        cost.slippageBpsPerSide +
        cost.impactBpsPerSide) /
        10_000)
  );
}

export function sellAdjustedPrice(
  rawPrice: number,
  cost: FoundationCostConfig
): number {
  return (
    rawPrice *
    (1 -
      (cost.commissionBpsPerSide +
        cost.slippageBpsPerSide +
        cost.impactBpsPerSide +
        cost.stampDutyBps) /
        10_000)
  );
}

export function netReturn(
  entryOpen: number,
  exitPrice: number,
  cost: FoundationCostConfig
): number {
  return sellAdjustedPrice(exitPrice, cost) / buyAdjustedPrice(entryOpen, cost) - 1;
}
