/**
 * STEP 14 / C-14.3 — 执行与约束模型：组合式声明层类型契约（不可变、可序列化、可校验）。
 *
 * 背景：STEP 8（server/backtest/execution.ts + marketRules.ts）已覆盖执行模型工厂
 * （NEXT_OPEN/NEXT_CLOSE/VWAP_PROXY/LIMIT_PRICE）与 A 股规则注入（T+1、一手股数、
 * 板块涨跌停、涨跌停拦截开关）；C-14.1（server/research/simulator/）已覆盖多日模拟
 * 编排（plan 预算/冻结顺延/股数舍入 + engine 复用 STEP 8 Portfolio/Execution 原语）。
 * 本目录（executionConstraints）是研究链路侧「执行与约束」的**组合式声明与校验层**
 * —— 把「初始资金 / 最大持仓数 / 单标的仓位上限 / 总仓位上限 / 手数 / 买卖限制 /
 * 成交时机 / 订单约束 / 市场规则显式声明」统一进一份结构化 schema：
 *
 *   - 可校验：validate 返回结构化 issue（资金非正、仓位上限不在 (0,1]、上限互相冲突、
 *     非法执行模型 id、禁买禁卖列表非规范序、规则/声明字面量被篡改等），不抛裸错；
 *   - 可序列化：canonical JSON（键字典序）+ sha256 fingerprint，round-trip 复核；
 *   - 可映射：map 把「研究链当前可执行子集」翻译成 C-14.1 SimulationConfig
 *     （import 只读复用 simulator/STEP 8，不自造执行内核），并对「声明但 C-14.1 链
 *     尚不能执行」的约束轴显式报 blocker——绝不静默丢弃（详见 map.ts 头注释）。
 *
 * 边界铁律：
 *   - 只读复用既有实现，不重写 STEP 8 execution/marketRules、不重写 C-14.1 simulator；
 *   - 成本模型六字段属 C-14.2 边界，本层**不声明 cost**，仅在映射时接收外部 CostModel
 *     并写回本层拥有的手数(lotSize)字段（接缝说明见 map.ts）；
 *   - 成交时机值域 = STEP 8 ExecutionModelId 四枚举，研究链**不发明新时机**
 *     （如「开盘后 N 分钟」需分钟级数据、「收盘集合竞价」需集合竞价价，均超出
 *     C-12.6 ResearchDataset 日线行域，声明即伪造，故不引入）；
 *   - 确定性：无 Date.now / Math.random / IO；本目录全部为纯函数与纯数据。
 */

import type { ExecutionModelId } from "../../backtest/types";
import type { SecurityBoard } from "../simulator/types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化/反序列化判别，防止类型混淆）。 */
export const EXECUTION_CONSTRAINT_DECLARATION_KIND = "EXECUTION_CONSTRAINT_DECLARATION" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const EXECUTION_CONSTRAINT_DECLARATION_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 值域常量
// ---------------------------------------------------------------------------

/** 一手默认股数（对齐 STEP 8 DEFAULT_MARKET_RULES.lotSize = 100）。 */
export const DEFAULT_LOT_SIZE = 100 as const;

/** 默认方向策略（研究链当前仅支持 longOnly；A 股无做空）。 */
export const DEFAULT_DIRECTION_POLICY = "longOnly" as const;

// ---------------------------------------------------------------------------
// 声明式类型
// ---------------------------------------------------------------------------

/**
 * 研究链市场规则显式声明（字面量 = 研究链当前硬编码语义的**守卫**）。
 *
 * 这些值不在 C-14.1 SimulationConfig 中可配置（引擎固定采用），本层把它们显式
 * 声明为字面量：反序列化/运行时若出现非字面量值（如 tPlus1=false、point=open），
 * 校验即报 issue——防止「声明某约束却实际跑出另一种语义」的静默失配。
 */
export interface MarketRuleClaims {
  /** T+1：当日买入次一交易日方可卖出（STEP 8 DEFAULT_MARKET_RULES.tPlus1=true）。 */
  readonly tPlus1: true;
  /** 决策时点：候选在决策日收盘后产出，订单最早执行时点为下一交易日。 */
  readonly decisionPoint: "close";
  /** 方向策略：研究链仅支持 longOnly。 */
  readonly directionPolicy: "longOnly";
  /** 停牌口径：执行日无行情行（非 universe 成员/停牌）→ 整单拒绝 SUSPENDED，不顺延。 */
  readonly suspensionMode: "REJECT_NO_BAR";
  /** 公司行为口径：研究链暂不应用（价格收益含除权跳空，对齐 C-14.1 快照）。 */
  readonly corporateActions: "NOT_APPLIED";
  /**
   * 板块覆盖（securityId → board，决定该标的涨跌停幅度解析：main ±10% /
   * gem·star ±20% / bse ±30%）；缺省按 main ±10% 处理（对齐 dataset 行不含 board）。
   * 空对象 = 无覆盖。键不要求排序（canonical JSON 序列化不受键序影响）。
   */
  readonly boards: Readonly<Record<string, SecurityBoard>>;
}

