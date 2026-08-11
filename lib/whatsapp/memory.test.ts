import { describe, expect, it } from "vitest";
import { harvest, harvestResolved, isUuid, renderMemory } from "./memory";

const AARAV = "3f2a1b4c-5d6e-4f70-8123-456789abcdef";
const MYRAH = "7c8d9e0f-1a2b-4c3d-9e4f-56789abcdef0";
const SESSION = "11112222-3333-4444-8555-666677778888";

describe("isUuid", () => {
  it("accepts a real uuid and rejects things that merely look hex-ish", () => {
    expect(isUuid(AARAV)).toBe(true);
    // Razorpay order ids and the like must never be mistaken for referents.
    expect(isUuid("order_MkT8sd7f9a")).toBe(false);
    expect(isUuid("deadbeef")).toBe(false);
    expect(isUuid(12345)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("harvest — pulling referents out of a tool result", () => {
  /**
   * The exact shape `find entity=players` returns. This is the turn whose ids
   * used to be destroyed by lint before the next message could use them.
   */
  it("remembers rows from a find result under the entity's own kind", () => {
    const found = harvest({
      ok: true,
      entity: "players",
      count: 1,
      rows: [{ id: AARAV, full_name: "Aarav Sharma", skill_level: "beginner" }],
    });
    expect(found).toContainEqual(
      expect.objectContaining({ kind: "player", id: AARAV, label: "Aarav Sharma" })
    );
  });

  it("remembers an embedded player alongside the booking that carries it", () => {
    const found = harvest({
      ok: true,
      entity: "bookings",
      rows: [
        {
          id: "aaaabbbb-cccc-4ddd-8eee-ffff00001111",
          status: "confirmed",
          player_id: MYRAH,
          players: { id: MYRAH, full_name: "Myrah Rao" },
        },
      ],
    });
    const player = found.find((f) => f.id === MYRAH);
    expect(player).toBeDefined();
    expect(player?.kind).toBe("player");
    expect(player?.label).toBe("Myrah Rao");
  });

  it("ignores an id it has no name for — an unsayable id is worse than none", () => {
    const found = harvest({ ok: true, entity: "sessions", rows: [{ id: SESSION }] });
    expect(found).toHaveLength(0);
  });

  it("does not invent referents from a plain success envelope", () => {
    expect(harvest({ ok: true, message: "Booked." })).toHaveLength(0);
  });

  it("survives a malformed result rather than throwing into the reply path", () => {
    expect(harvest(null)).toEqual([]);
    expect(harvest("nope")).toEqual([]);
    expect(harvest([{ deeply: { nested: { nothing: true } } }])).toEqual([]);
  });

  it("caps what one turn can store", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: `${String(i).padStart(8, "0")}-1111-4222-8333-444455556666`,
      full_name: `Player ${i}`,
    }));
    expect(harvest({ entity: "players", rows }).length).toBeLessThanOrEqual(40);
  });

  it("deduplicates the same entity seen twice in one result", () => {
    const found = harvest({
      entity: "bookings",
      rows: [
        { id: "aaaabbbb-cccc-4ddd-8eee-ffff00001111", player_id: MYRAH, players: { id: MYRAH, full_name: "Myrah Rao" } },
        { id: "aaaabbbb-cccc-4ddd-8eee-ffff00002222", player_id: MYRAH, players: { id: MYRAH, full_name: "Myrah Rao" } },
      ],
    });
    expect(found.filter((f) => f.id === MYRAH)).toHaveLength(1);
  });
});

/**
 * The agent hands the harvester the WHOLE tool envelope — ok() wraps every
 * payload in {ok, result}. Asserting only the inner shape is how the resolver's
 * candidates were silently skipped: the code read `.candidates` off the wrapper,
 * where it never sits.
 */
describe("harvest — the envelope tools actually return", () => {
  it("reaches through ok()'s {ok, result} wrapper", () => {
    const found = harvest({
      ok: true,
      result: {
        entity: "players",
        count: 1,
        rows: [{ id: AARAV, full_name: "Aarav Sharma" }],
      },
    });
    expect(found).toContainEqual(
      expect.objectContaining({ kind: "player", id: AARAV, label: "Aarav Sharma" })
    );
  });

  it("takes nothing from a failed tool call", () => {
    expect(harvest({ ok: false, error: "Nope." })).toHaveLength(0);
  });
});

describe("harvestResolved — the resolver is taken at its word", () => {
  it("reaches through ok()'s wrapper, the shape the agent passes it", () => {
    const found = harvestResolved({
      ok: true,
      result: {
        searched_for: "Aarav",
        candidates: [{ kind: "player", id: AARAV, label: "Aarav Sharma" }],
      },
    });
    expect(found).toEqual([
      { kind: "player", id: AARAV, label: "Aarav Sharma", detail: undefined },
    ]);
  });

  it("keeps each candidate's own kind", () => {
    const found = harvestResolved({
      searched_for: "Aarav",
      candidates: [
        { kind: "player", id: AARAV, label: "Aarav Sharma", detail: "Meera's child" },
        { kind: "coach", id: MYRAH, label: "Aarav Menon", detail: "coach" },
      ],
    });
    expect(found).toHaveLength(2);
    expect(found[0]).toEqual({
      kind: "player",
      id: AARAV,
      label: "Aarav Sharma",
      detail: "Meera's child",
    });
    expect(found[1].kind).toBe("coach");
  });

  it("drops a candidate with an unusable id", () => {
    expect(
      harvestResolved({ candidates: [{ kind: "player", id: "not-a-uuid", label: "X" }] })
    ).toHaveLength(0);
  });

  it("returns nothing for a miss", () => {
    expect(harvestResolved({ searched_for: "Zzz", count: 0 })).toEqual([]);
  });
});

describe("renderMemory", () => {
  it("is empty when there is nothing to recall, so no block is injected", () => {
    expect(renderMemory([])).toBe("");
  });

  it("carries the full id, because the id is the entire point", () => {
    const block = renderMemory([
      { kind: "player", id: AARAV, label: "Aarav Sharma", detail: "Meera's child" },
    ]);
    expect(block).toContain(AARAV);
    expect(block).toContain("Aarav Sharma");
    expect(block).toContain("Meera's child");
    // And it must tell the model what the block is FOR, or it reads as noise.
    expect(block).toContain("Working memory");
    expect(block).toContain("Never show an id");
  });
});
