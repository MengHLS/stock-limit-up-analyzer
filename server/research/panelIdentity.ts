/**
 * Research 面板身份（panelSecurityId）→ 底层证券代码的**唯一解析实现**。
 *
 * 身份形态：
 *   - 池化：`sec_<uuid>::pool:002805.SZ@2023-06-30`
 *   - 事件窗：`sec_<uuid>::event:002660.SZ@2024-12-25`
 *   - 纯 canonical：`sec_<uuid>`（无事件作用域）
 *
 * 解析不到后缀时**以整个 securityId 作为自身代码** —— 绝不把两个不同身份误合并。
 */
export function panelCodeOf(securityId: string): string {
  const matched = /::(?:event|pool):([0-9]{6}\.[A-Za-z]{2})@/.exec(securityId);
  return matched === null ? securityId : matched[1]!.toUpperCase();
}
