/**
 * EVENT-STATE-LONG · 强势继续持有实验臂 —— 臂文档构建与**执行前**校验（默认 dry-run）。
 *
 * 🔴 **仓位口径（用户 2026-10-10 裁定）**：改成 `EQUITY_RATIO`（每笔 = **当日总权益 × 1/180**）。
 *    原 `FIXED_RATIO` 的引擎语义是 `初始资金 × 1/180` ⇒ 每笔恒为 ¥5,555.56（权益涨到 165 万也不放大），
 *    即「固定仓位」；用户要求改为「固定仓位比例」。这**改动了冻结规格 §3**（§3 原文：
 *    「初始资本固定比例 1/180 … 不按当日权益复利」）⇒ 已跑的 A/C′ 臂作废，三臂必须重发版本重跑。
 *
 * 臂链（结构变化走 major bump，且落到**未占用**版本号；`2.0.0` 与既有臂版本一律不动）：
 *   `2.0.0`（历史控制，FIXED_RATIO）
 *     --major--> **A″ `7.0.0`**：仓位改 `EQUITY_RATIO`；退出仍为 rule-list `TIME_EXIT 40`（无 policy）
 *     --major--> **C″ `8.0.0`**：+ `exitPolicy`（6% 止损 + timeExit 40 + `strongHold: null`）
 *     --major--> **B″ `9.0.0`**：+ `strongHold{ 第40日, 收益≥3%, >MA5&MA10, 延到第60日 }`
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongStrongHoldArms.mts            # dry-run：只校验
 *   node node_modules/tsx/dist/cli.mjs tests/tools/eventStateLongStrongHoldArms.mts --persist  # 落库新版本
 */
import 'dotenv/config';
import fs from 'node:fs';
import { cloneStrategyDocument, cloneStrategyDocumentToVersion } from '../../server/research/strategySchema/map';
import { exitPolicyDefinitionErrors } from '../../server/research/exitPolicyCommon';
import { StrategyService } from '../../server/research/strategyPersistence/service';
import { DbStrategyRepository } from '../../server/research/strategyPersistence/db';
import { assembleRunWorkbenchInputs } from '../../server/runWorkbenchAssembly/assemble';

const STRATEGY_ID = 'event-state-long-maxamp5-top3';
const BASE_VERSION = '2.0.0';
const CODE_VERSION = '1.0.0+gf8b6810.dirty';
const PERSIST = process.argv.includes('--persist');

/** 6% 止损（沿用 3F 校准）。 */
const STOP_6PCT = {
  anchor: { kind: 'FIXED_PERCENT' as const, stopRatio: 0.06 },
  confirmation: 'INTRADAY' as const,
};

/** 强势续持：第 40 个持有日收益 ≥3% 且收盘同时高于 MA5/MA10 ⇒ 延长到第 60 日。 */
const STRONG_HOLD_40_TO_60 = {
  atHoldingDays: 40,
  minReturnRatio: 0.03,
  requireAboveMa5: true,
  requireAboveMa10: true,
  extendToHoldingDays: 60,
  afterExtendedHold: 'TIME_EXIT' as const,
};

/** 用 policy 表达退出时，规则**不得**同时声明 threshold/parameter/thresholdUnit（既有校验器要求）。 */
function unifiedPolicyRule(policy: unknown): unknown {
  return {
    id: 'exit-unified-policy',
    type: 'TIME_EXIT',
    trigger: 'ON_CLOSE',
    enabled: true,
    priority: 0,
    description: '统一退出策略：止损 / 时间退出 / strongHold 由 policy 配置表达',
    policy,
  };
}

const STOP_ONLY_POLICY = {
  stop: STOP_6PCT,
  takeProfit: null,
  timeExit: { kind: 'FIXED_HOLDING_DAYS', holdingDays: 40 },
  strongHold: null,
  capitalRecycle: null,
};

const STOP_PLUS_STRONG_HOLD_POLICY = {
  stop: STOP_6PCT,
  takeProfit: null,
  timeExit: { kind: 'FIXED_HOLDING_DAYS', holdingDays: 40 },
  strongHold: STRONG_HOLD_40_TO_60,
  capitalRecycle: null,
};

type Definition = Record<string, unknown>;

const STEPS = [
  {
    key: 'A2',
    targetVersion: '7.0.0',
    label: '控制臂 A″（EQUITY_RATIO 1/180，退出不变：rule-list TIME_EXIT 40）',
    /** 只改 `position.sizingMethod`；`positionRatio` 已是 1/180，其余 position 字段原样保留。 */
    patch: (def: Definition) => ({
      position: { ...(def.position as Record<string, unknown>), sizingMethod: 'EQUITY_RATIO' },
    }),
    /** 控制臂不引入 policy，故没有 policy 可校验。 */
    policy: null,
  },
  {
    key: 'C2',
    targetVersion: '8.0.0',
    label: '止损臂 C″（EQUITY_RATIO + 6% 止损，无强势续持）',
    patch: (def: Definition) => ({
      exit: { ...(def.exit as Record<string, unknown>), rules: [unifiedPolicyRule(STOP_ONLY_POLICY)] },
    }),
    policy: STOP_ONLY_POLICY,
  },
  {
    key: 'B2',
    targetVersion: '9.0.0',
    label: '强势续持臂 B″（同 C″ + 第40日强势则延到第60日）',
    patch: (def: Definition) => ({
      exit: { ...(def.exit as Record<string, unknown>), rules: [unifiedPolicyRule(STOP_PLUS_STRONG_HOLD_POLICY)] },
    }),
    policy: STOP_PLUS_STRONG_HOLD_POLICY,
  },
] as const;

