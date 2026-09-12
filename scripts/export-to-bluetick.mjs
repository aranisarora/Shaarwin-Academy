#!/usr/bin/env node
/**
 * Import Sharwin Table Tennis Academy into an EXISTING bluetick workspace.
 *
 *   node scripts/export-to-bluetick.mjs --dry-run --workspace <uuid> [--manager +91…]
 *   node scripts/export-to-bluetick.mjs --apply   --workspace <uuid> [--manager +91…]
 *
 * Options
 *   --workspace <uuid>   REQUIRED. The workspace to fill. It must already
 *                        exist, not be archived, and hold exactly one member —
 *                        its owner — and nothing else at all.
 *   --manager +91…       Repeatable. Somebody who gets the Manager role.
 *   --bluetick-env PATH  Where DATABASE_URL lives
 *                        (default C:/Users/Aranis/Desktop/bluetick/.env.local).
 *   --report PATH        Where the markdown report is also written.
 *
 * WHAT THIS CARRIES, AND WHY IT IS SO LITTLE. The first import (2026-09-11)
 * laid 52 weeks of occurrences, 468 phoneless school pupils, the old app's
 * monthly plans and its "complimentary" arrangements. None of it was what the
 * academy needs to go FORWARD, and all of it has been purged. This run carries
 * three things: the numbers, the contacts, and the standing weekly timetable.
 * No history. No pupils. No money. Every gap is the owner's to fill through
 * the product, and three tasks ask him for them by name.
 *
 * A RULE THAT REPEATS IS A `series` ROW. Not 52 events. `app.lay_down` keeps
 * the next five weeks of `event` rows in front of the runtime and books every
 * standing place onto each one as it is laid; this script inserts the rules and
 * calls it once. A standing place is a `booking` with `series_id` set and
 * `event_id` empty.
 *
 * SHARWIN IS NEVER WRITTEN. Every statement against Supabase here is a read.
 * BLUETICK IS WRITTEN ONLY under --apply, inside one transaction. --dry-run
 * runs the whole plan against the real database inside a transaction that ends
 * in ROLLBACK after `set constraints all immediate`, so the counts it prints
 * are counts of rows that really were written and really were taken back — and
 * every deferred constraint an --apply would meet at COMMIT has been asked.
 *
 * WHAT IT CANNOT DO. A memory written outside a turn lands at actor 'noticed',
 * whatever this script passes: app.memory_is_derived() derives the column from
 * the turn context and an import has none. So nothing imported claims an owner
 * said it. That is the honest record and it is left alone.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BLUETICK_ENV = "C:/Users/Aranis/Desktop/bluetick/.env.local";
const DEFAULT_REPORT_DIR = "C:/Users/Aranis/.claude/jobs/9e5f9ded/tmp";
const TZ = "Asia/Kolkata";
const IST_MIN = 330; // Asia/Kolkata is +05:30 all year; India keeps no DST.
const SEED_FOUNDER = /\+seedfounder@/i;

/** The academy's own venue reads as the academy's name; the hall is what it is. */
const ACADEMY_VENUE = /sharwin\s+table\s+tennis\s+academy/i;

/**
 * One number in Sharwin has a digit too many. It is Rishikesh Kirthi.m's, and
 * the fix is applied to the raw string BEFORE it is normalised, because
 * +9197420503111 is a perfectly well-formed fourteen-digit E.164 number and
 * normalising would wave it through. The correction is listed in the report
 * and handed to the owner to confirm.
 */
const PHONE_FIXES = { "+9197420503111": "+919742050311" };

/** Numbers that are not the people their rows claim to be. */
const SKIP_PHONES = new Map([
  ["+916362615758", 'a second profile called "Stalin" — his, a relative\'s, or an old one'],
  ["+919620700537", '"stalin prabhu", a third profile with that name'],
  ["+918904506671", '"aranis (test)", a test row'],
]);

/** A phoneless founder pseudo-row: the academy itself, not a person. */
const SKIP_NAMES = new Set(["sharwin table tennis academy"]);

/** How far back a session is looked at to learn a weekly slot's time of day. */
const SESSION_BACK_DAYS = 180;
const SESSION_FWD_DAYS = 60;
/** The window a one-off session has to fall in to be carried across. */
const ONE_OFF_DAYS = 35;

const WEEKDAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const BYDAY = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

// ── argv ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { mode: null, workspace: null, managers: [], bluetickEnv: DEFAULT_BLUETICK_ENV, report: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.mode = "dry-run";
    else if (a === "--apply") out.mode = "apply";
    else if (a === "--workspace") out.workspace = argv[++i];
    else if (a === "--manager") out.managers.push(argv[++i]);
    else if (a === "--bluetick-env") out.bluetickEnv = argv[++i];
    else if (a === "--report") out.report = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.mode) throw new Error("say one of --dry-run, --apply");
  if (!out.workspace) throw new Error("--workspace <uuid> is required — this script fills a workspace, it does not found one");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(out.workspace)) {
    throw new Error(`--workspace ${out.workspace} is not a uuid`);
  }
  return out;
}

function readEnvFile(file) {
  if (!existsSync(file)) throw new Error(`${file} not found`);
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

// ── words and numbers ────────────────────────────────────────────────────────

const last4 = (p) => (p ? `…${String(p).slice(-4)}` : "—");
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Owner";
const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const same = (a, b) => tidy(a).toLowerCase() === tidy(b).toLowerCase() && tidy(a) !== "";

/**
 * E.164, or null when the digits do not make a number. A bare ten-digit number
 * is Indian — this academy is in Bengaluru and nothing else it holds is not.
 */
function normPhone(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[\s()\-.]/g, "");
  if (!s) return null;
  if (PHONE_FIXES[s]) s = PHONE_FIXES[s];
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+")) {
    const d = s.replace(/\D/g, "");
    if (d.length === 10) s = `+91${d}`;
    else if (d.length === 11 && d.startsWith("0")) s = `+91${d.slice(1)}`;
    else if (d.length === 12 && d.startsWith("91")) s = `+${d}`;
    else return null;
  }
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** Did PHONE_FIXES touch this one? Reported, and handed to the owner. */
function wasFixed(raw) {
  const s = String(raw ?? "").trim().replace(/[\s()\-.]/g, "");
  return PHONE_FIXES[s] ? { from: s, to: PHONE_FIXES[s] } : null;
}

function slug(text, fallback = "x") {
  const s = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || fallback;
}

/** Postgres refuses a body over 500 characters, so cut before it has to. */
function cap(body, n = 500) {
  const s = String(body).replace(/\s+/g, " ").trim();
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── the Asia/Kolkata wall clock ──────────────────────────────────────────────
// A fixed offset, so a week added in milliseconds is a week added on the wall.

const pad = (n, w = 2) => String(n).padStart(w, "0");
const istOf = (d) => new Date(d.getTime() + IST_MIN * 60000);
function istParts(d) {
  const t = istOf(d);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(),
    hh: t.getUTCHours(), mi: t.getUTCMinutes(),
    wd: t.getUTCDay() === 0 ? 7 : t.getUTCDay(), // ISO 1..7
  };
}
const istInstant = (y, m, d, hh, mi) => new Date(Date.UTC(y, m, d, hh, mi) - IST_MIN * 60000);
function istStamp(d) {
  const p = istParts(d);
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mi)} IST`;
}
const istDate = (d) => { const p = istParts(d); return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`; };
const istTime = (d) => { const p = istParts(d); return `${pad(p.hh)}:${pad(p.mi)}`; };

/** Date arithmetic on "YYYY-MM-DD", which has no timezone to get wrong. */
function dateAdd(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400e3);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function isoWeekdayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}
/** The first date on or after `from` that falls on ISO weekday `wd`. */
const nextOnWeekday = (from, wd) => dateAdd(from, (wd - isoWeekdayOf(from) + 7) % 7);
/** "HH:MM" out of a Postgres time or a "HH:MM:SS" string. */
const hhmm = (t) => {
  const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? `${pad(Number(m[1]))}:${m[2]}` : null;
};

// ── Sharwin, read only ───────────────────────────────────────────────────────

