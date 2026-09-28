/**
 * 3F TopN 留档成本拆解：按真实成交明细重算现金费用与滑点。
 *
 * 只读运行结果，不重跑回测。输出当前成本、成本占亏损比例，以及三组
 * 更接近常见零售/机构执行口径的反事实成本。
 *
 * 用法：
 *   npx tsx scripts/analyze3FTopNCosts.mts --topn 3 --backtest-id 810001
 *   npx tsx scripts/analyze3FTopNCosts.mts --topn 5 --backtest-id 840001
 */

import "dotenv/config";
import {
  getClosedLoopBacktestRun,
  listClosedLoopBacktestRuns,
} from "../server/closedLoopBacktestRun/repository";
import { withReadRetry } from "../server/readRetry";

type Trade = {
  entryTime: string;
  exitTime: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  grossPnL: number | null;
  fees: number;
  slippageAmount: number;
  netPnl: number | null;
  openAtEnd: boolean;
};

type CostSummary = {
  buyCommission: number;
  sellCommission: number;
  stampDuty: number;
  transferFee: number;
  slippage: number;
  otherFees: number;
  totalFees: number;
  totalCost: number;
};

type Scenario = {
  name: string;
  commissionRate: number;
  minCommission: number;
  dateAwareRegulatoryFees: boolean;
  stampDutyRate: number;
  transferFeeRate: number;
  slippageBpsPerSide: number;
};

function optionValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function printCostSummary(summary: CostSummary | null): void {
  if (summary === null) {
    console.log("留档没有成本汇总，按逐笔成交重算。");
    return;
  }
  console.log("\n留档成本汇总");
  console.log(`买入佣金: ${summary.buyCommission.toFixed(2)}`);
  console.log(`卖出佣金: ${summary.sellCommission.toFixed(2)}`);
  console.log(`印花税:   ${summary.stampDuty.toFixed(2)}`);
  console.log(`过户费:   ${summary.transferFee.toFixed(2)}`);
  console.log(`滑点:     ${summary.slippage.toFixed(2)}`);
  console.log(`现金费用: ${summary.totalFees.toFixed(2)}`);
  console.log(`总成本:   ${summary.totalCost.toFixed(2)}`);
}

function parseResult(result: unknown): {
  costs: CostSummary | null;
  trades: Trade[];
} {
  if (!isRecord(result) || !Array.isArray(result.stages))
    return { costs: null, trades: [] };
  const backtest = result.stages.find(
    stage => isRecord(stage) && stage.stageId === "backtest"
  );
  const output =
    isRecord(backtest) && isRecord(backtest.output) ? backtest.output : null;
  if (output === null) return { costs: null, trades: [] };

  const rawTrades = Array.isArray(output.trades) ? output.trades : [];
  const trades = rawTrades
    .filter(
      (trade): trade is Trade =>
        isRecord(trade) &&
        typeof trade.entryTime === "string" &&
        (trade.exitTime === null || typeof trade.exitTime === "string") &&
        typeof trade.entryPrice === "number" &&
        (trade.exitPrice === null || typeof trade.exitPrice === "number") &&
        typeof trade.quantity === "number"
    )
    .map(trade => ({
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      quantity: trade.quantity,
      grossPnL: numberOrNull(trade.grossPnL),
      fees:
        typeof trade.fees === "number" && Number.isFinite(trade.fees)
          ? trade.fees
          : 0,
      slippageAmount:
        typeof trade.slippageAmount === "number" &&
        Number.isFinite(trade.slippageAmount)
          ? trade.slippageAmount
          : 0,
      netPnl: numberOrNull(trade.netPnl),
      openAtEnd: trade.openAtEnd === true,
    }));

  const costsRecord = isRecord(output.costs) ? output.costs : null;
  const costs =
    costsRecord === null
      ? null
      : {
          buyCommission: numberOrNull(costsRecord.buyCommission) ?? 0,
          sellCommission: numberOrNull(costsRecord.sellCommission) ?? 0,
          stampDuty: numberOrNull(costsRecord.stampDuty) ?? 0,
          transferFee: numberOrNull(costsRecord.transferFee) ?? 0,
          slippage: numberOrNull(costsRecord.slippage) ?? 0,
          otherFees: numberOrNull(costsRecord.otherFees) ?? 0,
          totalFees: numberOrNull(costsRecord.totalFees) ?? 0,
          totalCost: numberOrNull(costsRecord.totalCost) ?? 0,
        };
  return { costs, trades };
}

