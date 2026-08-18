import { describe, expect, it } from "vitest";
import { isValidLimitUpTime, normalizeLimitUpTime } from "../shared/limitUpTime";

describe("limit-up time normalization", () => {
  it("pads HH:MM to HH:MM:SS", () => {
    expect(normalizeLimitUpTime("09:31")).toBe("09:31:00");
  });

  it("pads a single-digit hour and seconds", () => {
    expect(normalizeLimitUpTime("9:25:00")).toBe("09:25:00");
    expect(normalizeLimitUpTime("9:25")).toBe("09:25:00");
  });

  it("keeps valid HH:MM:SS unchanged", () => {
    expect(normalizeLimitUpTime("14:56:30")).toBe("14:56:30");
    expect(isValidLimitUpTime("23:59:59")).toBe(true);
  });

  it("accepts empty values as unknown time", () => {
    expect(normalizeLimitUpTime("" )).toBeNull();
    expect(normalizeLimitUpTime(null)).toBeNull();
    expect(isValidLimitUpTime(undefined)).toBe(true);
  });

  it("rejects invalid hours, minutes, seconds and text", () => {
    for (const value of ["24:00:00", "12:60:00", "12:00:60", "not-a-time"]) {
      expect(normalizeLimitUpTime(value)).toBeNull();
      expect(isValidLimitUpTime(value)).toBe(false);
    }
  });
});
