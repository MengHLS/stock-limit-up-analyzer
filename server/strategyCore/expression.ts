/**
 * STRATEGY-ARCH-001 — 值表达式（规格 §9「Derived expression」+ §5 右值能力）。
 *
 * 解决的问题（对照 legacy）：legacy `ConditionDefinition.valueType` 只有
 * `CONSTANT | FIELD_REFERENCE | PARAMETER_REFERENCE` 三值、**没有算术形态** ⇒
 * `volume > MA5Volume * 2` / `prefix.rd0.open * (1 - drawdown)` 这类写法**根本写不下**，
 * 只能降级成字符串常量（BRIDGE-CONDITION-EXPRESSION-001 实测过该静默降级）。
 *
 * 本模块给出**结构化**的值表达式：
 *
 *   ValueExpression
 *   ├── CONSTANT           常量（number | string | boolean | null）
 *   ├── FIELD_REFERENCE    数据集字段引用（形态沿用 legacy 唯一权威：`prefix.rd0.open` / `bar.low` / `event.x`）
 *   ├── FEATURE_REFERENCE  注册表里的特征 id（由 FeatureRegistry 求值）
 *   ├── PARAMETER_REFERENCE 参数 code（由 ParameterResolver 求值）
 *   ├── BINARY             `+ - * /`（除法除零 ⇒ 响亮抛错，不返回 Infinity/NaN）
 *   ├── NEGATE             一元负号
 *   └── ARRAY              常量数组（供 `IN` / `NOT_IN`）
 *
 * 另提供 **文本解析器** `parseExpression`（递归下降），把 legacy 的 `derivedFrom`
 * 自由文本（如 `maxPositions * positionRatio` / `referencePrice * (1 - drawdown)`）
 * 机械翻译成结构化表达式；解析失败 ⇒ 抛 `PARAMETER_DERIVED_UNPARSEABLE`（**不猜**）。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random；确定性。
 */

import {
  StrategyCoreError,
  validationIssue,
  type CoreValidationIssue,
  type CoreValue,
} from "./types";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export const BINARY_OPERATORS = ["+", "-", "*", "/"] as const;
export type BinaryOperator = (typeof BINARY_OPERATORS)[number];

export type ValueExpression =
  | { readonly kind: "CONSTANT"; readonly value: CoreValue }
  | { readonly kind: "FIELD_REFERENCE"; readonly field: string }
  | { readonly kind: "FEATURE_REFERENCE"; readonly featureId: string }
  | { readonly kind: "PARAMETER_REFERENCE"; readonly code: string }
  | {
      readonly kind: "BINARY";
      readonly operator: BinaryOperator;
      readonly left: ValueExpression;
      readonly right: ValueExpression;
    }
  | { readonly kind: "NEGATE"; readonly operand: ValueExpression }
  | { readonly kind: "ARRAY"; readonly items: readonly CoreValue[] };

/** 构造助手（保持调用点可读）。 */
export const Expr = {
  constant: (value: CoreValue): ValueExpression => ({ kind: "CONSTANT", value }),
  field: (field: string): ValueExpression => ({ kind: "FIELD_REFERENCE", field }),
  feature: (featureId: string): ValueExpression => ({ kind: "FEATURE_REFERENCE", featureId }),
  param: (code: string): ValueExpression => ({ kind: "PARAMETER_REFERENCE", code }),
  binary: (operator: BinaryOperator, left: ValueExpression, right: ValueExpression): ValueExpression => ({
    kind: "BINARY",
    operator,
    left,
    right,
  }),
  negate: (operand: ValueExpression): ValueExpression => ({ kind: "NEGATE", operand }),
  array: (items: readonly CoreValue[]): ValueExpression => ({ kind: "ARRAY", items }),
} as const;

// ---------------------------------------------------------------------------
// 求值
// ---------------------------------------------------------------------------

/** 求值作用域（三类符号各自的读取函数；由 Runtime 装配）。 */
export interface ExpressionScope {
  /** 字段引用求值（`prefix.rd0.open` / `bar.low` / `event.limitUpPrice`）。 */
  readonly fieldValue: (field: string) => CoreValue;
  /** 特征引用求值（注册表特征 id）。 */
  readonly featureValue: (featureId: string) => CoreValue;
  /** 参数引用求值（**已解析**的 ResolvedParameterSet）。 */
  readonly parameterValue: (code: string) => CoreValue;
}

function isNumeric(value: CoreValue): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireNumeric(value: CoreValue, operator: BinaryOperator, side: "left" | "right"): number {
  if (!isNumeric(value)) {
    throw new StrategyCoreError(
      "EXPRESSION_INVALID",
      "算术运算 " + operator + " 的 " + side + " 侧不是有限数字（实际 " + JSON.stringify(value) + "）",
    );
  }
  return value;
}