function commission(
  grossAmount: number,
  rate: number,
  minimum: number
): number {
  return Math.max(minimum, grossAmount * rate);
}

function counterfactualCost(
  trade: Trade,
  scenario: Scenario
): {
  buyAmount: number;
  sellAmount: number;
  fees: number;
} {
  const buyAmount = trade.entryPrice * trade.quantity;
  const sellAmount = (trade.exitPrice ?? trade.entryPrice) * trade.quantity;
  const stampDutyRate =
    scenario.dateAwareRegulatoryFees &&
    (trade.exitTime ?? trade.entryTime) >= "2023-08-28"
      ? 0.0005
      : scenario.stampDutyRate;
  const transferFeeRate =
    scenario.dateAwareRegulatoryFees &&
    (trade.exitTime ?? trade.entryTime) >= "2022-04-29"
      ? 0.00001
      : scenario.transferFeeRate;
  const fees =
    commission(buyAmount, scenario.commissionRate, scenario.minCommission) +
    commission(sellAmount, scenario.commissionRate, scenario.minCommission) +
    sellAmount * stampDutyRate +
    (buyAmount + sellAmount) * transferFeeRate;
  return { buyAmount, sellAmount, fees };
}

async function main(): Promise<void> {
  const topN = Number(optionValue("--topn") ?? "3");
  const requestedBacktestId = Number(optionValue("--backtest-id") ?? "0");
  const requestedRunId = optionValue("--run-id");
  const strategyId = `first-limit-pullback-3f-top${topN}`;

  let selected =
    Number.isInteger(requestedBacktestId) && requestedBacktestId > 0
      ? await withReadRetry(`3F Top${topN} 留档 #${requestedBacktestId}`, () =>
          getClosedLoopBacktestRun(requestedBacktestId)
        )
      : null;
  if (selected === null) {
    const history = await withReadRetry(`3F Top${topN} 留档列表`, () =>
      listClosedLoopBacktestRuns({ strategyId, limit: 100 })
    );
    const listed =
      requestedRunId === null
        ? history[0]
        : history.find(record => record.runId === requestedRunId);
    if (listed === undefined)
      throw new Error(`未找到 ${strategyId} 的回测留档`);
    selected = await withReadRetry(`3F Top${topN} 留档 #${listed.id}`, () =>
      getClosedLoopBacktestRun(listed!.id)
    );
  }
  if (selected === null || selected.result === null) {
    throw new Error("未找到完整回测留档");
  }
  if (selected.strategyId !== strategyId) {
    throw new Error(
      `留档策略是 ${selected.strategyId}，不是请求的 ${strategyId}`
    );
  }

  const { costs, trades } = parseResult(selected.result);
  const completed = trades.filter(
    trade => !trade.openAtEnd && trade.exitPrice !== null
  );
  const totalBuyAmount = completed.reduce(
    (sum, trade) => sum + trade.entryPrice * trade.quantity,
    0
  );
  const totalSellAmount = completed.reduce(
    (sum, trade) => sum + trade.exitPrice! * trade.quantity,
    0
  );
  const totalFees =
    costs?.totalFees ?? completed.reduce((sum, trade) => sum + trade.fees, 0);
  const totalSlippage = costs?.slippage ?? 0;
  const totalActualCost = costs?.totalCost ?? totalFees + totalSlippage;
  const totalNetPnl = completed.reduce(
    (sum, trade) => sum + (trade.netPnl ?? 0),
    0
  );
  const totalGrossPnl = totalNetPnl + totalFees + totalSlippage;
  const actualCostBpsOnEntry =
    totalBuyAmount === 0 ? null : (totalActualCost / totalBuyAmount) * 10_000;
  const oneWayNotional = totalBuyAmount + totalSellAmount;
  const actualCostBpsOnOneWay =
    oneWayNotional === 0 ? null : (totalActualCost / oneWayNotional) * 10_000;

  console.log(`3F Top${topN} 成本诊断`);
  console.log(`backtestId: ${selected.id}`);
  console.log(`runId: ${selected.runId}`);
  console.log(`strategyVersion: ${selected.strategyVersion}`);
  console.log(
    `完成交易: ${completed.length}；期末未平仓: ${trades.length - completed.length}`
  );
  printCostSummary(costs);
  console.log(
    `\n留档实际: 费用 ${totalFees.toFixed(2)} + 滑点 ${totalSlippage.toFixed(2)} = ` +
      `${totalActualCost.toFixed(2)}`
  );
  console.log(
    `成本/买入名义: ${actualCostBpsOnEntry?.toFixed(2) ?? "-"} bps；` +
      `成本/单边总成交: ${actualCostBpsOnOneWay?.toFixed(2) ?? "-"} bps`
  );
  console.log(
    `还原毛利 ${totalGrossPnl.toFixed(2)}，净利 ${totalNetPnl.toFixed(2)}；` +
      `成本占最终亏损绝对值 ` +
      `${totalNetPnl < 0 ? ((totalActualCost / Math.abs(totalNetPnl)) * 100).toFixed(2) : "-"}%`
  );
  console.log(
    `平均每笔: 买入名义 ${(totalBuyAmount / completed.length).toFixed(2)} 元；` +
      `毛利 ${(totalGrossPnl / completed.length).toFixed(2)} 元/笔；` +
      `成本 ${(totalActualCost / completed.length).toFixed(2)} 元/笔；` +
      `净利 ${(totalNetPnl / completed.length).toFixed(2)} 元/笔`
  );

  const scenarios: readonly Scenario[] = [
    {
      name: "当前口径",
      commissionRate: 0.0003,
      minCommission: 5,
      dateAwareRegulatoryFees: false,
      stampDutyRate: 0.001,
      transferFeeRate: 0.00001,
      slippageBpsPerSide: 10,
    },
    {
      name: "常见零售：佣金 2.5bp / 滑点 5bp",
      commissionRate: 0.00025,
      minCommission: 5,
      dateAwareRegulatoryFees: true,
      stampDutyRate: 0.001,
      transferFeeRate: 0.00002,
      slippageBpsPerSide: 5,
    },
    {
      name: "低佣账户：佣金 1.5bp / 滑点 5bp",
      commissionRate: 0.00015,
      minCommission: 5,
      dateAwareRegulatoryFees: true,
      stampDutyRate: 0.001,
      transferFeeRate: 0.00002,
      slippageBpsPerSide: 5,
    },
    {
      name: "理想执行：佣金 1bp / 滑点 3bp",
      commissionRate: 0.0001,
      minCommission: 5,
      dateAwareRegulatoryFees: true,
      stampDutyRate: 0.001,
      transferFeeRate: 0.00002,
      slippageBpsPerSide: 3,
    },
  ];

  console.log(
    "\n成本情形 | 总成本 | 较当前节省 | 成本/买入名义 | 调整后净利合计"
  );
  console.log("--- | ---: | ---: | ---: | ---:");
  for (const scenario of scenarios) {
    let scenarioFees = 0;
    for (const trade of completed) {
      const cost = counterfactualCost(trade, scenario);
      scenarioFees += cost.fees;
    }
    const scenarioSlippage = totalSlippage * (scenario.slippageBpsPerSide / 10);
    const scenarioCost = scenarioFees + scenarioSlippage;
    const adjustedNetPnl = totalGrossPnl - scenarioCost;
    console.log(
      `${scenario.name} | ${scenarioCost.toFixed(2)} | ` +
        `${(totalActualCost - scenarioCost).toFixed(2)} | ` +
        `${totalBuyAmount === 0 ? "-" : ((scenarioCost / totalBuyAmount) * 10_000).toFixed(2)} bps | ` +
        `${adjustedNetPnl.toFixed(2)}`
    );
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
);
