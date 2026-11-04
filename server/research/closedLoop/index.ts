/**
 * STEP 25 / C-25.1 — Closed Loop（Production Quant Platform 全链编排）统一出口。
 *
 * 交付内容（C-25.1 = 编排骨架 + 每阶段契约/适配器 + 注入式执行器 + 阶段状态机 +
 * 全链 run 记录；CODE_READY 阶段不接真实 DB/不跑真实全量回测，VALIDATED 由数据链
 * 就绪后 gate 认证）：
 *   - types.ts        阶段链/交接摘要/请求/run 记录类型权威源（14 阶段 + 14 handoff）；
 *   - errors.ts       ClosedLoopError + CL_* 稳定错误码（FAIL FAST，非法请求响亮抛错）；
 *   - blockers.ts     BLOCKED reasonCode（合法阻塞：数据未注入/gate 未过/证据缺失/上游…）；
 *   - spec.ts         StageSpec 表 + 拓扑校验（canonical 保序子集，逆序/重复/空集抛错）；
 *   - guards.ts       交接契约校验（kind/必备键/有限数字/日期）+ run 指纹复核；
 *   - serialize.ts    canonical + sha256 + round-trip + 篡改拒绝；
 *   - orchestrator.ts runClosedLoop（逐阶段状态机：READY→EXECUTED/BLOCKED/SKIPPED +
 *                      审计记录 + §28 谱系落账 + blocked 汇总 + 链指纹）；
 *   - adapters.ts     阶段纯映射适配器（C-14.1/16.x run → 交接摘要；交接 → 模块输入声明）；
 *   - lifecycle.ts    生命周期整合（复用 C-21.1 applyLifecycleTransition；evidence 门槛）；
 *   - lineage.ts      §28 谱系整合（每阶段 run 落一条 C-13.3 experimentLineage 记录）。
 *
 * 命名纪律：全部 ClosedLoop / CLOSED_LOOP_ / CL_ 域前缀（ROADMAP §49，全库查重零冲突）。
 * 注意：本目录独立自持 index；server/research/index.ts 属既有文件未改动，如需并入统一
 * 出口由协调者补 `export * from "./closedLoop"`（协调者统一处理）。
 */

export * from "./types";
export * from "./errors";
export * from "./blockers";
export * from "./spec";
export * from "./guards";
export * from "./serialize";
export * from "./orchestrator";
export * from "./adapters";
export * from "./lifecycle";
export * from "./lineage";