/**
 * 求值（遵循「算术只接受有限数字」）：
 *   - `+`：两侧均为 number ⇒ 数值加；否则若至少一侧是 string ⇒ 字符串拼接（显式、可预期）；
 *   - `- * /`：两侧必须 number；
 *   - `/` 除零 ⇒ 抛 `EXPRESSION_DIVISION_BY_ZERO`（**不返回 Infinity**）。
 */
export function evaluateExpression(expr: ValueExpression, scope: ExpressionScope): CoreValue {
  switch (expr.kind) {
    case "CONSTANT":
      return expr.value;
    case "ARRAY":
      // 数组只在 IN / NOT_IN 的右值位置内联处理；作为标量求值没有语义 ⇒ 响亮拒绝，不返回 undefined/null 冒充。
      throw new StrategyCoreError(
        "EXPRESSION_INVALID",
        "常量数组只可用于 IN / NOT_IN 的右值，不能作为标量表达式求值",
      );
    case "FIELD_REFERENCE":
      return scope.fieldValue(expr.field);
    case "FEATURE_REFERENCE":
      return scope.featureValue(expr.featureId);
    case "PARAMETER_REFERENCE":
      return scope.parameterValue(expr.code);
    case "NEGATE": {
      const value = evaluateExpression(expr.operand, scope);
      return -requireNumeric(value, "-", "right");
    }
    case "BINARY": {
      const left = evaluateExpression(expr.left, scope);
      const right = evaluateExpression(expr.right, scope);
      if (expr.operator === "+") {
        if (isNumeric(left) && isNumeric(right)) return left + right;
        return String(left) + String(right);
      }
      const l = requireNumeric(left, expr.operator, "left");
      const r = requireNumeric(right, expr.operator, "right");
      if (expr.operator === "-") return l - r;
      if (expr.operator === "*") return l * r;
      if (r === 0) {
        throw new StrategyCoreError(
          "EXPRESSION_DIVISION_BY_ZERO",
          "表达式除法分母为 0（拒绝返回 Infinity / NaN）",
        );
      }
      return l / r;
    }
  }
}

/** 求值为数组（供 `IN` / `NOT_IN`；非数组 ⇒ 抛错）。 */
export function evaluateExpressionArray(expr: ValueExpression, scope: ExpressionScope): readonly CoreValue[] {
  if (expr.kind === "ARRAY") return expr.items;
  const value = evaluateExpression(expr, scope);
  throw new StrategyCoreError(
    "EXPRESSION_INVALID",
    "IN / NOT_IN 的右值必须是常量数组（ARRAY），实际求值为 " + JSON.stringify(value),
  );
}

// ---------------------------------------------------------------------------
// 引用收集（供 leak / 需求推导 / 指纹使用）
// ---------------------------------------------------------------------------

export function collectFieldReferences(expr: ValueExpression, out: string[] = []): readonly string[] {
  switch (expr.kind) {
    case "FIELD_REFERENCE":
      out.push(expr.field);
      break;
    case "BINARY":
      collectFieldReferences(expr.left, out);
      collectFieldReferences(expr.right, out);
      break;
    case "NEGATE":
      collectFieldReferences(expr.operand, out);
      break;
    default:
      break;
  }
  return out;
}

export function collectFeatureReferences(expr: ValueExpression, out: string[] = []): readonly string[] {
  switch (expr.kind) {
    case "FEATURE_REFERENCE":
      out.push(expr.featureId);
      break;
    case "BINARY":
      collectFeatureReferences(expr.left, out);
      collectFeatureReferences(expr.right, out);
      break;
    case "NEGATE":
      collectFeatureReferences(expr.operand, out);
      break;
    default:
      break;
  }
  return out;
}

