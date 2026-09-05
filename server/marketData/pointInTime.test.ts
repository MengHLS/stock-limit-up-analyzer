import { describe, it, expect } from "vitest";
import {
  availabilityStatus,
  validatePointInTime,
  withUnknownAvailability,
  type PointInTime,
} from "./pointInTime";

describe("Point-in-Time 语义", () => {
  const retrieved = "2026-09-06T12:00:00.000Z";

  it("effective / available / retrieved 均合法且顺序正确 → VALID", () => {
    const pit: PointInTime = { effectiveDate: "2025-01-06", availableAt: "2025-01-07T09:00:00.000Z", retrievedAt: retrieved };
    expect(validatePointInTime(pit).status).toBe("VALID");
  });

  it("availableAt 为 null → UNKNOWN 且合法（不是错误）", () => {
    const pit = withUnknownAvailability("2025-01-06", retrieved);
    expect(availabilityStatus(pit)).toBe("UNKNOWN");
    expect(validatePointInTime(pit).status).toBe("VALID");
  });

  it("不得强行假设 T+1：withUnknownAvailability 不填充 availableAt", () => {
    const pit = withUnknownAvailability("2025-01-06", retrieved);
    expect(pit.availableAt).toBeNull();
  });

  it("availableAt 早于 effectiveDate → WARNING/INVALID（时间倒挂）", () => {
    const pit: PointInTime = { effectiveDate: "2025-01-06", availableAt: "2025-01-05T09:00:00.000Z", retrievedAt: retrieved };
    const result = validatePointInTime(pit);
    expect(result.issues.some((issue) => issue.code === "AVAILABLE_BEFORE_EFFECTIVE")).toBe(true);
  });

  it("retrievedAt 早于 availableAt → 顺序错误", () => {
    const pit: PointInTime = { effectiveDate: "2025-01-06", availableAt: "2026-01-01T00:00:00.000Z", retrievedAt: "2025-06-01T00:00:00.000Z" };
    const result = validatePointInTime(pit);
    expect(result.issues.some((issue) => issue.code === "RETRIEVED_BEFORE_AVAILABLE")).toBe(true);
  });

  it("非法 effectiveDate → INVALID", () => {
    const pit: PointInTime = { effectiveDate: "not-a-date", availableAt: null, retrievedAt: retrieved };
    const result = validatePointInTime(pit);
    expect(result.status).toBe("INVALID");
    expect(result.issues.some((issue) => issue.code === "INVALID_EFFECTIVE_DATE")).toBe(true);
  });

  it("非法 retrievedAt → INVALID", () => {
    const pit: PointInTime = { effectiveDate: "2025-01-06", availableAt: null, retrievedAt: "nope" };
    const result = validatePointInTime(pit);
    expect(result.status).toBe("INVALID");
    expect(result.issues.some((issue) => issue.code === "INVALID_RETRIEVED_AT")).toBe(true);
  });
});
