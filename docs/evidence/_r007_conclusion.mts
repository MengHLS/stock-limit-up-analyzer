/** 取 Run 510001 生成的结论正文（只读）。 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";

async function main(): Promise<void> {
  const caller = researchEngineRouter.createCaller({ req: {} as never, res: {} as never, user: null });
  const list = await caller.listConclusions({ experimentId: 240002 });
  const target = list.filter((c) => c.id === 390003);
  writeFileSync("_r007_conclusion.md", JSON.stringify(target, null, 2));
  console.log(target.map((c) => `#${c.id} ${c.conclusionType} ${c.confidence}\n${c.conclusion}`).join("\n\n"));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