export function collectParameterReferences(expr: ValueExpression, out: string[] = []): readonly string[] {
  switch (expr.kind) {
    case "PARAMETER_REFERENCE":
      out.push(expr.code);
      break;
    case "BINARY":
      collectParameterReferences(expr.left, out);
      collectParameterReferences(expr.right, out);
      break;
    case "NEGATE":
      collectParameterReferences(expr.operand, out);
      break;
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/** 表达式校验选项（未知字段 / 未知特征由调用方通过白名单判定函数注入）。 */
export interface ExpressionValidationOptions {
  readonly isKnownField?: (field: string) => boolean;
  readonly isKnownFeature?: (featureId: string) => boolean;
  readonly isKnownParameter?: (code: string) => boolean;
}

export function validateExpression(
  expr: ValueExpression,
  path: string,
  options: ExpressionValidationOptions = {},
): readonly CoreValidationIssue[] {
  const issues: CoreValidationIssue[] = [];
  const walk = (node: ValueExpression, at: string): void => {
    switch (node.kind) {
      case "CONSTANT": {
        const value = node.value;
        if (typeof value === "number" && !Number.isFinite(value)) {
          issues.push(validationIssue("EXPRESSION_INVALID", at, "常量不允许 NaN / Infinity"));
        }
        break;
      }
      case "ARRAY": {
        for (let index = 0; index < node.items.length; index += 1) {
          const item = node.items[index];
          if (typeof item === "number" && !Number.isFinite(item)) {
            issues.push(validationIssue("EXPRESSION_INVALID", at + ".items[" + String(index) + "]", "数组元素不允许 NaN / Infinity"));
          }
        }
        break;
      }
      case "FIELD_REFERENCE": {
        if (options.isKnownField !== undefined && !options.isKnownField(node.field)) {
          issues.push(
            validationIssue(
              "FIELD_REFERENCE_UNKNOWN",
              at,
              "未知字段引用 " + node.field + "（白名单未登记 ⇒ 拒绝，不用模糊匹配放宽）",
            ),
          );
        }
        break;
      }
      case "FEATURE_REFERENCE": {
        if (options.isKnownFeature !== undefined && !options.isKnownFeature(node.featureId)) {
          issues.push(
            validationIssue(
              "FEATURE_NOT_REGISTERED",
              at,
              "特征 " + node.featureId + " 未在 FeatureRegistry 注册",
            ),
          );
        }
        break;
      }
      case "PARAMETER_REFERENCE": {
        if (options.isKnownParameter !== undefined && !options.isKnownParameter(node.code)) {
          issues.push(
            validationIssue("PARAMETER_UNKNOWN", at, "参数 " + node.code + " 未在 parameterSchema 声明"),
          );
        }
        break;
      }
      case "NEGATE":
        walk(node.operand, at + ".operand");
        break;
      case "BINARY":
        walk(node.left, at + ".left");
        walk(node.right, at + ".right");
        break;
    }
  };
  walk(expr, path);
  return issues;
}

// ---------------------------------------------------------------------------
// 文本解析（legacy derivedFrom 兼容）
// ---------------------------------------------------------------------------

type Token =
  | { readonly kind: "number"; readonly text: string }
  | { readonly kind: "ident"; readonly text: string }
  /** 字段引用（`bar.low` / `prefix.rd0.open` / `post.rd3.close` / `event.limitUpPrice`）。 */
  | { readonly kind: "field"; readonly text: string }
  | { readonly kind: "op"; readonly text: string }
  | { readonly kind: "lparen" }
  | { readonly kind: "rparen" };

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/;

/**
 * 字段引用记号（STRATEGY-ARCH-002 追加）。
 *
 * 🔴 为什么要加：库里**真实的**策略文档里存在把字段引用写进表达式文本的情况，例如
 * `definition.entry.conditions[].value = "prefix.rd0.volume * 0.3"`（`valueType` 被标成
 * `CONSTANT`）。没有这条记号，该表达式无法解析 ⇒ 只能退化成「数字与字符串比较」，
 * 语义完全丢失。加它是**阻塞性缺陷修复**，不是语法扩张。
 *
 * 只认四种字段根（与 `fieldReference.ts` 的目录一致）；其余带点写法仍然抛错（不猜）。
 */
const FIELD_REF_RE = /^(?:prefix|post|bar|event)\.[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/;

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const ch = source[index] as string;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      index += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      index += 1;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", text: ch });
      index += 1;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let text = "";
      while (index < source.length) {
        const digit = source[index] as string;
        if ((digit >= "0" && digit <= "9") || digit === ".") {
          text += digit;
          index += 1;
          continue;
        }
        break;
      }
      tokens.push({ kind: "number", text });
      continue;
    }
    const rest = source.slice(index);
    // 字段引用必须**先于** ident 判定（否则 `bar.low` 会被切成人名 `bar` 再在 `.` 处抛错）。
    const field = FIELD_REF_RE.exec(rest);
    if (field !== null && field.index === 0) {
      tokens.push({ kind: "field", text: field[0] });
      index += field[0].length;
      continue;
    }
    const ident = IDENT_RE.exec(rest);
    if (ident !== null && ident.index === 0) {
      tokens.push({ kind: "ident", text: ident[0] });
      index += ident[0].length;
      continue;
    }
    throw new StrategyCoreError(
      "PARAMETER_DERIVED_UNPARSEABLE",
      "表达式含无法识别的字符 " + JSON.stringify(ch) + "（原文：" + source + "）",
    );
  }
  return tokens;
}

