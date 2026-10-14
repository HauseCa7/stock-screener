import { describe, expect, it } from "vitest";
import { missingFields, parseInput, showInput } from "./marketFields";

describe("parseInput reads numbers the way Yahoo prints them", () => {
  it("handles suffixes, percents, signs and commas", () => {
    expect(parseInput("483.18B", "big")).toBeCloseTo(483.18e9);
    expect(parseInput("4.45T", "big")).toBeCloseTo(4.45e12);
    expect(parseInput("2.36b", "big")).toBeCloseTo(2.36e9);
    expect(parseInput("2.59%", "pct")).toBeCloseTo(2.59);
    expect(parseInput("+1,250.40%", "pct")).toBeCloseTo(1250.4);
    expect(parseInput("-12.5%", "pct")).toBeCloseTo(-12.5);
    expect(parseInput("$200.97", "price")).toBeCloseTo(200.97);
    expect(parseInput("0", "count")).toBe(0);
    expect(parseInput("  ", "pct")).toBeNull();
  });

  it("rejects things that would be silently wrong", () => {
    expect(() => parseInput("483.18", "big")).toThrow(/too small/);
    expect(() => parseInput("5", "count")).toThrow(/0 to 4/);
    expect(() => parseInput("2.5B", "pct")).toThrow(/suffix/);
    expect(() => parseInput("abc", "ratio")).toThrow(/Couldn't read/);
  });

  it("shows stored values back in Yahoo's style", () => {
    expect(showInput(483.18e9, "big")).toBe("483.18B");
    expect(showInput(2.59, "pct")).toBe("2.59%");
  });
});

describe("missingFields", () => {
  it("lists what the analysis needs, and skips market cap when price × shares can produce it", () => {
    const names = (m: any, shares: number | null) => missingFields(m, shares).map((f) => f.k);
    expect(names(null, null)).toContain("short_interest_pct");
    expect(names({ price: 10 }, 1e9)).not.toContain("market_cap");
    expect(names({ price: 10 }, null)).toContain("market_cap");
    expect(names({ forward_pe: null }, null)).not.toContain("forward_pe"); // optional
  });
});
