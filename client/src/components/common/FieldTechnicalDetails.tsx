/**
 * 「字段技术细节」开关（全局，默认**关闭**）。
 *
 * ## 为什么要它
 *
 * 用户看的是**策略**，不是代码。但表单字段会顺手把实现细节回显出来：
 *   - `name`：canonical 路径（`definition.entry.event.type`）；
 *   - `valueKey`：枚举的原始取值（`FIXED_RATIO` / `T_CLOSE` / `T_PLUS_1_OPEN`）。
 *
 * 这两样对**排障与对照**有用，对**写策略**是纯噪音。所以：
 *   - 默认隐藏（`SegmentForm#Field` 里包一层判断）；
 *   - 需要对照时，在「策略定义」页顶部一键打开。
 *
 * 纪律：**纯展示开关** —— 不改任何值、不影响提交内容。
 *
 * ⚠️ 与 `./TechnicalDetails`（既有的「工程信息折叠区」组件）**不是一件事**，
 *    故用 \`FieldTechnical…\` 命名区分。
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface FieldTechnicalValue {
  readonly show: boolean;
  readonly setShow: (next: boolean) => void;
}

const FieldTechnicalContext = createContext<FieldTechnicalValue>({
  show: false,
  setShow: () => undefined,
});

export function FieldTechnicalProvider({ children }: { readonly children: ReactNode }) {
  const [show, setShow] = useState(false);
  const value = useMemo<FieldTechnicalValue>(() => ({ show, setShow }), [show]);
  return <FieldTechnicalContext.Provider value={value}>{children}</FieldTechnicalContext.Provider>;
}

/** 读当前开关（未包 Provider 时按「关」处理 —— 默认不暴露字段路径）。 */
export function useFieldTechnicalDetails(): FieldTechnicalValue {
  return useContext(FieldTechnicalContext);
}

/**
 * 「技术提示」：只在技术模式下渲染的说明文字。
 *
 * 用途：把**面向实现**的解释（字段路径、枚举原始值、后端规则号、字段引用语法）
 * 从默认视图里挪走 —— 用户要看的是"这条规则是什么意思"，不是"它怎么实现"。
 */
export function TechnicalHint({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const { show } = useFieldTechnicalDetails();
  if (!show) return null;
  return <div className={className}>{children}</div>;
}

/** 开关按钮（放在表单顶部一次即可）。 */
export function FieldTechnicalToggle() {
  const { show, setShow } = useFieldTechnicalDetails();
  return (
    <button
      type="button"
      data-field-technical-toggle
      aria-pressed={show}
      onClick={() => setShow(!show)}
      className="flex items-center gap-1 text-[11px] text-muted-foreground transition hover:text-foreground"
      title="显示字段路径（definition.*）与枚举原始取值，供对照与排障"
    >
      {show ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      技术细节
      <span className="text-[10px] opacity-70">字段路径 / 原始取值</span>
    </button>
  );
}