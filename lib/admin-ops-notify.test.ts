import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { notifyUsersCore } from "@/lib/admin-ops-clients";

type Profile = {
  id: string;
  full_name: string;
  deleted_at: string | null;
  notification_prefs: Record<string, boolean> | null;
};

/** Records notification + audit inserts and serves a fixed profiles table. */
function stub(profiles: Profile[]) {
  const inserted: Record<string, unknown[]> = { notifications: [], audit_log: [] };

  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        in() {
          return builder;
        },
        insert(rows: unknown) {
          inserted[table] ??= [];
          inserted[table].push(...(Array.isArray(rows) ? rows : [rows]));
          return Promise.resolve({ error: null });
        },
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve({ data: table === "profiles" ? profiles : [], error: null }).then(
            resolve
          );
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient<Database>, inserted };
}

const live = (id: string, name: string, prefs: Record<string, boolean> | null = null): Profile => ({
  id,
  full_name: name,
  deleted_at: null,
  notification_prefs: prefs,
});

describe("notifyUsersCore", () => {
  it("queues one row per recipient with the requested type", async () => {
    const { client, inserted } = stub([live("a", "Ravi"), live("b", "Anita")]);
    const out = await notifyUsersCore(client, "founder", ["a", "b"], "Moved indoors", undefined, undefined, "class_updated");
    expect(out.ok).toBe(true);
    expect(out.recipients).toBe(2);
    expect(inserted.notifications).toHaveLength(2);
    expect(inserted.notifications[0]).toMatchObject({ type: "class_updated", body: "Moved indoors" });
  });

  it("refuses an empty message before anything else", async () => {
    const { client, inserted } = stub([live("a", "Ravi")]);
    const out = await notifyUsersCore(client, "founder", ["a"], "   ");
    expect(out.ok).toBe(false);
    expect(out.error).toContain("empty");
    expect(inserted.notifications).toHaveLength(0);
  });

  it("dedupes a recipient who appears twice", async () => {
    const { client, inserted } = stub([live("a", "Ravi")]);
    const out = await notifyUsersCore(client, "founder", ["a", "a"], "hi");
    expect(out.recipients).toBe(1);
    expect(inserted.notifications).toHaveLength(1);
  });

  it("skips soft-deleted accounts and says how many", async () => {
    const gone: Profile = { ...live("b", "Closed"), deleted_at: "2026-01-01T00:00:00Z" };
    const { client, inserted } = stub([live("a", "Ravi"), gone]);
    const out = await notifyUsersCore(client, "founder", ["a", "b"], "hi");
    expect(out.recipients).toBe(1);
    expect(out.skipped_deleted).toBe(1);
    expect(inserted.notifications).toHaveLength(1);
  });

  it("fails cleanly when every recipient is a closed account", async () => {
    const gone: Profile = { ...live("a", "Closed"), deleted_at: "2026-01-01T00:00:00Z" };
    const { client, inserted } = stub([gone]);
    const out = await notifyUsersCore(client, "founder", ["a"], "hi");
    expect(out.ok).toBe(false);
    expect(inserted.notifications).toHaveLength(0);
  });

  it("names recipients who have that message type muted, and still queues for them", async () => {
    // The delivery worker honours prefs, so without this the founder is told
    // "sent" for someone who will never see it outside the app.
    const { client, inserted } = stub([
      live("a", "Ravi", { news: false }),
      live("b", "Anita"),
    ]);
    const out = await notifyUsersCore(client, "founder", ["a", "b"], "Offer inside", undefined, undefined, "announcement");
    expect(out.muted).toEqual(["Ravi"]);
    expect(out.recipients).toBe(2);
    expect(inserted.notifications).toHaveLength(2);
  });

  it("counts the reminders group for class_updated, not news", async () => {
    const { client } = stub([live("a", "Ravi", { news: false, reminders: true })]);
    const out = await notifyUsersCore(client, "founder", ["a"], "Moved", undefined, undefined, "class_updated");
    expect(out.muted).toEqual([]);
  });

  it("writes an audit row carrying the type and the resolved ids", async () => {
    const { client, inserted } = stub([live("a", "Ravi")]);
    await notifyUsersCore(client, "founder", ["a"], "hi", undefined, { action: "notify.targeted" }, "class_updated");
    expect(inserted.audit_log[0]).toMatchObject({
      action: "notify.targeted",
      entity: "notifications",
      meta: expect.objectContaining({ type: "class_updated", recipients: 1, recipient_ids: ["a"] }),
    });
  });
});