/** 仓位约束轴（声明语义见各字段注释；可执行性矩阵见 map.ts）。 */
export interface PositionConstraints {
  /**
   * 并发持仓数上限；null = 不限。
   * C-14.1 链**已可执行**（simConfig.maxPositions，plan 层拦截超限候选）。
   */
  readonly maxPositionCount: number | null;
  /**
   * 单标的权益占比上限 ∈ (0,1]（每只持仓市值 ≤ cap × 组合权益）；null = 不限。
   * ⚠ C-14.1 链**不可执行**：simulator plan 按当日候选权重×可用现金分配预算，
   * 无逐仓市值/权益闸门。声明后映射即报 blocker，禁止冒充已执行。
   */
  readonly perSecurityEquityCap: number | null;
  /**
   * 总持仓权益占比上限 ∈ (0,1]；null = 不限。
   * ⚠ C-14.1 链**不可执行**（同上：无总仓位市值闸门）。
   */
  readonly totalEquityCap: number | null;
}

/** 买卖限制（规则式 + 标的集式）。 */
export interface BuySellRestrictions {
  /** 买入订单在开盘触及涨停时拒绝（对齐 STEP 8 ExecutionRuleSet.blockLimitUpBuy）。 */
  readonly blockLimitUpBuy: boolean;
  /** 卖出订单在开盘触及跌停时拒绝（对齐 STEP 8 ExecutionRuleSet.blockLimitDownSell）。 */
  readonly blockLimitDownSell: boolean;
  /**
   * 禁买标的 securityId 列表（**升序去重**，空 = 无禁买）。
   * ⚠ C-14.1 链**不可执行**：候选意图一旦入选即进入计划层，无标的级过滤点；
   *   非空时映射报 blocker。规则式拦截（涨停）已由 blockLimitUpBuy 覆盖。
   */
  readonly buyBanned: readonly string[];
  /**
   * 禁卖标的 securityId 列表（升序去重，空 = 无禁卖）。
   * ⚠ C-14.1 链**不可执行**（同理）；非空时映射报 blocker。
   */
  readonly sellBanned: readonly string[];
}

/** 成交时机与订单约束。 */
export interface TimingOrderConstraints {
  /**
   * 成交时机：值域 = STEP 8 ExecutionModelId（NEXT_OPEN / NEXT_CLOSE / VWAP_PROXY /
   * LIMIT_PRICE）。研究链**不新增**时机枚举；LIMIT_PRICE 在 C-14.1 链为「声明但
   * 不可执行」（计划层只发市价单，见 map.ts），值域校验仍放行（尊重 STEP 8 枚举）。
   */
  readonly executionModel: ExecutionModelId;
  /** 是否允许部分成交（缺省 false：全额成交或整单拒绝）。 */
  readonly allowPartialFill: boolean;
}

/**
 * 执行与约束组合声明（C-14.3 交付的「研究运行前必须讲清的成交假设」）。
 *
 * 组成：
 *   - capital        初始资金（研究链路执行的核心会计起点）；
 *   - positions      仓位约束（并发持仓数 / 单标的占比 / 总占比）；
 *   - lot            一手股数（STEP 8/引擎 成交股数舍入的粒度；映射写回 cost.lotSize）；
 *   - restrictions   买卖限制（涨跌停拦截规则 + 禁买/禁卖标的集）；
 *   - timing         成交时机 + 部分成交订单约束；
 *   - marketClaims   研究链硬编码市场语义的字面量声明（防静默失配守卫）。
 *
 * 铁律：全部字段 readonly；构造见 factory.ts（含默认值 + 列表规范化升序去重）；
 * 内容规范形由 validate.ts 把关（含反序列化复核）；可执行性子集映射见 map.ts。
 */
export interface ExecutionConstraintDeclaration {
  readonly recordKind: typeof EXECUTION_CONSTRAINT_DECLARATION_KIND;
  readonly recordVersion: typeof EXECUTION_CONSTRAINT_DECLARATION_VERSION;
  /** 可选标识/备注（仅审计用途，不参与计算）。 */
  readonly label?: string;

  readonly capital: {
    /** 初始资金（元，>0）。 */
    readonly initialCapital: number;
  };

  readonly positions: PositionConstraints;

  readonly lot: {
    /** 一手股数（正整数；默认 100，对齐 A 股整手交易）。 */
    readonly lotSize: number;
  };

  readonly restrictions: BuySellRestrictions;

  readonly timing: TimingOrderConstraints;

  readonly marketClaims: MarketRuleClaims;
}
