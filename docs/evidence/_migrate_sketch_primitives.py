"""把 research/CandidateSketchFields.tsx 的「段表单原语」摘出去，改为引用公共层。

背景：本仓库现在有两处按「下单思路」分段的结构化编辑器
（研究草图的六/七段、策略定义的七段）。公共渲染层已抽到
`client/src/components/common/SegmentForm.tsx`，草图侧必须改为引用它，
否则两边各留一份实现 ⇒ 缓慢漂移且无测试可拦。

做法：按**断言过的行号区间**删除两段（先删靠后的，避免行号位移）：
  - 365–454：segmentDomId / SegmentGapList / SegmentShell
  - 110–331：Field / Section / Advanced / EnumSelect / NumInput / KeyValueRows
只删这两段，中间的 RawBlockNotice（333–357）与 rawOf（359–363）**必须原样保留** ——
脚本会断言它们还在，否则 ABORT 且不写文件。
"""

from __future__ import annotations

import sys
from pathlib import Path

TARGET = Path("client/src/components/research/CandidateSketchFields.tsx")


def main() -> int:
    if not TARGET.exists():
        print(f"❌ 找不到 {TARGET}")
        return 1

    raw = TARGET.read_bytes()
    if b"\r\n" in raw:
        print("❌ 该文件是 CRLF —— 本脚本只处理 LF，ABORT")
        return 1
    text = raw.decode("utf-8")
    lines = text.splitlines(keepends=True)
    before_len = len(lines)

    def at(n: int) -> str:
        """1-based 取行（含换行符）。"""
        return lines[n - 1]

    # ---- 断言：两段区间确实是要删的东西，且中间那段要保留的东西还在 ----
    checks = [
        (110, at(110).startswith("// ---"), f"110 应是分隔线注释，实际 {at(110)!r}"),
        (111, "基础控件（本文件私有）" in at(111), f"111 应是「基础控件」标题，实际 {at(111)!r}"),
        (123, at(123).startswith("function Field("), f"123 应是 Field，实际 {at(123)!r}"),
        (331, at(331).rstrip("\n") == "}", f"331 应是 KeyValueRows 的收尾 }}，实际 {at(331)!r}"),
        (338, at(338).startswith("function RawBlockNotice("), f"338 应是 RawBlockNotice，实际 {at(338)!r}"),
        (357, at(357).rstrip("\n") == "}", f"357 应是 RawBlockNotice 的收尾 }}，实际 {at(357)!r}"),
        (360, at(360).startswith("function rawOf("), f"360 应是 rawOf，实际 {at(360)!r}"),
        (363, at(363).rstrip("\n") == "}", f"363 应是 rawOf 的收尾 }}，实际 {at(363)!r}"),
        (365, at(365).startswith("const segmentDomId"), f"365 应是 segmentDomId，实际 {at(365)!r}"),
        (379, at(379).startswith("function SegmentGapList("), f"379 应是 SegmentGapList，实际 {at(379)!r}"),
        (393, at(393).startswith("function SegmentShell("), f"393 应是 SegmentShell，实际 {at(393)!r}"),
        (454, at(454).rstrip("\n") == "}", f"454 应是 SegmentShell 的收尾 }}，实际 {at(454)!r}"),
        (460, at(460).startswith("export function CandidateSketchFields("), "460 应是入口组件"),
    ]
    failed = [msg for _n, ok, msg in checks if not ok]
    if failed:
        print("❌ 行号锚点不符 ⇒ ABORT，文件未写：")
        for msg in failed:
            print("   -", msg)
        return 1

    # ---- 删除：先删靠后的区间（365–454），再删靠前的（110–331） ----
    del lines[364:454]  # idx 364..453 == 行 365..454
    del lines[109:331]  # idx 109..330 == 行 110..331

    # ---- 断言：保留下来的两颗「钉子」仍在，且被删的东西确实没了 ----
    after = "".join(lines)
    must_keep = ["function RawBlockNotice(", "function rawOf(", "/**\n * 只读块提示：表单表达不了这一块"]
    must_gone = ["function Field(", "function SegmentShell(", "const segmentDomId", "function KeyValueRows("]
    for token in must_keep:
        if token not in after:
            print(f"❌ 删除后丢失了必须保留的片段：{token!r} ⇒ ABORT（文件未写）")
            return 1
    for token in must_gone:
        if token in after:
            print(f"❌ 删除后仍残留：{token!r} ⇒ ABORT（文件未写）")
            return 1

    TARGET.write_text(after, encoding="utf-8")
    print(f"✅ 已删除 {before_len - len(lines)} 行 | {before_len} → {len(lines)} 行")
    return 0


if __name__ == "__main__":
    sys.exit(main())