/** 解析器（递归下降；`ident` 默认解析为参数引用）。 */
class ExpressionParser {
  private cursor = 0;
  constructor(private readonly tokens: readonly Token[], private readonly source: string) {}

  private peek(): Token | undefined {
    return this.tokens[this.cursor];
  }

  private eat(): Token {
    const token = this.tokens[this.cursor];
    if (token === undefined) {
      throw new StrategyCoreError(
        "PARAMETER_DERIVED_UNPARSEABLE",
        "表达式意外结束（原文：" + this.source + "）",
      );
    }
    this.cursor += 1;
    return token;
  }

  parse(): ValueExpression {
    const node = this.parseAdditive();
    if (this.peek() !== undefined) {
      throw new StrategyCoreError(
        "PARAMETER_DERIVED_UNPARSEABLE",
        "表达式末尾存在多余记号（原文：" + this.source + "）",
      );
    }
    return node;
  }

  private parseAdditive(): ValueExpression {
    let left = this.parseMultiplicative();
    for (;;) {
      const token = this.peek();
      if (token === undefined || token.kind !== "op" || (token.text !== "+" && token.text !== "-")) break;
      this.eat();
      const right = this.parseMultiplicative();
      left = { kind: "BINARY", operator: token.text, left, right };
    }
    return left;
  }

  private parseMultiplicative(): ValueExpression {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token === undefined || token.kind !== "op" || (token.text !== "*" && token.text !== "/")) break;
      this.eat();
      const right = this.parseUnary();
      left = { kind: "BINARY", operator: token.text, left, right };
    }
    return left;
  }

  private parseUnary(): ValueExpression {
    const token = this.peek();
    if (token !== undefined && token.kind === "op" && token.text === "-") {
      this.eat();
      return { kind: "NEGATE", operand: this.parseUnary() };
    }
    if (token !== undefined && token.kind === "op" && token.text === "+") {
      this.eat();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ValueExpression {
    const token = this.eat();
    if (token.kind === "number") {
      const value = Number(token.text);
      if (!Number.isFinite(value)) {
        throw new StrategyCoreError(
          "PARAMETER_DERIVED_UNPARSEABLE",
          "表达式常量非法：" + token.text + "（原文：" + this.source + "）",
        );
      }
      return { kind: "CONSTANT", value };
    }
    if (token.kind === "field") {
      // 字段引用直接成节点；是否**可用**由 fieldReference / LeakageGuard 判定，
      // 解析层不做时间域判断（分层纪律）。
      return { kind: "FIELD_REFERENCE", field: token.text };
    }
    if (token.kind === "ident") {
      const lowered = token.text.toLowerCase();
      if (lowered === "null") return { kind: "CONSTANT", value: null };
      if (lowered === "true") return { kind: "CONSTANT", value: true };
      if (lowered === "false") return { kind: "CONSTANT", value: false };
      return { kind: "PARAMETER_REFERENCE", code: token.text };
    }
    if (token.kind === "lparen") {
      const node = this.parseAdditive();
      const closeparen = this.eat();
      if (closeparen.kind !== "rparen") {
        throw new StrategyCoreError(
          "PARAMETER_DERIVED_UNPARSEABLE",
          "括号不匹配（原文：" + this.source + "）",
        );
      }
      return node;
    }
    throw new StrategyCoreError(
      "PARAMETER_DERIVED_UNPARSEABLE",
      "表达式出现非法起始记号（原文：" + this.source + "）",
    );
  }
}

/**
 * 把文本表达式解析为结构化表达式。
 *
 * 🔴 支持的文法：`number` · `ident`（⇒ 参数引用）· **字段引用**（`bar.low` / `prefix.rd0.open` /
 * `post.rd{n}.{col}` / `event.{field}`，STRATEGY-ARCH-002 追加）· `null/true/false` · `+ - * /`
 * · `()` · 一元 `-`。
 * **不支持**函数调用 / 任意属性访问 / 数组 / 比较 —— 遇到即抛 `PARAMETER_DERIVED_UNPARSEABLE`（不猜语义）。
 */
export function parseExpression(source: string): ValueExpression {
  if (typeof source !== "string" || source.trim() === "") {
    throw new StrategyCoreError("PARAMETER_DERIVED_UNPARSEABLE", "派生表达式为空");
  }
  const text = source.trim();
  return new ExpressionParser(tokenize(text), text).parse();
}