/** 按谱系顺序构建全部臂。 */
function buildArmChain(baseDoc: Record<string, unknown>): readonly { key: string; label: string; policy: unknown; document: Record<string, unknown> }[] {
  const out: { key: string; label: string; policy: unknown; document: Record<string, unknown> }[] = [];
  let parent = baseDoc;
  for (const step of STEPS) {
    const parentDefinition = parent.definition as Definition;
    const patched = cloneStrategyDocument(
      parent as never,
      { definition: { ...parentDefinition, ...step.patch(parentDefinition) } } as never,
      'major',
    ) as unknown as Record<string, unknown>;
    // 落到未占用版本号（内容不变，指纹按新版本号重算）
    const cloned = cloneStrategyDocumentToVersion(patched as never, step.targetVersion) as unknown as Record<string, unknown>;
    out.push({ key: step.key, label: step.label, policy: step.policy, document: cloned });
    parent = cloned;
  }
  return out;
}

async function main(): Promise<void> {
  const repo = new DbStrategyRepository();
  const service = new StrategyService(repo, { codeVersion: CODE_VERSION });
  const base = await service.loadVersion(STRATEGY_ID, BASE_VERSION);
  const baseDoc = base.strategy as unknown as Record<string, unknown>;
  const baseDefinition = baseDoc.definition as Definition;
  console.log(`[arms] base=${STRATEGY_ID}@${BASE_VERSION} fingerprint=${String((baseDoc as { fingerprint?: string }).fingerprint ?? null)}`);
  console.log(`[arms] base sizingMethod=${String((baseDefinition.position as Record<string, unknown>).sizingMethod)} positionRatio=${String((baseDefinition.position as Record<string, unknown>).positionRatio)}`);

  const chain = buildArmChain(baseDoc);
  const report: unknown[] = [];
  for (const { key, label, policy, document: cloned } of chain) {
    const definition = cloned.definition as Definition;
    const position = definition.position as Record<string, unknown>;
    const exitRules = (definition.exit as { rules: readonly { policy?: unknown }[] }).rules;
    const rulePolicy = exitRules[0]?.policy ?? null;
    const policyErrors = rulePolicy === null
      ? (policy === null ? [] : ['policy 缺失'])
      : exitPolicyDefinitionErrors(rulePolicy);

    const strip = (exit: unknown) => {
      const { rules: _rules, ...rest } = (exit ?? {}) as Record<string, unknown>;
      return JSON.stringify(rest);
    };
    const entry = {
      arm: key,
      label,
      version: cloned.version,
      fingerprint: cloned.fingerprint,
      policyErrors,
      sizingMethod: position.sizingMethod,
      positionRatio: position.positionRatio,
      maxPositions: position.maxPositions,
      candidateExitPolicy: (definition.exit as { candidateExitPolicy?: unknown }).candidateExitPolicy ?? null,
      strongHold: (rulePolicy as { strongHold?: unknown } | null)?.strongHold ?? null,
      frozenUnchanged: {
        datasets: JSON.stringify(cloned.datasets) === JSON.stringify(baseDoc.datasets),
        entry: JSON.stringify(definition.entry) === JSON.stringify(baseDefinition.entry),
        execution: JSON.stringify(definition.execution) === JSON.stringify(baseDefinition.execution),
        /** `exit` 除 `rules` 外的兄弟字段（尤其 `candidateExitPolicy`）必须与基座一致。 */
        exitSiblings: strip(definition.exit) === strip(baseDefinition.exit),
      },
    };
    report.push(entry);
    console.log('[arms] ' + JSON.stringify(entry, null, 1));
  }

  fs.writeFileSync('_scratch/goalStrongHoldArms.json', JSON.stringify({ baseVersion: BASE_VERSION, report }, null, 2) + '\n');

  // 执行前校验：正式装配必须接受臂文档，且 simConfig 必须真的带上仓位口径与 policy
  for (const { key, document: cloned } of chain) {
    const built = await assembleRunWorkbenchInputs({
      strategyDocument: cloned as never,
      strategyId: STRATEGY_ID,
      strategyVersion: String(cloned.version),
      startDate: '2026-01-29',
      endDate: '2026-03-31',
      datasetVersionId: 780005,
      dataReady: true,
      codeVersion: CODE_VERSION,
      createdAt: '2026-10-10T00:00:00.000Z',
    } as never);
    const side = built.side as unknown as { simulationConfig?: Record<string, unknown>; positionSizing?: unknown };
    const simConfig = side.simulationConfig ?? {};
    console.log(`[arms] arm ${key} assemble OK engine=${built.assembly.strategyDecisionEngine}` +
      ` positionSizing=${JSON.stringify(side.positionSizing ?? null)}` +
      ` exitPolicy=${JSON.stringify(simConfig.exitPolicy ?? null).slice(0, 260)}`);
  }

  if (PERSIST) {
    for (const { key, document: cloned } of chain) {
      const saved = await service.save({ document: cloned } as never);
      console.log(`[arms] persisted arm ${key} version=${String(cloned.version)} fingerprint=${String((saved as { fingerprint?: string }).fingerprint ?? '')}`);
    }
  } else {
    console.log('[arms] DRY_RUN 完成（未写库；加 --persist 才落库）');
  }
  process.exit(0);
}
main().catch((e) => { console.error((e as Error).stack ?? String(e)); process.exit(1); });
