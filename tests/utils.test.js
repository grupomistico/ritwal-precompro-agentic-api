import { describe, expect, it } from "vitest";
import {
  assertIsoDate,
  assertTime,
  bogotaDateTimeToEpochMs,
  epochMsToPrecomproDateTime,
} from "../src/utils/datetime.js";
import { normalizeCountryCode, normalizePhone } from "../src/utils/phone.js";

describe("datetime helpers", () => {
  it("accept strict real ISO dates only", () => {
    expect(assertIsoDate("2026-05-06")).toBe(true);
    expect(assertIsoDate("05-06-2026")).toBe(false);
    expect(assertIsoDate("2026-02-30")).toBe(false);
    expect(assertIsoDate("2026-5-6")).toBe(false);
  });

  it("accept strict 24 hour HH:mm times only", () => {
    expect(assertTime("00:00")).toBe(true);
    expect(assertTime("23:59")).toBe(true);
    expect(assertTime("24:00")).toBe(false);
    expect(assertTime("9:30")).toBe(false);
  });

  it("round trips Bogota local time through Precompro epoch milliseconds", () => {
    const epochMs = bogotaDateTimeToEpochMs("2026-05-06", "12:30");
    expect(epochMsToPrecomproDateTime(epochMs)).toBe("2026-05-06 12:30:00");
  });
});

describe("phone helpers", () => {
  it("normalizes phone digits and country codes", () => {
    expect(normalizePhone("+57 314 236 0112")).toBe("573142360112");
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizeCountryCode("+57")).toBe(57);
    expect(normalizeCountryCode(undefined, 57)).toBe(57);
  });
});
