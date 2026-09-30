/** 直读桥的可预期失败：缺版本 / 不满足直读条件 / 身份无法解析等。 */
export class RegistryDatasetBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RegistryDatasetBridgeError";
    this.code = code;
  }
}
