import { describe, expect, it } from "vitest";
import {
  applyFilter,
  fromRupees,
  groupRows,
  istEnd,
  istStart,
  minorField,
  parseAggregates,
  phoneNumber,
  pluck,
  rupeeField,
  toRupees,
  type FilterTarget,
} from "./query-core";

/** Records the calls a filter makes instead of talking to PostgREST. */
function recorder() {
  const calls: string[] = [];
  const target = new Proxy({} as FilterTarget, {
    get:
      (_t, prop: string) =>
      (...args: unknown[]) => {
        calls.push(`${prop}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return target;
      },
  });
  return { target, calls };
}

describe("applyFilter", () => {
  it("maps comparison operators straight through", () => {
    const { target, calls } = recorder();
    applyFilter(target, { col: "starts_at", op: "gte", value: "2026-08-10" });
    applyFilter(target, { col: "capacity", op: "lt", value: 8 });
    expect(calls).toEqual(['gte("starts_at","2026-08-10")', 'lt("capacity",8)']);
  });

  it("wraps bare ilike values in wildcards but respects explicit ones", () => {
    const { target, calls } = recorder();
    applyFilter(target, { col: "name", op: "ilike", value: "plaza" });
    applyFilter(target, { col: "name", op: "ilike", value: "la*" });
    expect(calls).toEqual(['ilike("name","%plaza%")', 'ilike("name","la%")']);
  });

  it("accepts a comma string where the schema asked for an array", () => {
    const { target, calls } = recorder();
    applyFilter(target, { col: "status", op: "in", value: "scheduled, cancelled" });
    expect(calls).toEqual(['in("status",["scheduled","cancelled"])']);
  });

  it("spells not_in the way PostgREST wants it, with the quoting .in() would have done", () => {
    const { target, calls } = recorder();
    applyFilter(target, { col: "id", op: "not_in", value: ["a", "b"] });
    expect(calls).toEqual(['not("id","in","(\\"a\\",\\"b\\")")']);
  });

  it("survives a value containing the list separator", () => {
    // Unquoted, "Smith, John" becomes two bogus terms and the filter quietly
    // matches the wrong rows.
    const { target, calls } = recorder();
    applyFilter(target, { col: "name", op: "not_in", value: ['Smith, John', 'a"b'] });
    expect(calls[0]).toContain('\\"Smith, John\\"');
    expect(calls[0]).toContain('a\\\\\\"b');
  });

  it("handles null checks without a value", () => {
    const { target, calls } = recorder();
    applyFilter(target, { col: "coach_id", op: "is_null" });
    applyFilter(target, { col: "coach_id", op: "not_null" });
    expect(calls).toEqual(['is("coach_id",null)', 'not("coach_id","is",null)']);
  });
});

describe("phoneNumber", () => {
  it("collapses every spelling of one number onto the stored E.164", () => {
    const spellings = [
      "+91 77086 88495",
      "+91-77086-88495",
      "+91(77086)88495",
      "07708688495",
      "7708688495",
      "+917708688495",
      "00917708688495",
    ];
    for (const spelling of spellings) {
      expect(phoneNumber(spelling), spelling).toBe("+917708688495");
    }
  });

  it("rejects what it can't place rather than inventing an E.164", () => {
    // A read that guesses looks in the wrong place and reports "no such client".
    expect(phoneNumber("88495")).toBeNull();
    expect(phoneNumber("0812345678")).toBeNull();
    expect(phoneNumber("ring the office")).toBeNull();
    expect(phoneNumber(null)).toBeNull();
  });
});

describe("money", () => {
  it("reads rupees however they were said", () => {
    expect(fromRupees(5000)).toBe(500000);
    expect(fromRupees("₹1,599")).toBe(159900);
    expect(fromRupees("Rs 1599")).toBe(159900);
    expect(fromRupees("1599.50")).toBe(159950);
  });

  it("refuses a value that isn't an amount", () => {
    expect(fromRupees("cheap")).toBeNull();
    expect(fromRupees("")).toBeNull();
  });

  it("renames a minor-unit column both ways and leaves others alone", () => {
    expect(rupeeField("amount_pence")).toBe("amount_inr");
    expect(minorField("amount_inr")).toBe("amount_pence");
    expect(rupeeField("delta_minutes")).toBe("delta_minutes");
    expect(minorField("delta_minutes")).toBe("delta_minutes");
  });

  it("converts a row tree in place, replacing the raw field rather than adding to it", () => {
    // Both fields present is an invitation to quote the wrong one.
    const rows = [
      { id: "s1", plans: [{ name: "Group", price_pence: 159900 }], amount_pence: null },
    ];
    toRupees(rows);
    expect(rows).toEqual([{ id: "s1", plans: [{ name: "Group", price_inr: 1599 }], amount_inr: null }]);
  });
});

describe("istStart / istEnd", () => {
  it("anchors a bare day to the academy's midnight, not UTC's", () => {
    expect(istStart("2026-06-14")).toBe("2026-06-13T18:30:00.000Z");
    expect(istEnd("2026-06-14")).toBe("2026-06-14T18:29:59.999Z");
  });

  it("covers a whole month from either edge", () => {
    expect(istStart("2026-06")).toBe("2026-05-31T18:30:00.000Z");
    expect(istEnd("2026-06")).toBe("2026-06-30T18:29:59.999Z");
    // December has to roll the year over, not ask for month 13.
    expect(istEnd("2026-12")).toBe("2026-12-31T18:29:59.999Z");
  });

  it("reads a bare wall time as IST too", () => {
    expect(istStart("2026-06-14T18:30")).toBe("2026-06-14T13:00:00.000Z");
    expect(istStart("2026-06-14 18:30:30")).toBe("2026-06-14T13:00:30.000Z");
  });

  it("passes an explicit instant through untouched", () => {
    // Re-anchoring one that already carries an offset shifts the window twice.
    expect(istStart("2026-08-10T00:00:00Z")).toBe("2026-08-10T00:00:00Z");
    expect(istEnd("2026-08-10T04:30:00+05:30")).toBe("2026-08-10T04:30:00+05:30");
  });

  it("rejects anything it cannot place", () => {
    expect(istStart("next Tuesday")).toBeNull();
    expect(istStart("June")).toBeNull();
    expect(istStart("")).toBeNull();
  });
});

describe("pluck", () => {
  it("reads dotted paths", () => {
    expect(pluck({ classes: { title: "Beginner" } }, "classes.title")).toBe("Beginner");
  });

  it("unwraps single-row embeds that arrive as arrays", () => {
    expect(pluck({ classes: [{ venues: [{ name: "La Plazza" }] }] }, "classes.venues.name")).toBe(
      "La Plazza"
    );
  });

  it("returns undefined for a missing path instead of throwing", () => {
    expect(pluck({ a: null }, "a.b.c")).toBeUndefined();
    expect(pluck(null, "a")).toBeUndefined();
  });
});

describe("groupRows", () => {
  const rows = [
    { coach: { full_name: "Ravi" }, minutes: 60 },
    { coach: { full_name: "Ravi" }, minutes: 90 },
    { coach: { full_name: "Anita" }, minutes: 60 },
  ];

  it("counts per group, biggest first", () => {
    const out = groupRows(rows, ["coach.full_name"], []);
    expect(out).toEqual([
      { "coach.full_name": "Ravi", count: 2 },
      { "coach.full_name": "Anita", count: 1 },
    ]);
  });

  it("computes sum and avg with a flattened label", () => {
    const out = groupRows(rows, ["coach.full_name"], [{ fn: "sum", col: "minutes" }, { fn: "avg", col: "minutes" }]);
    expect(out[0]).toMatchObject({ sum_minutes: 150, avg_minutes: 75 });
  });

  it("groups nulls together rather than dropping them", () => {
    const out = groupRows([{ coach: null }, { coach: null }], ["coach.full_name"], []);
    expect(out).toEqual([{ "coach.full_name": null, count: 2 }]);
  });

  it("returns null for an aggregate with no numeric values", () => {
    const out = groupRows([{ a: "x" }], ["a"], [{ fn: "sum", col: "missing" }]);
    expect(out[0].sum_missing).toBeNull();
  });
});

describe("parseAggregates", () => {
  it("parses fn:col pairs and ignores junk", () => {
    expect(parseAggregates(["sum:minutes", "count", "bogus:x", "avg"])).toEqual([
      { fn: "sum", col: "minutes" },
      { fn: "count" },
    ]);
  });

  it("accepts a bare string", () => {
    expect(parseAggregates("max:capacity")).toEqual([{ fn: "max", col: "capacity" }]);
  });
});
