import { describe, expect, it } from "vitest";
import { applyFilter, groupRows, parseAggregates, pluck, type FilterTarget } from "./query-core";

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
