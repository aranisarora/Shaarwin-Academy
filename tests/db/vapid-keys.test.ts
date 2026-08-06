// Where the web-push signing key lives, and who is allowed to ask for it.
//
// The VAPID private key belongs in a Supabase function secret and the worker
// reads `Deno.env` first for exactly that reason. It is also kept in Supabase
// Vault (migration 0064), because nothing in the environment this was built from
// could set a function secret and the alternative was push staying fully built
// and permanently dormant — which is what it had been for weeks.
//
// `public.vapid_keys()` is the only route from `public` into that vault, and it
// is the MIRROR IMAGE of `school_password()` (0062) on purpose. That one refuses
// service_role so a school's shared credential sits behind a person. This one is
// read by the notify edge function, which connects with the service-role key —
// so service_role is allowed and `authenticated` is refused. Getting it backwards
// fails in one of two ways, and neither announces itself:
//
//   refuse service_role → push never sends a single message, silently, exactly
//                         as it has failed until now
//   allow authenticated → every signed-in parent, coach and school head holds
//                         the signing key, and can push an arbitrary banner to
//                         any subscribed device in the academy, wearing our name
//
// Both directions are asserted below, and both matter enough to be worth the one
// oddity in this file: it talks to Postgres directly. `vault` is not a schema
// PostgREST exposes — that is the whole point of keeping a secret there — so
// there is no supabase-js route to seed one, and without seeding, the read half
// could never be proved at all. `DB_URL` is the local-only connection string the
// harness already exports for exactly this kind of thing.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { admin, asUser } from "../../e2e/lib/supabase";
import { DB_URL, SUPABASE_URL, ANON_KEY } from "../../e2e/lib/env";
import { createClient, createCoach } from "../../e2e/lib/scenario";

// `pg` is a harness devDependency (scripts/test-db-reset.mjs uses it) but ships
// no types, and this is the only spec that needs a raw connection. Typing the
// two methods used here beats adding @types/pg for one import.
type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, string>> }>;
  end(): Promise<void>;
};
const { Client } = createRequire(import.meta.url)("pg") as {
  Client: new (config: { connectionString: string }) => PgClient;
};

// Real-shaped but throwaway: a valid base64url P-256 point and scalar would add
// nothing here, because this file tests who can read the strings, not whether
// they sign. The worker's own key validation is a separate concern.
const FAKE_PUBLIC = "test-public-key-not-a-real-point";
const FAKE_PRIVATE = "test-private-key-not-a-real-scalar";
const FAKE_SUBJECT = "mailto:harness@sharwin.example";

const SECRET_NAMES = ["vapid_public_key", "vapid_private_key", "vapid_subject"];

async function withPg<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/** Store (or replace) a vault secret by name — the shape migration 0064 uses. */
async function putSecret(name: string, value: string): Promise<void> {
  await withPg(async (c) => {
    const { rows } = await c.query("select id from vault.secrets where name = $1", [name]);
    if (rows.length) {
      await c.query("select vault.update_secret($1, $2)", [rows[0].id, value]);
    } else {
      await c.query("select vault.create_secret($1, $2, $3)", [value, name, "harness"]);
    }
  });
}

async function clearSecrets(): Promise<void> {
  await withPg((c) =>
    c.query("delete from vault.secrets where name = any($1)", [SECRET_NAMES])
  );
}

/** The one row `vapid_keys()` always returns, whatever the vault holds. */
type VapidRow = { public_key: string | null; private_key: string | null; subject: string | null };

async function readAsServiceRole(): Promise<VapidRow> {
  const { data, error } = await admin().rpc("vapid_keys");
  expect(error).toBeNull();
  const rows = data as unknown as VapidRow[];
  expect(rows).toHaveLength(1);
  return rows[0];
}

beforeAll(async () => {
  await putSecret("vapid_public_key", FAKE_PUBLIC);
  await putSecret("vapid_private_key", FAKE_PRIVATE);
  await putSecret("vapid_subject", FAKE_SUBJECT);
});

// The local vault survives `db:reset` (it rebuilds `public`, not `vault`), so
// leaving a fake key behind would quietly outlive this run.
afterAll(clearSecrets);

describe("who may read the push signing key", () => {
  it("hands it to the service role — the worker, and nothing else", async () => {
    const row = await readAsServiceRole();
    expect(row.private_key).toBe(FAKE_PRIVATE);
    expect(row.public_key).toBe(FAKE_PUBLIC);
    expect(row.subject).toBe(FAKE_SUBJECT);
  });

  it("refuses a signed-in parent", async () => {
    const parent = await createClient({ children: 1 });
    const { error } = await (await asUser(parent.email)).rpc("vapid_keys");
    expect(error?.message).toContain("not_authorised");
  });

  it("refuses a coach", async () => {
    // Coaches are the heaviest recipients of push, which makes it tempting to
    // think of them as insiders. They are `authenticated` like everyone else.
    const coach = await createCoach();
    const { error } = await (await asUser(coach.email)).rpc("vapid_keys");
    expect(error?.message).toContain("not_authorised");
  });

  it("refuses the founder, who has no use for it and no screen that shows it", async () => {
    const founder = await asUser("founder@sharwin.example");
    const { error } = await founder.rpc("vapid_keys");
    expect(error?.message).toContain("not_authorised");
  });

  it("refuses a caller with no session at all", async () => {
    const anon = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await anon.rpc("vapid_keys");
    expect(error).not.toBeNull();
  });
});

describe("when the vault holds nothing", () => {
  it("answers with nulls rather than an error, so push simply stays dormant", async () => {
    // The honest state, and the one the worker is built around: no key means
    // push is skipped and WhatsApp and email carry everything, exactly as they
    // did before push existed. An exception here would turn a dormant channel
    // into a broken tick every minute of the day.
    await clearSecrets();

    const row = await readAsServiceRole();
    expect(row.public_key).toBeNull();
    expect(row.private_key).toBeNull();
    expect(row.subject).toBeNull();
  });
});
