/** 装配错误（消息必须能直接指向「缺哪个字段 / 去改哪里」）。 */
export class LoopRunAssemblyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LoopRunAssemblyError";
    this.code = code;
  }
}
