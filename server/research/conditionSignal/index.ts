/**
 * 声明式条件 → 执行门槛（STEP A-1）。
 *
 * 唯一实现，落点 `server/research/conditionSignal/`；消费方只有一处：
 * `runWorkbenchAssembly/assemble.ts#requireRecipe`（文档无 `recipe` 但**有**声明式条件时）。
 *
 * 铁律：编译不出来即**响亮抛错并逐条列出**，绝不回落默认配方。
 */

export {
  compileConditionRecipe,
  DECLARATIVE_RECIPE_ID,
  type CompileConditionRecipeInput,
} from "./compile";
