import { describe, expect, it } from "vitest";
import { normalizeCustomSector } from "../client/src/lib/customSector";

describe("normalizeCustomSector", () => {
  it("trims and collapses whitespace in a custom sector name", () => {
    expect(normalizeCustomSector("  低空   经济  ")).toBe("低空 经济");
  });

  it("returns undefined for an empty custom sector", () => {
    expect(normalizeCustomSector("   ")).toBeUndefined();
  });
});