function sharwinClient() {
  const env = readEnvFile(path.join(ROOT, ".env.local"));
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(".env.local carries no NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * PostgREST caps a page at 1000 rows; this walks the whole table.
 *
 * THE ORDER IS NOT DECORATION. Postgres promises nothing about the order of two
 * separate LIMIT/OFFSET statements, and this reads a database people are using
 * right now: one concurrent UPDATE moves a heap tuple and a row is silently
 * handed back twice or skipped altogether. A skipped session is a slot whose
 * time of day this import then has to guess. So every page is ordered by a key
 * that is unique in the table, and the pages tile it exactly once.
 */
async function fetchAll(sb, table, columns, shape = (q) => q, orderBy = ["id"]) {
  const page = 1000;
  const rows = [];
  for (let from = 0; ; from += page) {
    let q = shape(sb.from(table).select(columns));
    for (const col of orderBy) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + page - 1);
    if (error) throw new Error(`reading ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < page) return rows;
  }
}

// ── Bluetick, written only inside a transaction ──────────────────────────────

function blueClient(envPath) {
  const env = readEnvFile(envPath);
  if (!env.DATABASE_URL) throw new Error(`${envPath} carries no DATABASE_URL`);
  return new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 0,
  });
}

/** One multi-row INSERT per chunk, ids supplied by us so nothing is guessed. */
async function insertMany(db, table, columns, rows, chunk = 500) {
  let written = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = [];
    const values = slice.map((row) => {
      const cells = columns.map((c) => {
        params.push(row[c] === undefined ? null : row[c]);
        return `$${params.length}`;
      });
      return `(${cells.join(",")})`;
    });
    const sql = `insert into ${table} (${columns.join(",")}) values ${values.join(",")}`;
    const res = await db.query(sql, params);
    written += res.rowCount;
  }
  return written;
}

/**
 * The columns this script writes, table by table. Checked against
 * information_schema before a single row is planned, because a column that has
 * moved is a run that dies half way through an --apply, and a missing `series`
 * is this whole script's reason for existing.
 */
const REQUIRED = {
  person: ["id", "phone", "wa_profile_name", "attrs", "created_at"],
  member: ["id", "workspace_id", "person_id", "label", "status", "is_owner", "reach_id", "created_at", "opted_out_at", "attrs"],
  series: ["id", "workspace_id", "title", "host_id", "capacity", "every", "at", "minutes", "starts_on", "until", "laid_through", "attrs", "created_at"],
  event: ["id", "workspace_id", "title", "starts_at", "ends_at", "host_id", "capacity", "status", "series_id", "attrs"],
  booking: ["id", "workspace_id", "event_id", "series_id", "person_id", "status", "attrs", "created_at"],
  memory: ["id", "workspace_id", "body", "subject_key", "about_person_id", "standing", "actor", "attrs", "created_at"],
  task: ["id", "workspace_id", "person_id", "subject_key", "due", "expires", "instruction", "context_query", "status", "attrs", "requested_by", "about_person_id", "created_at"],
  role: ["id", "workspace_id", "name", "description", "created_by", "attrs", "created_at"],
  role_holder: ["id", "workspace_id", "role_id", "person_id", "granted_by", "granted_at"],
  permit: ["id", "workspace_id", "role_id", "table_name", "verbs", "columns", "limits", "whose", "row_cap", "granted_by", "granted_at", "attrs"],
};

async function checkSchema(db) {
  const trouble = [];
  const rows = (await db.query(
    `select table_name, column_name, is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = any($1::text[])`,
    [Object.keys(REQUIRED)])).rows;
  const held = new Map();
  for (const r of rows) {
    if (!held.has(r.table_name)) held.set(r.table_name, new Map());
    held.get(r.table_name).set(r.column_name, r.is_nullable === "YES");
  }
  for (const [table, cols] of Object.entries(REQUIRED)) {
    const there = held.get(table);
    if (!there) { trouble.push(`table \`${table}\` does not exist`); continue; }
    const missing = cols.filter((c) => !there.has(c));
    if (missing.length) trouble.push(`\`${table}\` is missing ${missing.map((c) => `\`${c}\``).join(", ")}`);
  }
  // A standing place is a booking with no event. If event_id is still NOT NULL
  // the migration has not landed and every standing place would be refused.
  const bookingCols = held.get("booking");
  if (bookingCols && bookingCols.has("event_id") && bookingCols.get("event_id") === false) {
    trouble.push("`booking.event_id` is still NOT NULL — a standing place has no event and cannot be written");
  }
  const layDown = Number((await db.query(
    `select count(*)::int c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'lay_down' and p.pronargs = 2`)).rows[0].c);
  if (!layDown) trouble.push("`app.lay_down(uuid, uuid)` does not exist");
  return trouble;
}

// ═════════════════════════════════════════════════════════════════════════════
// Sharwin, read whole
// ═════════════════════════════════════════════════════════════════════════════

async function loadSharwin(sb, now) {
  const back = new Date(now.getTime() - SESSION_BACK_DAYS * 86400e3).toISOString();
  const fwd = new Date(now.getTime() + SESSION_FWD_DAYS * 86400e3).toISOString();
  const [profiles, coaches, players, venues, classes, sessions, bookings, privateSeries, studentNotes] =
    await Promise.all([
      fetchAll(sb, "profiles", "id,role,full_name,email,phone,deleted_at,created_at,approval_status,wa_muted"),
      fetchAll(sb, "coaches", "id,active"),
      fetchAll(sb, "players", "id,client_id,full_name,date_of_birth,skill_level,notes,school_venue_id,grade,created_at"),
      fetchAll(sb, "venues", "id,name,unit,address,postcode,notes,is_public,is_school"),
      fetchAll(sb, "classes", "id,class_type,is_school,title,capacity,duration_minutes,venue_id,recurrence_rule,starts_on,ends_on,active"),
      fetchAll(sb, "class_sessions", "id,class_id,coach_id,starts_at,ends_at,status,capacity_override",
        (q) => q.gte("starts_at", back).lte("starts_at", fwd)),
      fetchAll(sb, "bookings", "id,session_id,client_id,player_id,status,series_id,private_series_id,booked_at"),
      fetchAll(sb, "private_booking_series",
        "id,client_id,player_id,preferred_coach,weekday,start_time,duration_minutes,address,venue_id,venue_label,unit_label,active",
        (q) => q.eq("active", true)),
      fetchAll(sb, "student_notes", "id,player_id,author_id,body,created_at"),
    ]);
  return { profiles, coaches, players, venues, classes, sessions, bookings, privateSeries, studentNotes };
}

// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = [];
  const say = (line = "") => out.push(line);
  const warnings = new Map();
  const warn = (bucket, line) => {
    if (!warnings.has(bucket)) warnings.set(bucket, []);
    warnings.get(bucket).push(line);
  };

  const db = blueClient(args.bluetickEnv);
  await db.connect();
  try {
    await importRun(db, args, say, warn, warnings, out);
  } finally {
    await db.end();
  }
}

function finish(out, args, run) {
  const text = `${out.join("\n")}\n`;
  process.stdout.write(text);
  const file = args.report || path.join(DEFAULT_REPORT_DIR, `import-${run}.md`);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
    process.stderr.write(`report written to ${file}\n`);
  } catch (e) {
    process.stderr.write(`could not write the report to ${file}: ${e.message}\n`);
  }
}

async function importRun(db, args, say, warn, warnings, out) {
  const now = new Date();
  const run = `sharwin-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  // Said before anything is read: a run that dies at minute nine of an --apply
  // must still be nameable by whoever has to look at what it left behind.
  process.stderr.write(`run ${run}\n`);
  const today = istDate(now);
  const stop = (why) => { say(); say(`**Refused.** ${why} Nothing was written.`); finish(out, args, run); process.exitCode = 2; };

  say(`# Sharwin → bluetick · ${args.mode === "apply" ? "apply" : "dry run"}`);
  say();
  say(`Run \`${run}\` · workspace clock ${TZ} · today is ${today} · ${istStamp(now)}.`);
  say();
  say("Contacts and the standing weekly timetable only. No history, no school pupils, no plans, no money.");
  say();

  // ── 1 · connections ───────────────────────────────────────────────────────
  say("## Connections");
  say();
  const sb = sharwinClient();
  const probe = await sb.from("profiles").select("id", { count: "exact", head: true });
  if (probe.error) throw new Error(`Sharwin unreachable: ${probe.error.message}`);
  say(`- Sharwin (Supabase, service role, **read only**): reachable — ${probe.count} profiles.`);

  const who = (await db.query("select current_user as u")).rows[0].u;
  const wsCount = Number((await db.query("select count(*)::int c from workspace")).rows[0].c);
  say(`- bluetick (Postgres as \`${who}\`, ${args.bluetickEnv.replace(/.*[\\/]/, "…/")}): reachable.`);
  if (wsCount === 0) {
    const deeds = Number((await db.query("select count(*)::int c from deed")).rows[0].c);
    say(`- **STOP.** \`select count(*) from workspace\` returned 0 while the database holds ${deeds} deeds. \`${who}\` is confined by row security and cannot be trusted to import anything.`);
    return stop(`the connection is row-security confined.`);
  }
  say(`- Row security bypassed: \`select count(*) from workspace\` as \`${who}\` returns ${wsCount} — more than zero, so nothing is hiding.`);
  say();

  // ── 2 · the schema this script writes into ────────────────────────────────
  const trouble = await checkSchema(db);
  say("## The schema");
  say();
  if (trouble.length) {
    say("**The database is not shaped for this run.**");
    say();
    for (const t of trouble) say(`- ${t}`);
    say();
    say("The migration that adds `series` and `booking.series_id` has not landed yet. Nothing is planned and nothing is written.");
  } else {
    say("Every column this script writes is there, `booking.event_id` is nullable, and `app.lay_down(uuid, uuid)` exists.");
  }
  say();

  // ── 3 · the workspace it fills ────────────────────────────────────────────
  const ws = (await db.query(
    `select w.id, w.name, w.key, w.timezone, w.live, w.archived_at, w.attrs, w.number_id, n.phone_e164
       from workspace w left join sys.number n on n.id = w.number_id
      where w.id = $1`, [args.workspace])).rows[0];
  say("## The workspace");
  say();
  if (!ws) { say(`No workspace \`${args.workspace}\`.`); return stop("that workspace does not exist."); }
  say(`**${ws.name}** \`${ws.id}\` · number ${last4(ws.phone_e164)} · timezone ${ws.timezone} · live ${ws.live} · ${ws.archived_at ? `**archived ${istDate(ws.archived_at)}**` : "not archived"} · public diary ${ws.attrs?.public_diary === true}`);
  say();
  if (ws.archived_at) return stop("that workspace is archived.");
  if (ws.timezone !== TZ) warn("workspace", `the workspace clock is ${ws.timezone}, not ${TZ} — every \`at\` written here is an ${TZ} wall time`);

  const members = (await db.query(
    `select m.id, m.person_id, m.label, m.status, m.is_owner, m.created_at, p.phone
       from member m join person p on p.id = m.person_id
      where m.workspace_id = $1 order by m.created_at`, [ws.id])).rows;
  const holds = (await db.query(
    `select (select count(*)::int from series      where workspace_id=$1) as series,
            (select count(*)::int from event       where workspace_id=$1) as event,
            (select count(*)::int from booking     where workspace_id=$1) as booking,
            (select count(*)::int from memory      where workspace_id=$1) as memory,
            (select count(*)::int from task        where workspace_id=$1) as task,
            (select count(*)::int from role        where workspace_id=$1) as role,
            (select count(*)::int from permit      where workspace_id=$1) as permit,
            (select count(*)::int from role_holder where workspace_id=$1) as role_holder`,
    [ws.id]).catch(() => ({ rows: [null] }))).rows[0];
  for (const m of members) say(`- ${m.label} · ${m.status}${m.is_owner ? " · **owner**" : ""} · ${last4(m.phone)}`);
  if (holds) {
    say();
    say(`It holds: ${Object.entries(holds).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  }
  say();
  const owners = members.filter((m) => m.is_owner && m.status === "active");
  if (owners.length !== 1) {
    return stop(`it holds ${plural(owners.length, "active owner")}; this run fills a workspace that has exactly one.`);
  }
  // Somebody who walked in by key since the purge is real and stays: they are matched by
  // number below and dressed rather than re-made. Only the timetable and the roles must be
  // absent — a memory or a task the assistant wrote on somebody's arrival is a record, not a
  // collision.
  const mustBeEmpty = ["series", "event", "booking", "role", "permit", "role_holder"];
  if (holds && mustBeEmpty.some((k) => holds[k] !== 0)) {
    return stop("it already holds rows in series, event, booking, role, permit or role_holder.");
  }
  const ownerMember = owners[0];
  const alreadyHere = new Map(members.filter((m) => !m.is_owner && m.status === "active").map((m) => [m.phone, m]));

  // ── 4 · read Sharwin ──────────────────────────────────────────────────────
  const S = await loadSharwin(sb, now);
  const venueById = new Map(S.venues.map((v) => [v.id, v]));
  const classById = new Map(S.classes.map((c) => [c.id, c]));
  const profileById = new Map(S.profiles.map((p) => [p.id, p]));
  const playerById = new Map(S.players.map((p) => [p.id, p]));
  const activeCoachIds = new Set(S.coaches.filter((c) => c.active).map((c) => c.id));

  // ── 5 · who comes across ──────────────────────────────────────────────────
  const people = [];                 // every person this run writes or reuses
  const byPhone = new Map();         // E.164 → person plan
  const personOfProfile = new Map(); // sharwin profile id → person plan
  const personOfPlayer = new Map();  // sharwin player id → person plan
  const skipped = { noPhone: [], byPhone: [], byName: [], deleted: [], unapproved: [], seed: [], pupils: 0, schoolLogins: 0, adultSelf: [], dupChild: [] };
  const fixedPhones = [];

  const addPerson = (spec) => {
    const p = {
      id: null, memberId: randomUUID(), reused: false, isOwner: false,
      phone: null, label: "?", kind: "client", createdAt: null, optedOut: false,
      reachOf: null, attrs: {}, profileId: null, playerId: null, ...spec,
    };
    people.push(p);
    if (p.phone) byPhone.set(p.phone, p);
    if (p.profileId) personOfProfile.set(p.profileId, p);
    return p;
  };

  /** A profile this import will not carry, and why. Every one is listed. */
  const refuse = (p) => {
    if (p.deleted_at) { skipped.deleted.push(p); return "deleted"; }
    if (SEED_FOUNDER.test(p.email || "")) { skipped.seed.push(p); return "seed founder"; }
    if (p.approval_status && p.approval_status !== "approved") { skipped.unapproved.push(p); return "not approved"; }
    if (SKIP_NAMES.has(tidy(p.full_name).toLowerCase())) { skipped.byName.push(p); return "a pseudo-row, not a person"; }
    const phone = normPhone(p.phone);
    if (phone && SKIP_PHONES.has(phone)) { skipped.byPhone.push({ p, why: SKIP_PHONES.get(phone), phone }); return "a number that is not the person it claims"; }
    return null;
  };

  // 5a · the owner. The workspace already holds them; this run only dresses
  //      the row. Never is_owner, never arrived_as, never last_inbound_at.
  const ownerProfile = S.profiles.find((p) =>
    p.role === "founder" && !p.deleted_at && normPhone(p.phone) === ownerMember.phone);
  if (!ownerProfile) {
    say(`No live Sharwin founder carries ${last4(ownerMember.phone)}, the owner's number.`);
    return stop("the owner in bluetick matches no founder profile in Sharwin.");
  }
  const owner = addPerson({
    kind: "owner", isOwner: true, label: firstName(ownerProfile.full_name),
    phone: ownerMember.phone, id: ownerMember.person_id, memberId: ownerMember.id, reused: true,
    profileId: ownerProfile.id, createdAt: null,
    attrs: { imported: run, sharwin_profile_id: ownerProfile.id },
  });

  // 5b · coaches.
  for (const p of S.profiles.filter((x) => x.role === "coach" && activeCoachIds.has(x.id))) {
    const no = refuse(p);
    if (no) { warn("coaches", `coach ${p.full_name} skipped — ${no}`); continue; }
    const phone = normPhone(p.phone);
    if (!phone) { skipped.noPhone.push({ p, kind: "coach" }); warn("coaches", `coach ${p.full_name} has no usable number (${p.phone ?? "none"}) — skipped`); continue; }
    const fix = wasFixed(p.phone);
    if (fix) fixedPhones.push({ name: p.full_name, ...fix });
    if (byPhone.has(phone)) { personOfProfile.set(p.id, byPhone.get(phone)); continue; }
    addPerson({
      kind: "coach", label: tidy(p.full_name) || "Coach", phone, profileId: p.id,
      createdAt: p.created_at ?? null, optedOut: !!p.wa_muted,
      attrs: { imported: run, sharwin_profile_id: p.id, sharwin_role: "coach" },
    });
  }

  // 5c · clients. A household, reached on one number.
  for (const p of S.profiles.filter((x) => x.role === "client")) {
    const no = refuse(p);
    if (no) continue;
    const phone = normPhone(p.phone);
    if (!phone) {
      skipped.noPhone.push({ p, kind: "client" });
      warn("clients", `${p.full_name || "a client"} has no number this can reach (${p.phone ?? "none"}) — skipped`);
      continue;
    }
    const fix = wasFixed(p.phone);
    if (fix) fixedPhones.push({ name: p.full_name, ...fix });
    const seen = byPhone.get(phone);
    if (seen) {
      personOfProfile.set(p.id, seen);
      warn("clients", `${p.full_name} shares ${last4(phone)} with ${seen.label} — one number is one person, so they are ${seen.label}`);
      continue;
    }
    addPerson({
      kind: "client", label: tidy(p.full_name) || "Client", phone, profileId: p.id,
      createdAt: p.created_at ?? null, optedOut: !!p.wa_muted,
      attrs: { imported: run, sharwin_profile_id: p.id, sharwin_role: "client" },
    });
  }
  skipped.schoolLogins = S.profiles.filter((x) => x.role === "school" && !x.deleted_at).length;

  // 5d · managers, by number.
  const managerPeople = [];
  for (const raw of args.managers) {
    const phone = normPhone(raw);
    if (!phone) { warn("managers", `--manager ${raw} is not a number this can read — skipped`); continue; }
    const profile = S.profiles.find((p) => !p.deleted_at && normPhone(p.phone) === phone);
    let person = byPhone.get(phone);
    if (person) {
      person.isManager = true;
    } else {
      person = addPerson({
        kind: "manager", label: tidy(profile?.full_name) || "Manager", phone,
        profileId: profile?.id ?? null, createdAt: profile?.created_at ?? null,
        attrs: {
          imported: run, sharwin_role: "manager",
          ...(profile ? { sharwin_profile_id: profile.id } : {}),
        },
      });
      person.isManager = true;
    }
    managerPeople.push(person);
  }

  // 5e · players. 450 of them are school pupils with no client at all and are
  //      not imported: a pupil appears the day a coach names one. Of the rest,
  //      a player row carrying its own parent's name IS the parent.
  const childrenOf = new Map(); // parent person → Set(lower name)
  const orphanPlayers = [];
  for (const pl of S.players) {
    if (!pl.client_id) { skipped.pupils++; continue; }
    const parentProfile = profileById.get(pl.client_id);
    const parent = personOfProfile.get(pl.client_id);
    const name = tidy(pl.full_name);
    if (!parent) {
      orphanPlayers.push({ pl, parentProfile });
      continue;
    }
    if (same(name, parentProfile?.full_name)) {
      // The parent is the player. No second member row, and no "X is X's child".
      personOfPlayer.set(pl.id, parent);
      skipped.adultSelf.push({ name, parent: parent.label });
      continue;
    }
    if (!name) { warn("players", `player ${pl.id.slice(0, 8)} under ${parent.label} has no name — skipped`); continue; }
    if (!childrenOf.has(parent)) childrenOf.set(parent, new Map());
    const seen = childrenOf.get(parent).get(name.toLowerCase());
    if (seen) {
      personOfPlayer.set(pl.id, seen);
      skipped.dupChild.push({ name, parent: parent.label });
      continue;
    }
    const child = addPerson({
      kind: "child", label: name, phone: null, playerId: pl.id, reachOf: parent,
      createdAt: pl.created_at ?? null,
      attrs: { imported: run, sharwin_player_id: pl.id, child_of_sharwin_profile_id: pl.client_id },
    });
    childrenOf.get(parent).set(name.toLowerCase(), child);
    personOfPlayer.set(pl.id, child);
  }

  // 5f · a child whose parent this run could not carry. The loud case is a
  //      child who is on an active private slot: somebody is coaching them
  //      every week and the academy has no number for the household.
  const activePlayerIds = new Set(S.privateSeries.map((s) => s.player_id));
  for (const { pl, parentProfile } of orphanPlayers) {
    const who = `${tidy(pl.full_name) || "a player"} (parent ${parentProfile?.full_name ?? "unknown"}, ${last4(parentProfile?.phone)})`;
    if (activePlayerIds.has(pl.id)) {
      warn("unreachable", `**${who} is on an active private slot every week and their household has no number this import can use.** Their private slot is not imported.`);
    } else {
      warn("unreachable", `${who} is not imported — their parent is not carried across`);
    }
  }

  // 5g · nobody may be active twice on one sender number.
  const phones = people.filter((p) => p.phone).map((p) => p.phone);
  const existing = new Map((await db.query(
    "select id, phone from person where phone = any($1::text[])", [phones])).rows.map((r) => [r.phone, r.id]));
  for (const p of people) {
    if (p.id) continue; // the owner is already settled
    if (p.phone && existing.has(p.phone)) { p.id = existing.get(p.phone); p.reused = true; }
    else p.id = randomUUID();
  }
  // Already a member here — they arrived by key between the purge and this run. Their
  // membership is theirs: it keeps its created_at, arrived_as and last_inbound_at, and this
  // run only gives it the academy's name for them and the import's attrs.
  for (const p of people) {
    const here = p.phone ? alreadyHere.get(p.phone) : null;
    if (!here) continue;
    p.id = here.person_id;
    p.memberId = here.id;
    p.reused = true;
    p.alreadyHere = here;
    warn("people", `${p.label} (${last4(p.phone)}) walked in by key on ${istDate(here.created_at)} as "${here.label}" — the membership is kept and relabelled, not re-made`);
  }
  const clash = ws.number_id ? (await db.query(
    `select p.phone, m.label, w.name as workspace
       from member m join person p on p.id = m.person_id join workspace w on w.id = m.workspace_id
      where m.number_id = $1 and m.status = 'active' and m.workspace_id <> $2 and p.phone = any($3::text[])`,
    [ws.number_id, ws.id, phones])).rows : [];
  if (clash.length) {
    say("## Already active elsewhere on this number");
    say();
    for (const c of clash) say(`- ${c.label} ${last4(c.phone)} — active in **${c.workspace}**`);
    say();
    return stop(`${plural(clash.length, "person", "people")} hold an active membership elsewhere on this sender number (\`member_one_workspace_idx\`).`);
  }

  // ── 6 · the timetable ─────────────────────────────────────────────────────
  const sessionsByClass = new Map();
  for (const s of S.sessions) {
    if (!sessionsByClass.has(s.class_id)) sessionsByClass.set(s.class_id, []);
    sessionsByClass.get(s.class_id).push(s);
  }
  for (const list of sessionsByClass.values()) {
    list.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  }

  const series = [];
  const standing = [];
  const seriesFromClass = [];

  const venueOf = (cls) => (cls.venue_id ? venueById.get(cls.venue_id) : null);
  const titleOfClass = (cls) => {
    const v = venueOf(cls);
    const kind = cls.is_school ? "school" : "group";
    const name = tidy(v?.name);
    if (!name) { warn("venues", `${cls.title} names no venue — titled by its class`); return tidy(cls.title) || `${kind} class`; }
    return `${ACADEMY_VENUE.test(name) ? "Academy hall" : name} ${kind} class`;
  };
  const placeOf = (cls) => {
    const v = venueOf(cls);
    return { venue: tidy(v?.name) || null, venue_unit: tidy(v?.unit) || null, address: tidy(v?.address) || null };
  };

  const hostless = [];
  for (const cls of S.classes.filter((c) => c.active && /FREQ=WEEKLY/i.test(c.recurrence_rule || ""))) {
    if (cls.class_type === "private") {
      warn("classes", `${cls.title} is a weekly PRIVATE class — private arrangements come from private_booking_series, so it is not made a series`);
      continue;
    }
    const rule = String(cls.recurrence_rule).toUpperCase();
    const byday = (rule.match(/BYDAY=([A-Z,]+)/) || [])[1];
    if (!byday) { warn("classes", `${cls.title}: "${cls.recurrence_rule}" names no BYDAY — skipped`); continue; }
    const days = byday.split(",").map((d) => BYDAY[d.trim()]).filter(Boolean);
    if (!days.length) { warn("classes", `${cls.title}: "${cls.recurrence_rule}" names no weekday this can read — skipped`); continue; }
    const list = sessionsByClass.get(cls.id) || [];

    for (const wd of days) {
      const onDay = list.filter((s) => istParts(new Date(s.starts_at)).wd === wd);
      const told = onDay.filter((s) => s.status === "scheduled" || s.status === "completed");
      if (!told.length) {
        warn("timetable", `${titleOfClass(cls)} says ${WEEKDAY[wd]} but has no scheduled or completed session on a ${WEEKDAY[wd]} in the last ${SESSION_BACK_DAYS} days or the next ${SESSION_FWD_DAYS} — the slot has no time of day, so it is skipped`);
        continue;
      }
      const at = istTime(new Date(told[told.length - 1].starts_at));

      // Who takes it. The next one actually on the books, then the commonest
      // coach in the next four weeks, then — said out loud — the last coach who
      // took it, because a timetable with no coach on it helps nobody.
      const future = told.filter((s) => new Date(s.starts_at) > now && s.status === "scheduled" && s.coach_id);
      let hostProfile = future[0]?.coach_id ?? null;
      let hostFrom = "the next session on the books";
      if (!hostProfile) {
        const soon = told.filter((s) => {
          const t = new Date(s.starts_at).getTime();
          return s.coach_id && t > now.getTime() && t < now.getTime() + 28 * 86400e3;
        });
        hostProfile = commonest(soon.map((s) => s.coach_id));
        if (hostProfile) hostFrom = "the commonest coach in the next four weeks";
      }
      if (!hostProfile) {
        hostProfile = commonest(told.filter((s) => s.coach_id).map((s) => s.coach_id));
        if (hostProfile) {
          hostFrom = "the last coach who took it — nothing is on the books ahead";
          warn("hosts", `${titleOfClass(cls)} ${WEEKDAY[wd]} ${at}: no future session, so the host is the coach of its last one`);
        }
      }
      const host = hostProfile ? personOfProfile.get(hostProfile) : null;
      if (!host) {
        hostless.push(`${titleOfClass(cls)} · ${WEEKDAY[wd]} ${at}`);
        warn("hosts", `${titleOfClass(cls)} ${WEEKDAY[wd]} ${at} has no coach this import holds — host left empty`);
      }

      // A class that has not started yet must not be laid down before it does.
      const from = cls.starts_on && cls.starts_on > today ? cls.starts_on : today;
      const startsOn = nextOnWeekday(from, wd);
      if (cls.ends_on && cls.ends_on < startsOn) {
        warn("timetable", `${titleOfClass(cls)} ${WEEKDAY[wd]} ended on ${cls.ends_on} — not imported`);
        continue;
      }
      const row = {
        id: randomUUID(), title: titleOfClass(cls), weekday: wd, at,
        minutes: cls.duration_minutes > 0 ? cls.duration_minutes : null,
        host: host ?? null, capacity: cls.capacity > 0 ? cls.capacity : null,
        starts_on: startsOn, until: cls.ends_on ?? null, kind: cls.is_school ? "school" : "group",
        hostFrom: host ? hostFrom : null,
        attrs: {
          kind: cls.is_school ? "school" : "group", school: !!cls.is_school,
          ...placeOf(cls),
          sharwin: { class_id: cls.id }, imported: run,
        },
      };
      series.push(row);
      seriesFromClass.push(row);
    }
  }

  // Two classes at one venue on one day is the data saying two coaches are
  // there. Both are kept; the same time as well as the same day is a question.
  const doubled = [];
  const byVenueDay = new Map();
  for (const s of seriesFromClass) {
    const k = `${s.attrs.venue}|${s.weekday}`;
    if (!byVenueDay.has(k)) byVenueDay.set(k, []);
    byVenueDay.get(k).push(s);
  }
  for (const [k, list] of byVenueDay) {
    if (list.length < 2) continue;
    const [venue, wd] = k.split("|");
    const times = list.map((s) => s.at);
    const clashing = times.length !== new Set(times).size;
    doubled.push({ venue, weekday: Number(wd), times, clashing, hosts: list.map((s) => s.host?.label ?? "no coach") });
    if (clashing) {
      warn("timetable", `${venue} has ${list.length} classes on ${WEEKDAY[wd]} at the SAME time (${times.join(", ")}) with coaches ${list.map((s) => s.host?.label ?? "—").join(" and ")} — both kept, because the data says two`);
    }
  }

  // 6b · the private slots. One row is one arrangement, whether or not the old
  //      app ever generated a session for it.
  const privateNoCoach = [];
  const privateNeverRan = [];
  const bookedPrivate = new Set(S.bookings.filter((b) => b.private_series_id).map((b) => b.private_series_id));
  for (const ser of S.privateSeries) {
    const person = personOfPlayer.get(ser.player_id);
    const pl = playerById.get(ser.player_id);
    if (!person) {
      warn("private", `a private slot on ${WEEKDAY[ser.weekday] ?? ser.weekday} at ${hhmm(ser.start_time)} names ${tidy(pl?.full_name) || `player ${String(ser.player_id).slice(0, 8)}`}, whom this import does not hold — the slot is not imported`);
      continue;
    }
    const wd = Number(ser.weekday);
    if (!(wd >= 1 && wd <= 7)) { warn("private", `${person.label}'s private slot has weekday ${ser.weekday} — skipped`); continue; }
    const at = hhmm(ser.start_time);
    if (!at) { warn("private", `${person.label}'s private slot has no readable start time (${ser.start_time}) — skipped`); continue; }
    const host = ser.preferred_coach ? personOfProfile.get(ser.preferred_coach) : null;
    if (!host) {
      privateNoCoach.push({ who: person.label, weekday: wd, at });
      warn("private", `${person.label}'s ${WEEKDAY[wd]} ${at} private slot names ${ser.preferred_coach ? "a coach this import does not hold" : "no coach"} — host left empty`);
    }
    if (!bookedPrivate.has(ser.id)) privateNeverRan.push({ who: person.label, weekday: wd, at });
    const v = ser.venue_id ? venueById.get(ser.venue_id) : null;
    const venue = tidy(ser.venue_label) || tidy(v?.name) || tidy(String(ser.address || "").split(",")[0]) || null;
    const row = {
      id: randomUUID(), title: `${person.label} private session`, weekday: wd, at,
      minutes: ser.duration_minutes > 0 ? ser.duration_minutes : null,
      host: host ?? null, capacity: 1, starts_on: nextOnWeekday(today, wd), until: null, kind: "private",
      hostFrom: host ? "the slot's preferred coach" : null,
      attrs: {
        kind: "private", school: false, venue,
        venue_unit: tidy(ser.unit_label) || null, address: tidy(ser.address) || null,
        sharwin: { private_series_id: ser.id }, imported: run,
      },
    };
    series.push(row);
    standing.push({
      id: randomUUID(), series_id: row.id, person, seriesTitle: row.title,
      attrs: { imported: run, sharwin_private_series_id: ser.id },
    });
  }

  // 6c · one-offs: something inside five weeks that no series covers and a
  //      person this workspace holds has a live place at.
  const weeklyClassIds = new Set(S.classes.filter((c) => c.active && /FREQ=WEEKLY/i.test(c.recurrence_rule || "")).map((c) => c.id));
  const liveBookingsBySession = new Map();
  for (const b of S.bookings) {
    if (!["confirmed", "waitlisted"].includes(b.status)) continue;
    if (b.private_series_id) continue;
    if (!liveBookingsBySession.has(b.session_id)) liveBookingsBySession.set(b.session_id, []);
    liveBookingsBySession.get(b.session_id).push(b);
  }
  const oneOffs = [];
  for (const s of S.sessions) {
    if (s.status !== "scheduled") continue;
    const t = new Date(s.starts_at).getTime();
    if (!(t > now.getTime() && t < now.getTime() + ONE_OFF_DAYS * 86400e3)) continue;
    if (weeklyClassIds.has(s.class_id)) continue;
    const cls = classById.get(s.class_id);
    if (!cls) { warn("one-offs", `session ${s.id.slice(0, 8)} names a class that is not there — skipped`); continue; }
    const held = (liveBookingsBySession.get(s.id) || [])
      .map((b) => ({ b, person: personOfPlayer.get(b.player_id) }))
      .filter((x) => x.person);
    if (!held.length) continue;
    const host = s.coach_id ? personOfProfile.get(s.coach_id) : null;
    const title = cls.class_type === "private" ? `${held[0].person.label} private session` : titleOfClass(cls);
    const ev = {
      id: randomUUID(), title, starts_at: new Date(s.starts_at),
      ends_at: s.ends_at ? new Date(s.ends_at) : null,
      host: host ?? null, capacity: s.capacity_override ?? (cls.capacity > 0 ? cls.capacity : null),
      people: held.map((x) => x.person),
      attrs: {
        kind: cls.is_school ? "school" : cls.class_type === "private" ? "private" : "group",
        school: !!cls.is_school,
        ...(cls.class_type === "private" ? { venue: null, venue_unit: null, address: null } : placeOf(cls)),
        sharwin: { class_id: cls.id, session_id: s.id }, imported: run,
      },
    };
    oneOffs.push(ev);
  }

  // ── 7 · memories. Three standing rows, coach notes, and nothing else. ─────
  const memories = [];
  const remember = (body, key, about, isStanding, attrs = {}) =>
    memories.push({
      id: randomUUID(), body: cap(body), subject_key: key ? cap(key, 80) : null,
      about_person_id: about || null, standing: !!isStanding,
      attrs: { imported: run, ...attrs },
    });

  remember(
    "Sessions are paid per session. The rate is per person and is Stalin's to state — before charging anybody whose rate isn't written down, ask him. Nothing is owed from before today.",
    "how-money-works", null, true);
  remember(
    `${owner.label} runs this academy and is not technical. Keep messages short, plain and concrete. He decides prices, which coach goes where, and every change to the timetable — ask him rather than assume. He wants to be told what is happening and asked what he wants.`,
    "stalin", owner.id, true);
  remember(
    "The week's timetable is published at https://sharwinacademy.com/schedule — public group classes by venue and day, with the coach and the places left. When an owner asks for the schedule, hand them that link; give it to nobody else.",
    "schedule-page", null, true, { set_by: "operator", set_on: "2026-09-12" });

  const venueNotes = S.venues.filter((v) => tidy(v.notes));
  for (const v of venueNotes) {
    const where = [tidy(v.name), tidy(v.unit)].filter(Boolean).join(", ");
    remember(`${where} — ${tidy(v.address)}. ${tidy(v.notes)}`, `venue:${slug(v.name, v.id.slice(0, 6))}`, null, false);
  }

  let noteMemories = 0;
  for (const pl of S.players) {
    const person = personOfPlayer.get(pl.id);
    if (!person || !tidy(pl.notes)) continue;
    remember(tidy(pl.notes), `note:${pl.id.slice(0, 8)}`, person.id, false);
    noteMemories++;
  }
  for (const n of S.studentNotes) {
    const person = personOfPlayer.get(n.player_id);
    if (!person || !tidy(n.body)) continue;
    remember(tidy(n.body), `note:${String(n.player_id).slice(0, 8)}`, person.id, false);
    noteMemories++;
  }

  // ── 8 · the three tasks ───────────────────────────────────────────────────
  const coachPeople = people.filter((p) => p.kind === "coach");
  const clientPeople = people.filter((p) => p.kind === "client");
  const childPeople = people.filter((p) => p.kind === "child");
  const groupSeries = series.filter((s) => s.kind === "group");
  const schoolSeries = series.filter((s) => s.kind === "school");
  const privateSeriesRows = series.filter((s) => s.kind === "private");
  const groupVenues = new Set(groupSeries.map((s) => s.attrs.venue).filter(Boolean));
  const schoolVenues = new Set(schoolSeries.map((s) => s.attrs.venue).filter(Boolean));

  const day7 = new Date(now.getTime() + 7 * 86400e3);
  const day1 = new Date(now.getTime() + 86400e3);
  const day14 = new Date(now.getTime() + 14 * 86400e3);
  // The next 06:45 on the academy's own wall clock.
  const nowIst = istParts(now);
  let next0645 = istInstant(nowIst.y, nowIst.m, nowIst.d, 6, 45);
  if (next0645 <= now) next0645 = new Date(next0645.getTime() + 86400e3);

  const introduce = [
    `Introduce this assistant to ${owner.label}, who owns the academy, has never used it, and is not technical. Write plainly, in short sentences, no jargon and no lists of features.`,
    `Tell him what is already loaded: ${plural(coachPeople.length, "coach", "coaches")}; ${plural(clientPeople.length, "family", "families")} with ${plural(childPeople.length, "named child", "named children")} between them; and the weekly timetable — ${plural(groupSeries.length, "group class", "group classes")} across ${plural(groupVenues.size, "venue")}, ${plural(schoolSeries.length, "school class", "school classes")} across ${plural(schoolVenues.size, "school")}, and ${plural(privateSeriesRows.length, "private session")} a week.`,
    "Then say what it can take off his plate, in four plain items: (1) send him each morning's sessions grouped by coach; (2) tell coaches where they are going and tell families when something changes; (3) take bookings and cancellations from parents in their own chat; (4) keep track of who has paid for each session and remind the ones who have not.",
    "Tell him the parent and coach WhatsApp groups still do not know this number — nobody has been messaged yet, and he has to tell them himself from his own phone. The link to share is in his tail; give it to him.",
    "Then ask him which of the four he wants first, and stop. Do not promise a price or a rate: he sets those.",
    "His window is shut, so this goes out on an approved template.",
  ].join(" ");

  const gapLines = [];
  if (privateNoCoach.length) {
    gapLines.push(`Private slots with nobody named to coach them: ${privateNoCoach.map((g) => `${g.who} ${WEEKDAY[g.weekday]} ${g.at}`).join("; ")}. Ask him who takes each one.`);
  }
  for (const d of doubled.filter((x) => x.clashing)) {
    gapLines.push(`${d.venue} has two classes on ${WEEKDAY[d.weekday]} at ${d.times[0]} (${d.hosts.join(" and ")}). Both are in the timetable because the data says two. Ask him whether that is right.`);
  }
  const stalins = skipped.byPhone.filter((s) => /stalin/i.test(s.p.full_name || ""));
  if (stalins.length) {
    gapLines.push(`Two other numbers in the old system are called Stalin — ${stalins.map((s) => `${s.phone} ("${tidy(s.p.full_name)}")`).join(" and ")}. Neither was imported. Ask him whether they are his, a relative's, or old.`);
  }
  for (const f of fixedPhones) {
    gapLines.push(`${tidy(f.name)}'s number was stored as ${f.from}, which has a digit too many. It was corrected to ${f.to}. Ask him to confirm that is right.`);
  }
  if (skipped.noPhone.length) {
    gapLines.push(`These people are in the old system with no usable number and were not imported: ${skipped.noPhone.map((s) => tidy(s.p.full_name) || "unnamed").join(", ")}. Ask him for their numbers, one at a time.`);
  }
  if (privateNeverRan.length) {
    gapLines.push(`These private slots exist as arrangements but the old system never generated a session for them: ${privateNeverRan.map((g) => `${g.who} ${WEEKDAY[g.weekday]} ${g.at}`).join("; ")}. Ask him whether they still run.`);
  }
  const gapsInstruction = [
    `Work through this list with ${owner.label} one item at a time — ask one, wait for the answer, write it down, then ask the next. Never send the whole list at once.`,
    ...gapLines.map((l, i) => `${i + 1}. ${l}`),
    "When he answers, change the rows he is talking about rather than only remembering the answer.",
  ].join(" ");

  const tasks = [
    { subject_key: "introduce-yourself", due: now, expires: day7, instruction: introduce, attrs: { imported: run } },
    { subject_key: "import-gaps", due: day1, expires: day14, instruction: gapsInstruction, attrs: { imported: run } },
    {
      subject_key: "coach-schedule", due: next0645, expires: "2027-09-30 00:00+05:30",
      instruction: "Send Stalin today's sessions grouped by coach: lead with how many are on and which coaches have nothing today, then each coach's sessions with time, place and who is expected; name any session that has no coach. Keep it short. He can say 'stop the morning schedule' to end this.",
      attrs: { imported: run, every: "1 day", at: "06:45" },
    },
  ];

  // ── 9 · roles and permits ─────────────────────────────────────────────────
  const coachRoleId = randomUUID();
  const managerRoleId = randomUUID();
  const roles = [
    { id: coachRoleId, name: "Coach", description: "Takes sessions, marks who came, and writes notes about players", holders: coachPeople },
    ...(managerPeople.length ? [{ id: managerRoleId, name: "Manager", description: "Runs the day to day on the owner's behalf: people, the diary, bookings, reminders and what is owed", holders: managerPeople }] : []),
  ];
  const permits = [
    { role_id: coachRoleId, table_name: "booking", verbs: ["update"], columns: ["status"], limits: { status: { in: ["booked", "attended", "missed", "cancelled"] } }, row_cap: 30 },
    { role_id: coachRoleId, table_name: "memory", verbs: ["insert"], columns: null, limits: {}, row_cap: 10 },
    { role_id: coachRoleId, table_name: "booking", verbs: ["insert"], columns: null, limits: {}, row_cap: 10 },
    ...(managerPeople.length ? [
      { role_id: managerRoleId, table_name: "person", verbs: ["update"], columns: ["phone", "wa_profile_name", "attrs"], limits: {}, row_cap: 20 },
      { role_id: managerRoleId, table_name: "member", verbs: ["insert", "update"], columns: ["label", "reach_id", "opted_out_at", "attrs"], limits: {}, row_cap: 20 },
      { role_id: managerRoleId, table_name: "booking", verbs: ["insert", "update", "delete"], columns: null, limits: {}, row_cap: 50 },
      { role_id: managerRoleId, table_name: "event", verbs: ["insert", "update", "delete"], columns: null, limits: {}, row_cap: 30 },
      { role_id: managerRoleId, table_name: "task", verbs: ["insert", "update", "delete"], columns: null, limits: {}, row_cap: 20 },
      { role_id: managerRoleId, table_name: "memory", verbs: ["insert"], columns: null, limits: {}, row_cap: 20 },
      { role_id: managerRoleId, table_name: "ledger", verbs: ["insert", "update"], columns: null, limits: {}, row_cap: 30 },
      { role_id: managerRoleId, table_name: "mute", verbs: ["insert", "update", "delete"], columns: null, limits: {}, row_cap: 10 },
    ] : []),
  ];

  // ── 10 · what the plan came to, before anything is written ────────────────
  say("## The plan");
  say();
  say("| table | rows |");
  say("| --- | --- |");
  say(`| person | ${people.filter((p) => !p.reused).length} new, ${people.filter((p) => p.reused).length} reused |`);
  say(`| member | 1 owner updated, ${people.length - 1} inserted |`);
  say(`| series | ${series.length} — group ${groupSeries.length}, school ${schoolSeries.length}, private ${privateSeriesRows.length} |`);
  say(`| booking (standing) | ${standing.length} |`);
  say(`| event (one-off) | ${oneOffs.length} |`);
  say(`| booking (one-off) | ${oneOffs.reduce((n, e) => n + e.people.length, 0)} |`);
  say(`| memory | ${memories.length} — standing ${memories.filter((m) => m.standing).length}, notes ${noteMemories}, venue ${venueNotes.length} |`);
  say(`| task | ${tasks.length} |`);
  say(`| role | ${roles.length} · ${roles.map((r) => r.name).join(", ")} |`);
  say(`| permit | ${permits.length} |`);
  say(`| role_holder | ${roles.reduce((n, r) => n + r.holders.length, 0)} |`);
  say();

  if (trouble.length) {
    say("The plan above is real and the counts are real, but **the schema check above failed**, so no transaction was opened.");
    return stop("the database does not carry `series` yet.");
  }

  // ═══ write it — one transaction, committed only under --apply ════════════
  const counts = {};
  let laid = [];
  await db.query("begin");
  try {
    counts.person = await insertMany(db, "person", ["id", "phone", "wa_profile_name", "attrs"],
      people.filter((p) => !p.reused).map((p) => ({
        id: p.id, phone: p.phone, wa_profile_name: null,
        attrs: JSON.stringify({
          imported: run,
          ...(p.profileId ? { sharwin_profile_id: p.profileId } : {}),
          ...(p.playerId ? { sharwin_player_id: p.playerId } : {}),
        }),
      })));

    // The owner's row is dressed, never re-made. is_owner, arrived_as and
    // last_inbound_at are the workspace's own facts and are not this run's to
    // touch; created_at is when he arrived, which was before this script ran.
    await db.query("update member set label = $2, attrs = $3::jsonb where id = $1",
      [owner.memberId, owner.label, JSON.stringify(owner.attrs)]);

    // created_at is when they arrived at the academy, not when this script ran.
    // app.stamp_world_clock leaves a supplied value exactly as it was written.
    const memberRow = (p) => ({
      id: p.memberId, workspace_id: ws.id, person_id: p.id, label: p.label,
      status: "active", is_owner: false,
      reach_id: p.reachOf ? p.reachOf.memberId : null,
      created_at: p.createdAt ?? null,
      opted_out_at: p.optedOut ? now : null,
      attrs: JSON.stringify(p.attrs),
    });
    const cols = ["id", "workspace_id", "person_id", "label", "status", "is_owner", "reach_id", "created_at", "opted_out_at", "attrs"];
    // Adults first: a child's reach_id points at a member row that must be there. Somebody
    // already here is dressed, not inserted.
    const newcomer = (p) => p !== owner && !p.alreadyHere;
    counts.member = await insertMany(db, "member", cols, people.filter((p) => newcomer(p) && !p.reachOf).map(memberRow))
      + await insertMany(db, "member", cols, people.filter((p) => newcomer(p) && p.reachOf).map(memberRow));
    counts.relabelled = 0;
    for (const p of people.filter((x) => x.alreadyHere)) {
      await db.query("update member set label = $2, attrs = attrs || $3::jsonb where id = $1",
        [p.memberId, p.label, JSON.stringify(p.attrs)]);
      counts.relabelled++;
    }

    counts.role = await insertMany(db, "role", ["id", "workspace_id", "name", "description", "created_by", "attrs"],
      roles.map((r) => ({
        id: r.id, workspace_id: ws.id, name: r.name, description: r.description,
        created_by: owner.id, attrs: JSON.stringify({ imported: run }),
      })));
    counts.permit = await insertMany(db, "permit",
      ["id", "workspace_id", "role_id", "table_name", "verbs", "columns", "limits", "whose", "row_cap", "granted_by", "attrs"],
      permits.map((p) => ({
        id: randomUUID(), workspace_id: ws.id, role_id: p.role_id, table_name: p.table_name,
        verbs: p.verbs, columns: p.columns, limits: JSON.stringify(p.limits), whose: "anyone",
        row_cap: p.row_cap, granted_by: owner.id, attrs: JSON.stringify({ imported: run }),
      })));
    counts.role_holder = await insertMany(db, "role_holder",
      ["id", "workspace_id", "role_id", "person_id", "granted_by"],
      roles.flatMap((r) => r.holders.map((h) => ({
        id: randomUUID(), workspace_id: ws.id, role_id: r.id, person_id: h.id, granted_by: owner.id,
      }))));

    counts.series = await insertMany(db, "series",
      ["id", "workspace_id", "title", "host_id", "capacity", "every", "at", "minutes", "starts_on", "until", "laid_through", "attrs"],
      series.map((s) => ({
        id: s.id, workspace_id: ws.id, title: s.title, host_id: s.host ? s.host.id : null,
        capacity: s.capacity, every: "1 week", at: s.at, minutes: s.minutes,
        starts_on: s.starts_on, until: s.until, laid_through: null,
        attrs: JSON.stringify(s.attrs),
      })));

    // A standing place: no event, a series, and app.lay_down books it onto
    // every occurrence as each one is laid down.
    counts.standing = await insertMany(db, "booking",
      ["id", "workspace_id", "event_id", "series_id", "person_id", "status", "attrs"],
      standing.map((b) => ({
        id: b.id, workspace_id: ws.id, event_id: null, series_id: b.series_id,
        person_id: b.person.id, status: "booked", attrs: JSON.stringify(b.attrs),
      })));

    // One-offs go in BEFORE lay_down, so the diary it lays sits beside them.
    counts.event = await insertMany(db, "event",
      ["id", "workspace_id", "title", "starts_at", "ends_at", "host_id", "capacity", "status", "series_id", "attrs"],
      oneOffs.map((e) => ({
        id: e.id, workspace_id: ws.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at,
        host_id: e.host ? e.host.id : null, capacity: e.capacity, status: "scheduled",
        series_id: null, attrs: JSON.stringify(e.attrs),
      })));
    counts.oneOffBooking = await insertMany(db, "booking",
      ["id", "workspace_id", "event_id", "series_id", "person_id", "status", "attrs"],
      oneOffs.flatMap((e) => e.people.map((p) => ({
        id: randomUUID(), workspace_id: ws.id, event_id: e.id, series_id: null,
        person_id: p.id, status: "booked", attrs: JSON.stringify({ imported: run }),
      }))));

    laid = (await db.query(
      "select outcome, count(*)::int as n from app.lay_down(null::uuid, $1) group by 1 order by 1", [ws.id])).rows;

    counts.memory = await insertMany(db, "memory",
      ["id", "workspace_id", "body", "about_person_id", "standing", "actor", "subject_key", "attrs"],
      memories.map((m) => ({
        id: m.id, workspace_id: ws.id, body: m.body, about_person_id: m.about_person_id,
        standing: m.standing, actor: "noticed", subject_key: m.subject_key,
        attrs: JSON.stringify(m.attrs),
      })));

    counts.task = await insertMany(db, "task",
      ["id", "workspace_id", "person_id", "subject_key", "due", "expires", "instruction", "context_query", "status", "requested_by", "about_person_id", "attrs"],
      tasks.map((t) => ({
        id: randomUUID(), workspace_id: ws.id, person_id: owner.id, subject_key: t.subject_key,
        due: t.due, expires: t.expires, instruction: t.instruction, context_query: null,
        status: "pending", requested_by: null, about_person_id: null,
        attrs: JSON.stringify(t.attrs),
      })));

    // What the database itself says is there, before it is taken back.
    counts.real = (await db.query(
      `select (select count(*)::int from member      where workspace_id=$1) as member,
              (select count(*)::int from series      where workspace_id=$1) as series,
              (select count(*)::int from event       where workspace_id=$1) as event,
              (select count(*)::int from booking     where workspace_id=$1) as booking,
              (select count(*)::int from booking     where workspace_id=$1 and series_id is not null and event_id is null) as standing,
              (select count(*)::int from memory      where workspace_id=$1) as memory,
              (select count(*)::int from task        where workspace_id=$1) as task,
              (select count(*)::int from role        where workspace_id=$1) as role,
              (select count(*)::int from permit      where workspace_id=$1) as permit,
              (select count(*)::int from role_holder where workspace_id=$1) as role_holder,
              (select count(*)::int from deed        where workspace_id=$1) as deed`, [ws.id])).rows[0];

    if (args.mode === "apply") await db.query("commit");
    else {
      // A ROLLBACK never evaluates a DEFERRABLE INITIALLY DEFERRED constraint,
      // so without this a clean dry run would not prove that --apply reaches
      // COMMIT: the deferred owner-only triggers would be checked for the first
      // time on the real run. Flushing them here asks exactly the question a
      // commit would and then takes everything back anyway.
      await db.query("set constraints all immediate");
      await db.query("rollback");
    }
  } catch (e) {
    await db.query("rollback");
    say();
    say(`**Failed — the transaction rolled back. Nothing stands.** \`${e.message}\``);
    finish(out, args, run);
    throw e;
  }

  // ── 11 · the report ───────────────────────────────────────────────────────
  const wrote = args.mode === "apply" ? "was written" : "would be written";
  say(`## What ${wrote}`);
  say();
  say("Counts read back out of Postgres inside the transaction" + (args.mode === "apply" ? "." : ", which then rolled back."));
  say();
  say("| table | in the workspace | of which this run |");
  say("| --- | --- | --- |");
  say(`| person | — | ${counts.person} new, ${people.filter((p) => p.reused).length} reused |`);
  say(`| member | ${counts.real.member} | ${counts.member} inserted, 1 owner relabelled${counts.relabelled ? `, ${counts.relabelled} already here relabelled` : ""} |`);
  say(`| series | ${counts.real.series} | group ${groupSeries.length}, school ${schoolSeries.length}, private ${privateSeriesRows.length} |`);
  say(`| event | ${counts.real.event} | ${counts.event} one-off, the rest laid down by \`app.lay_down\` |`);
  say(`| booking | ${counts.real.booking} | ${counts.real.standing} standing (series, no event), ${counts.real.booking - counts.real.standing} on occurrences |`);
  say(`| memory | ${counts.real.memory} | standing ${memories.filter((m) => m.standing).length}, notes ${noteMemories}, venue ${venueNotes.length} |`);
  say(`| task | ${counts.real.task} | ${tasks.map((t) => `\`${t.subject_key}\``).join(", ")} |`);
  say(`| role | ${counts.real.role} | ${roles.map((r) => r.name).join(", ")} |`);
  say(`| permit | ${counts.real.permit} | Coach 3${managerPeople.length ? ", Manager 8" : ""} |`);
  say(`| role_holder | ${counts.real.role_holder} | ${roles.map((r) => `${r.name} ${r.holders.length}`).join(", ")} |`);
  say(`| deed | ${counts.real.deed} | written by the database, one marker per row |`);
  say();

  say("## The diary, laid down");
  say();
  say("`app.lay_down(null::uuid, workspace)` walks every series, lays its occurrences five weeks ahead and books every standing place onto each one.");
  say();
  say("| outcome | rows |");
  say("| --- | --- |");
  for (const r of laid) say(`| ${r.outcome} | ${r.n} |`);
  if (!laid.length) say("| — | nothing to lay |");
  say();

  // ── Data quality ──────────────────────────────────────────────────────────
  say("## Data quality");
  say();
  const dq = (what, found, done) => say(`| ${what} | ${found} | ${done} |`);
  say("| bucket | what was found | what was done |");
  say("| --- | --- | --- |");
  dq("client households", `${S.profiles.filter((p) => p.role === "client").length} client profiles`,
    `${clientPeople.length} imported with a usable +91 number`);
  dq("malformed number", fixedPhones.length ? fixedPhones.map((f) => `${tidy(f.name)} — ${f.from}`).join("; ") : "none",
    fixedPhones.length ? `fixed to ${fixedPhones.map((f) => f.to).join("; ")} before normalising, and handed to ${owner.label} to confirm (\`import-gaps\`)` : "—");
  dq("clients with no number", skipped.noPhone.length ? skipped.noPhone.map((s) => tidy(s.p.full_name) || "unnamed").join(", ") : "none",
    skipped.noPhone.length ? `skipped — unreachable; named to ${owner.label} in \`import-gaps\`` : "—");
  dq("numbers that are not who they say", skipped.byPhone.length ? skipped.byPhone.map((s) => `${tidy(s.p.full_name)} ${s.phone} (${s.why})`).join("; ") : "none",
    skipped.byPhone.length ? `skipped; the two called Stalin are a question for him (\`import-gaps\`)` : "—");
  dq("phoneless pseudo-rows", skipped.byName.length ? skipped.byName.map((p) => tidy(p.full_name)).join(", ") : "none",
    skipped.byName.length ? "skipped — the academy is not a person" : "—");
  dq("deleted / unapproved / seed", `${skipped.deleted.length} deleted, ${skipped.unapproved.length} unapproved, ${skipped.seed.length} seed founders`, "skipped");
  dq("adult-self player rows", `${skipped.adultSelf.length} player rows carry their own parent's name`,
    "no member row for the player — the parent IS the player, and holds their private slot");
  dq("children", `${childPeople.length} players whose name differs from the parent's`,
    `a member row each, reached through the parent (\`reach_id\`)${skipped.dupChild.length ? `; ${skipped.dupChild.length} duplicate name(s) folded` : ""}`);
  dq("school pupils", `${skipped.pupils} players with no client at all`, "**not imported** — a pupil appears the day a coach names one");
  dq("school logins", `${skipped.schoolLogins} profiles with role \`school\``, "not imported");
  dq("coaches", `${S.profiles.filter((p) => p.role === "coach").length} coach profiles, ${activeCoachIds.size} active`,
    `${coachPeople.length} imported, all holding the Coach role`);
  dq("weekly classes", `${S.classes.filter((c) => c.active && /FREQ=WEEKLY/i.test(c.recurrence_rule || "")).length} active weekly classes`,
    `${seriesFromClass.length} series (one per BYDAY weekday)`);
  dq("slots with no time of day", (warnings.get("timetable") || []).filter((l) => /no time of day/.test(l)).length || "none", "skipped and warned — nothing is invented");
  dq("slots with no coach", hostless.length ? hostless.join("; ") : "none", hostless.length ? "host left empty, listed for the owner" : "—");
  dq("doubled venue/day", doubled.length ? doubled.map((d) => `${d.venue} ${WEEKDAY[d.weekday]} (${d.times.join(", ")})`).join("; ") : "none",
    doubled.length ? "both kept — the data says two coaches are there; the clashing ones go to `import-gaps`" : "—");
  dq("private arrangements", `${S.privateSeries.length} active \`private_booking_series\``,
    `${privateSeriesRows.length} series + ${standing.length} standing places`);
  dq("private slots with no coach", privateNoCoach.length ? privateNoCoach.map((g) => `${g.who} ${WEEKDAY[g.weekday]} ${g.at}`).join("; ") : "none",
    privateNoCoach.length ? "host empty; handed to the owner (`import-gaps`)" : "—");
  dq("private slots the old app stopped generating", privateNeverRan.length ? privateNeverRan.map((g) => `${g.who} ${WEEKDAY[g.weekday]} ${g.at}`).join("; ") : "none",
    privateNeverRan.length ? "imported anyway — the row IS the arrangement; the owner is asked whether they still run" : "—");
  dq("public group class regulars", "0 bookings and 0 booking_series in the source for public group classes",
    "no standing places invented for them");
  dq("booking_series rows", "all belong to school classes", "ignored");
  dq("venue notes", `${venueNotes.length} of ${S.venues.length} venues carry notes`,
    venueNotes.length ? `${venueNotes.length} venue memory(ies)` : "no venue memories — addresses ride on the series' attrs");
  dq("coach notes", `${S.players.filter((p) => tidy(p.notes)).length} players.notes + ${S.studentNotes.length} student_notes`,
    `${noteMemories} memory(ies) about the player they name`);
  dq("muted in Sharwin", `${S.profiles.filter((p) => p.wa_muted).length}`,
    `${people.filter((p) => p.optedOut).length} membership(s) written with \`opted_out_at\` set`);
  dq("history", `${S.bookings.length} bookings and every past session`, "**not imported** — nothing is owed from before today");
  dq("one-off future sessions", `${oneOffs.length} inside ${ONE_OFF_DAYS} days with a live booking of somebody held and no series`,
    oneOffs.length ? `${oneOffs.length} event(s) + ${counts.oneOffBooking} booking(s)` : "—");
  say();

  // ── the people ────────────────────────────────────────────────────────────
  say("## The people written");
  say();
  say("| label | kind | number | reached through |");
  say("| --- | --- | --- | --- |");
  const order = { owner: 0, manager: 1, coach: 2, client: 3, child: 4 };
  for (const p of [...people].sort((a, b) => (order[a.kind] - order[b.kind]) || a.label.localeCompare(b.label))) {
    say(`| ${p.label} | ${p.kind}${p.isManager && p.kind !== "manager" ? " + manager" : ""} | ${last4(p.phone)} | ${p.reachOf ? p.reachOf.label : "—"} |`);
  }
  say();

  // ── the timetable ─────────────────────────────────────────────────────────
  say("## The timetable written");
  say();
  say("| title | day | at | minutes | coach | places | kind |");
  say("| --- | --- | --- | --- | --- | --- | --- |");
  for (const s of [...series].sort((a, b) => (a.weekday - b.weekday) || a.at.localeCompare(b.at) || a.title.localeCompare(b.title))) {
    say(`| ${s.title} | ${WEEKDAY[s.weekday]} | ${s.at} | ${s.minutes ?? "—"} | ${s.host ? s.host.label : "**none**"} | ${s.capacity ?? "no limit"} | ${s.kind} |`);
  }
  say();
  say(`Every series repeats \`every '1 week'\`, starts on its next weekday from ${today}, and carries \`until\` = the class's own end date (${series.filter((s) => s.until).length} have one).`);
  say();

  say("## The memories written");
  say();
  for (const m of memories) say(`- ${m.standing ? "**standing** · " : ""}\`${m.subject_key}\` — ${m.body}`);
  say();
  say("## The tasks written");
  say();
  for (const t of tasks) {
    say(`- \`${t.subject_key}\` · due ${t.due instanceof Date ? istStamp(t.due) : t.due} · expires ${t.expires instanceof Date ? istStamp(t.expires) : t.expires}${t.attrs.every ? ` · repeats every ${t.attrs.every} at ${t.attrs.at}` : ""}`);
    say(`  > ${t.instruction}`);
  }
  say();

  say("## Warnings");
  say();
  if (!warnings.size) say("None.");
  for (const [bucket, lines] of warnings) {
    say(`**${bucket}** — ${lines.length}`);
    for (const l of lines) say(`- ${l}`);
    say();
  }

  say("## Idempotency");
  say();
  say("This run is not idempotent and does not pretend to be. It refuses outright — exit 2, nothing written — unless the workspace exists, is not archived, has exactly one active owner and holds no series, event, booking, role, permit or role_holder at all. People who walked in by key before it ran are kept and relabelled by number. Running it twice is therefore impossible without emptying the timetable first, which is a deliberate act and not this script's to make.");
  say();
  if (args.mode !== "apply") {
    say(`**Nothing was written.** The whole plan ran against the real database inside one transaction; \`set constraints all immediate\` asked every deferred constraint the question a COMMIT would ask, and then the transaction ended in ROLLBACK. The counts above came from Postgres itself, a moment before it took them back.`);
  } else {
    say(`**Committed.** Workspace \`${ws.id}\` now carries its people, its timetable and its three tasks. \`live\` is untouched (${ws.live}).`);
  }

  finish(out, args, run);
}

/** The value that turns up most often, or null. */
function commonest(list) {
  const n = new Map();
  for (const x of list) if (x) n.set(x, (n.get(x) || 0) + 1);
  let best = null, most = 0;
  for (const [k, v] of n) if (v > most) { best = k; most = v; }
  return best;
}

main().catch((e) => {
  process.stderr.write(`${e.stack || e.message}\n`);
  process.exitCode = 1;
});
