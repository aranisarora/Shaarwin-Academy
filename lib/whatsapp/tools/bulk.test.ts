import { describe, expect, it } from "vitest";
import { BULK_CAP, bulkTool, idList, runBulk } from "./bulk";

describe("idList", () => {
  it("accepts an array, a bare string, and a comma string", () => {
    expect(idList(["a", "b"])).toEqual(["a", "b"]);
    expect(idList("a")).toEqual(["a"]);
    expect(idList("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("drops blanks and duplicates", () => {
    expect(idList(["a", "", "a", "  ", "b"])).toEqual(["a", "b"]);
    expect(idList(null)).toEqual([]);
  });
});

describe("runBulk", () => {
  it("keeps going after a failure and reports every outcome", async () => {
    const summary = await runBulk(["a", "b", "c"], async (id) =>
      id === "b" ? { ok: false, error: "nope" } : { ok: true }
    );
    expect(summary).toMatchObject({ requested: 3, succeeded: 2, failed: 1 });
    expect(summary.outcomes[1]).toEqual({ id: "b", ok: false, error: "nope" });
  });

  it("catches a thrown op rather than losing the whole batch", async () => {
    const summary = await runBulk(["a", "b"], async (id) => {
      if (id === "a") throw new Error("boom");
      return { ok: true };
    });
    expect(summary.succeeded).toBe(1);
    expect(summary.outcomes[0].error).toBe("boom");
  });

  it("runs in order, not concurrently", async () => {
    const seen: string[] = [];
    await runBulk(["a", "b", "c"], async (id) => {
      seen.push(`start:${id}`);
      await new Promise((r) => setTimeout(r, 1));
      seen.push(`end:${id}`);
      return { ok: true };
    });
    expect(seen).toEqual([
      "start:a",
      "end:a",
      "start:b",
      "end:b",
      "start:c",
      "end:c",
    ]);
  });
});

describe("bulkTool", () => {
  const alwaysOk = async () => ({ ok: true });

  it("refuses an empty set", async () => {
    const out = JSON.parse(await bulkTool([], alwaysOk, { noun: "session" }));
    expect(out.ok).toBe(false);
    expect(out.error).toContain("No session ids");
  });

  it("refuses more than the cap without running anything", async () => {
    let calls = 0;
    const ids = Array.from({ length: BULK_CAP + 1 }, (_, i) => `id-${i}`);
    const out = JSON.parse(
      await bulkTool(
        ids,
        async () => {
          calls++;
          return { ok: true };
        },
        { noun: "session" }
      )
    );
    expect(out.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("reports a partial success as ok with the failures itemised", async () => {
    const out = JSON.parse(
      await bulkTool(["a", "b", "c"], async (id) => (id === "c" ? { ok: false, error: "locked" } : { ok: true }), {
        noun: "session",
      })
    );
    expect(out.ok).toBe(true);
    expect(out.result).toMatchObject({ requested: 3, succeeded: 2, failed: 1, partial: true });
    expect(out.result.failures).toEqual([{ id: "c", error: "locked" }]);
  });

  it("does not mark a clean run partial", async () => {
    const out = JSON.parse(await bulkTool(["a"], alwaysOk, { noun: "session" }));
    expect(out.result.partial).toBe(false);
    expect(out.result.failures).toEqual([]);
  });

  it("is a failure, not a partial success, when every id failed", async () => {
    // ok:true here let the assistant read the envelope and report "cancelled"
    // for a run in which nothing was cancelled.
    const many = JSON.parse(
      await bulkTool(["a", "b"], async () => ({ ok: false, error: "locked" }), { noun: "session" })
    );
    expect(many.ok).toBe(false);
    expect(many.error).toContain("None of the 2");
    expect(many.detail.failures).toHaveLength(2);

    const one = JSON.parse(
      await bulkTool(["a"], async () => ({ ok: false, error: "under the 24h window" }), {
        noun: "booking",
      })
    );
    expect(one.ok).toBe(false);
    // A single id keeps its own reason rather than a batch preamble.
    expect(one.error).toBe("under the 24h window");
  });
});
