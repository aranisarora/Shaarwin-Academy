#!/usr/bin/env node
/**
 * Move Sharwin Table Tennis Academy into a Bluetick workspace.
 *
 *   node scripts/export-to-bluetick.mjs --dry-run
 *   node scripts/export-to-bluetick.mjs --apply
 *   node scripts/export-to-bluetick.mjs --undo sharwin-20260911T153015Z
 *
 * Options
 *   --owner +91...        Repeatable. Who becomes an owner. Default: every
 *                         profile with role 'founder' that carries a phone.
 *   --since 30d           How much history to carry over (default 30d).
 *   --horizon 52w         How far forward to extend the weekly runs (52w).
 *   --demote-conflicts    Somebody already active in another workspace on this
 *                         number is written down at 'known' here instead of
 *                         refusing the whole run. They are not made an owner.
 *                         Sending the key moves them in, as it would anybody.
 *   --bluetick-env PATH   Where DATABASE_URL lives
 *                         (default C:/Users/Aranis/Desktop/bluetick/.env.local).
 *
 * SHARWIN IS NEVER WRITTEN. Every statement against Supabase here is a read.
 * BLUETICK IS WRITTEN ONLY under --apply and --undo, inside one transaction
 * that is rolled back on any error. --dry-run runs the entire plan against the
 * real database inside a transaction that always ends in ROLLBACK, so the
 * counts it prints are counts of rows that really were written and really were
 * taken back — not estimates.
 *
 * --undo ENDS A RUN, IT DOES NOT ERASE ONE. It archives the workspace the run
 * founded and steps every membership down to 'removed' — the two moves
 * app.delete_workspace() makes, in that order and for its reasons. The diary
 * goes dark, nobody is held by the workspace any more and --apply may run
 * again; the events, bookings, memories and deeds stay, because they happened.
 * See the note above undo() for why deleting them is neither wanted nor, given
 * how the deed recorder treats a delete, even possible.
 *
 * WHAT IT CANNOT DO. A memory written outside a turn lands at actor 'noticed',
 * whatever this script passes: app.memory_is_derived() derives the column from
 * the turn context, and an import has none. So nothing imported claims an owner
 * said it. That is the honest record and it is left alone.
 */

import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BLUETICK_ENV = "C:/Users/Aranis/Desktop/bluetick/.env.local";
const LIVE_NUMBER = "+12402623933";
const WORKSPACE_NAME = "Sharwin Table Tennis Academy";
const TZ = "Asia/Kolkata";
const IST_MIN = 330; // Asia/Kolkata is +05:30 all year; India keeps no DST.
const SEED_FOUNDER = /\+seedfounder@/i;

// ── argv ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    mode: null, undoRun: null, owners: [], demoteConflicts: false,
    since: "30d", horizon: "52w", bluetickEnv: DEFAULT_BLUETICK_ENV,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.mode = "dry-run";
    else if (a === "--apply") out.mode = "apply";
    else if (a === "--undo") { out.mode = "undo"; out.undoRun = argv[++i]; }
    else if (a === "--owner") out.owners.push(argv[++i]);
    else if (a === "--since") out.since = argv[++i];
    else if (a === "--horizon") out.horizon = argv[++i];
    else if (a === "--demote-conflicts") out.demoteConflicts = true;
    else if (a === "--bluetick-env") out.bluetickEnv = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.mode) throw new Error("say one of --dry-run, --apply, --undo <run-id>");
  if (out.mode === "undo" && !out.undoRun) throw new Error("--undo needs a run id");
  return out;
}

/** "30d", "52w", "6h", "1y" → milliseconds. */
function duration(text) {
  const m = String(text).match(/^(\d+)\s*([hdwy])$/i);
  if (!m) throw new Error(`cannot read a span from ${JSON.stringify(text)} — say 30d, 52w, 12h or 1y`);
  const n = Number(m[1]);
  const unit = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, y: 365 * 86400e3 }[m[2].toLowerCase()];
  return n * unit;
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

/**
 * E.164, or null when the digits do not make a number. A bare ten-digit number
 * is Indian — this academy is in Bengaluru and nothing else it holds is not.
 */
function normPhone(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[\s()\-.]/g, "");
  if (!s) return null;
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

function slug(text, fallback = "x") {
  const s = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || fallback;
}

const rupees = (paise) =>
  `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Postgres refuses a body over 500 characters, so cut before it has to. */
function cap(body, n = 500) {
  const s = String(body).replace(/\s+/g, " ").trim();
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

// ── the Asia/Kolkata wall clock ──────────────────────────────────────────────
// A fixed offset, so a week added in milliseconds is a week added on the wall.

const istOf = (d) => new Date(d.getTime() + IST_MIN * 60000);
function istParts(d) {
  const t = istOf(d);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(),
    hh: t.getUTCHours(), mi: t.getUTCMinutes(),
    wd: t.getUTCDay() === 0 ? 7 : t.getUTCDay(), // ISO 1..7
  };
}
const istInstant = (y, m, d, hh, mi) =>
  new Date(Date.UTC(y, m, d, hh, mi) - IST_MIN * 60000);
function istStamp(d) {
  const p = istParts(d);
  const z = (n, w = 2) => String(n).padStart(w, "0");
  return `${p.y}-${z(p.m + 1)}-${z(p.d)} ${z(p.hh)}:${z(p.mi)} IST`;
}
const WEEK = 7 * 86400e3;

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
 * handed back twice or skipped altogether. A skipped booking is a person with
 * no place; a skipped class_session walks a weekly run from the wrong week and
 * defeats the NEAR guard that would have caught the duplicate. So every page is
 * ordered by a key that is unique in the table, and the pages tile it exactly
 * once. `orderBy` names that key — the primary key, whatever it is called.
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

// ═════════════════════════════════════════════════════════════════════════════
// The plan
// ═════════════════════════════════════════════════════════════════════════════

async function loadSharwin(sb, sinceTs) {
  const iso = sinceTs.toISOString();
  const [
    profiles, coaches, players, venues, classes, sessions, bookings,
    bookingSeries, privateSeries, privateDetails, subscriptions, plans,
    products, settings, schoolAdmins, studentNotes,
  ] = await Promise.all([
    fetchAll(sb, "profiles", "id,role,full_name,email,phone,deleted_at,created_at,onboarded_at,default_address,wa_muted,approval_status,disputed"),
    fetchAll(sb, "coaches", "id,active,bio,base_address"),
    fetchAll(sb, "players", "id,client_id,full_name,date_of_birth,skill_level,notes,school_venue_id,grade,created_at"),
    fetchAll(sb, "venues", "id,name,unit,address,postcode,notes,is_public,is_school"),
    fetchAll(sb, "classes", "id,class_type,is_school,title,capacity,duration_minutes,venue_id,recurrence_rule,starts_on,ends_on,active,skill_level"),
    fetchAll(sb, "class_sessions", "id,class_id,coach_id,starts_at,ends_at,status,capacity_override", (q) => q.gte("starts_at", iso)),
    fetchAll(sb, "bookings", "id,session_id,client_id,player_id,status,series_id,private_series_id,booked_at"),
    fetchAll(sb, "booking_series", "id,client_id,player_id,class_id,weekday,start_time,active", (q) => q.eq("active", true)),
    fetchAll(sb, "private_booking_series", "id,client_id,player_id,preferred_coach,weekday,start_time,duration_minutes,address,venue_id,venue_label,unit_label,active", (q) => q.eq("active", true)),
    fetchAll(sb, "private_class_details", "class_id,client_id,player_id,address,postcode,venue_label,unit_label", (q) => q, ["class_id"]),
    fetchAll(sb, "subscriptions", "id,client_id,plan_id,source,status,created_at,current_period_start", (q) => q.eq("status", "active")),
    fetchAll(sb, "plans", "id,name,description,price_pence,billing_interval_months,group_sessions_per_week,private_minutes_per_cycle,private_sessions_per_week,private_session_minutes,active"),
    fetchAll(sb, "products", "id,name,description,kind,price_pence,member_price_pence,duration_minutes,active"),
    fetchAll(sb, "settings", "key,value", (q) => q, ["key"]),
    fetchAll(sb, "school_admins", "user_id,venue_id", (q) => q, ["user_id", "venue_id"]),
    fetchAll(sb, "student_notes", "id,player_id,author_id,body,created_at"),
  ]);
  // Every session of a weekly class, however old — the extension walks from the
  // last one that exists, which may sit before the history window.
  const weeklyIds = classes.filter((c) => c.active && /FREQ=WEEKLY/i.test(c.recurrence_rule || "")).map((c) => c.id);
  const olderWeekly = weeklyIds.length
    ? await fetchAll(sb, "class_sessions", "id,class_id,coach_id,starts_at,ends_at,status,capacity_override",
        (q) => q.in("class_id", weeklyIds).lt("starts_at", iso))
    : [];
  return {
    profiles, coaches, players, venues, classes, sessions, allWeeklySessions: [...olderWeekly, ...sessions],
    bookings, bookingSeries, privateSeries, privateDetails, subscriptions, plans,
    products, settings, schoolAdmins, studentNotes,
  };
}

/**
 * Everybody this import will write down, keyed by a stable Sharwin identity.
 * A phone is the identity where there is one — two profiles on one number are
 * one human being, and bluetick holds phones unique across everybody.
 */
function buildPeople(S, args, warn) {
  const people = new Map(); // key → person plan
  const byProfile = new Map();
  const byPlayer = new Map();

  const liveProfiles = S.profiles.filter((p) => !p.deleted_at && !SEED_FOUNDER.test(p.email || ""));
  const skippedSeed = S.profiles.filter((p) => SEED_FOUNDER.test(p.email || "")).length;
  const skippedDeleted = S.profiles.filter((p) => p.deleted_at).length;
  const venueById = new Map(S.venues.map((v) => [v.id, v]));
  const activeCoachIds = new Set(S.coaches.filter((c) => c.active).map((c) => c.id));

  const add = (key, spec) => {
    const seen = people.get(key);
    if (seen) {
      if (spec.profileId) seen.profileIds.add(spec.profileId);
      if (spec.isOwner) seen.isOwner = true;
      if (spec.status === "active") seen.status = "active";
      // A mute is a promise and two profiles on one number are one human being,
      // so if either of them asked not to be messaged, the person is opted out.
      if (spec.optedOut) seen.optedOut = true;
      if (spec.joinedAt && (!seen.joinedAt || String(spec.joinedAt) < String(seen.joinedAt))) {
        seen.joinedAt = spec.joinedAt;
      }
      Object.assign(seen.memberAttrs, spec.memberAttrs || {});
      return seen;
    }
    const person = {
      key,
      id: null,                       // filled in when the person row is settled
      memberId: randomUUID(),
      reused: false,
      phone: spec.phone ?? null,
      label: spec.label,
      status: spec.status,
      isOwner: !!spec.isOwner,
      kind: spec.kind,
      profileIds: new Set(spec.profileId ? [spec.profileId] : []),
      playerId: spec.playerId ?? null,
      parentKey: spec.parentKey ?? null,
      memberAttrs: spec.memberAttrs || {},
      conflict: null,
      optedOut: !!spec.optedOut,
      joinedAt: spec.joinedAt ?? null,
      dob: spec.dob ?? null,
      skill: spec.skill ?? null,
      notes: spec.notes ?? null,
    };
    people.set(key, person);
    return person;
  };

  const keyFor = (phone, fallback) => (phone ? `phone:${phone}` : fallback);

  /**
   * What Sharwin already knows about whether this person may be messaged, and
   * whether they were ever let in. A mute is a promise the new workspace must
   * inherit or it will message somebody who asked not to be; a self-signup that
   * was never approved is somebody the academy knows OF, which is `known`, not
   * somebody it deals with. Called exactly once per live profile.
   */
  let mutedCount = 0, unapprovedCount = 0, disputedCount = 0;
  const approvedIn = (p) => !p.approval_status || p.approval_status === "approved";
  const consentOf = (p) => {
    const who = `${p.full_name || "somebody"} (${last4(p.phone)})`;
    if (p.wa_muted) {
      mutedCount++;
      warn("consent", `${who} is muted in Sharwin — their membership is written opted out, so nothing reaches them`);
    }
    if (!approvedIn(p)) {
      unapprovedCount++;
      warn("consent", `${who} is ${p.approval_status} in Sharwin, not approved — written down at \`known\`, never made active`);
    }
    if (p.disputed) {
      disputedCount++;
      warn("consent", `${who} is marked disputed in Sharwin — carried across as a note on the membership`);
    }
    return {
      optedOut: !!p.wa_muted,
      joinedAt: p.created_at ?? null,
      memberAttrs: {
        ...(p.wa_muted ? { sharwin_wa_muted: true } : {}),
        ...(approvedIn(p) ? {} : { sharwin_approval_status: p.approval_status }),
        ...(p.disputed ? { sharwin_disputed: true } : {}),
      },
      /** A phone only makes somebody active if the academy actually let them in. */
      statusFor: (phone) => (phone && approvedIn(p) ? "active" : "known"),
    };
  };

  // 1 · owners.
  const wantedOwners = args.owners.map((o) => normPhone(o));
  args.owners.forEach((raw, i) => {
    if (!wantedOwners[i]) warn("owners", `--owner ${last4(raw)} is not a number this can read`);
  });
  let ownerProfiles;
  if (wantedOwners.some(Boolean)) {
    const wanted = new Set(wantedOwners.filter(Boolean));
    ownerProfiles = liveProfiles.filter((p) => wanted.has(normPhone(p.phone)));
    for (const w of wanted) {
      if (!ownerProfiles.some((p) => normPhone(p.phone) === w)) {
        throw new Error(`--owner ${last4(w)} matches no live Sharwin profile — refusing to invent an owner`);
      }
    }
  } else {
    ownerProfiles = liveProfiles.filter((p) => p.role === "founder" && normPhone(p.phone));
    for (const p of liveProfiles) {
      if (p.role === "founder" && !normPhone(p.phone)) {
        warn("owners", `founder ${p.full_name} carries no usable phone and cannot be an owner`);
      }
    }
  }
  ownerProfiles.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (!ownerProfiles.length) throw new Error("no founder with a phone, so nobody can found the workspace");
  const owners = ownerProfiles.map((p) => {
    // An owner is active whatever else is true of them — somebody has to be
    // able to run the room — but a mute is still a mute and travels with them.
    const c = consentOf(p);
    return add(keyFor(normPhone(p.phone), `profile:${p.id}`), {
      kind: "owner", label: p.full_name || "Owner", phone: normPhone(p.phone),
      status: "active", isOwner: true, profileId: p.id,
      optedOut: c.optedOut, joinedAt: c.joinedAt,
      memberAttrs: { sharwin_profile_id: p.id, sharwin_role: p.role, ...c.memberAttrs },
    });
  });

  // 2 · coaches.
  for (const p of liveProfiles.filter((x) => x.role === "coach" && activeCoachIds.has(x.id))) {
    const phone = normPhone(p.phone);
    if (p.phone && !phone) warn("phones", `coach ${p.full_name} (${last4(p.phone)}) has a phone this cannot normalise`);
    const c = consentOf(p);
    add(keyFor(phone, `profile:${p.id}`), {
      kind: "coach", label: p.full_name || "Coach", phone,
      status: "active", profileId: p.id,
      optedOut: c.optedOut, joinedAt: c.joinedAt,
      memberAttrs: { sharwin_profile_id: p.id, sharwin_role: "coach", ...c.memberAttrs },
    });
  }

  // 3 · clients.
  for (const p of liveProfiles.filter((x) => x.role === "client")) {
    const phone = normPhone(p.phone);
    if (p.phone && !phone) warn("phones", `client ${p.full_name} (${last4(p.phone)}) has a phone this cannot normalise`);
    const c = consentOf(p);
    add(keyFor(phone, `profile:${p.id}`), {
      kind: "client", label: p.full_name || "Client", phone,
      status: c.statusFor(phone), profileId: p.id,
      optedOut: c.optedOut, joinedAt: c.joinedAt,
      memberAttrs: { sharwin_profile_id: p.id, sharwin_role: "client", ...c.memberAttrs },
    });
  }

  // 4 · school logins.
  const campusesOf = new Map();
  for (const sa of S.schoolAdmins) {
    const v = venueById.get(sa.venue_id);
    if (!v) continue;
    if (!campusesOf.has(sa.user_id)) campusesOf.set(sa.user_id, []);
    campusesOf.get(sa.user_id).push(v.name);
  }
  for (const p of liveProfiles.filter((x) => x.role === "school")) {
    const phone = normPhone(p.phone);
    const c = consentOf(p);
    add(keyFor(phone, `profile:${p.id}`), {
      kind: "school_admin", label: p.full_name || "School", phone, status: "known", profileId: p.id,
      optedOut: c.optedOut, joinedAt: c.joinedAt,
      memberAttrs: {
        sharwin_profile_id: p.id, sharwin_role: "school",
        school: campusesOf.get(p.id) || [],
        ...c.memberAttrs,
      },
    });
  }

  // 5 · players. A child is reached through the parent who holds the phone; a
  //     school pupil is reached through nobody at all, and that is the truth.
  let selfPlayers = 0;
  const addParent = (parent, parentKey) => {
    const phone = normPhone(parent.phone);
    const c = consentOf(parent);
    return add(parentKey, {
      kind: "parent", label: parent.full_name || "Parent", phone,
      status: c.statusFor(phone), profileId: parent.id,
      optedOut: c.optedOut, joinedAt: c.joinedAt,
      memberAttrs: { sharwin_profile_id: parent.id, sharwin_role: parent.role, ...c.memberAttrs },
    });
  };
  for (const pl of S.players) {
    const name = (pl.full_name || "").trim();
    if (!name) warn("players", `player ${pl.id.slice(0, 8)} has no name — called "Player ${pl.id.slice(0, 6)}"`);
    const label = name || `Player ${pl.id.slice(0, 6)}`;
    if (pl.client_id) {
      const parent = S.profiles.find((p) => p.id === pl.client_id);
      const parentKey = parent && !parent.deleted_at
        ? keyFor(normPhone(parent.phone), `profile:${parent.id}`)
        : null;
      if (!parentKey) warn("players", `${label}'s parent profile is gone, so nobody carries their messages`);
      // An adult who plays has a player row of their own under their own name.
      // They are not their own child, and a workspace that said so would be
      // wrong about the one thing it must not be wrong about: who is who.
      const sameName = parent && name && parent.full_name
        && parent.full_name.trim().toLowerCase() === name.toLowerCase();
      if (sameName && parentKey) {
        const parentPerson = people.get(parentKey) || addParent(parent, parentKey);
        parentPerson.playerId = pl.id;
        parentPerson.memberAttrs.sharwin_player_id = pl.id;
        byPlayer.set(pl.id, parentPerson);
        selfPlayers++;
        continue;
      }
      // A parent none of the passes above picked up — a founder who is not on
      // the owner list, say — is still written down, because a child with a
      // parent nobody holds is a child nobody can reach.
      if (parentKey && !people.has(parentKey)) {
        addParent(parent, parentKey);
        warn("people", `${parent.full_name} (${parent.role}) is written down too, because ${label} is reached through them`);
      }
      const p = add(`player:${pl.id}`, {
        kind: "child", label, phone: null, status: "known", playerId: pl.id, parentKey,
        joinedAt: pl.created_at ?? null,
        memberAttrs: { sharwin_player_id: pl.id, child_of_sharwin_profile_id: pl.client_id },
        dob: pl.date_of_birth, skill: pl.skill_level, notes: pl.notes,
      });
      byPlayer.set(pl.id, p);
    } else if (pl.school_venue_id) {
      const v = venueById.get(pl.school_venue_id);
      const p = add(`player:${pl.id}`, {
        kind: "pupil", label, phone: null, status: "known", playerId: pl.id,
        joinedAt: pl.created_at ?? null,
        memberAttrs: {
          sharwin_player_id: pl.id,
          school: v ? v.name : null,
          grade: pl.grade ?? null,
        },
        dob: pl.date_of_birth, skill: pl.skill_level, notes: pl.notes,
      });
      byPlayer.set(pl.id, p);
    } else {
      warn("players", `player ${label} belongs to neither a parent nor a school — skipped`);
    }
  }

  for (const p of people.values()) for (const pid of p.profileIds) byProfile.set(pid, p);
  for (const [pid, p] of byPlayer) byProfile.set(`player:${pid}`, p);

  const merged = [...people.values()].filter((p) => p.profileIds.size > 1);
  for (const p of merged) warn("people", `${p.profileIds.size} Sharwin profiles share ${last4(p.phone)} and become one person: ${p.label}`);

  return {
    people, byProfile, byPlayer, owners, skippedSeed, skippedDeleted, selfPlayers,
    mutedCount, unapprovedCount, disputedCount,
  };
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
    if (args.mode === "undo") return await undo(db, args, say, out);
    await exportRun(db, args, say, warn, warnings, out);
  } finally {
    await db.end();
  }
}

// ── --undo ───────────────────────────────────────────────────────────────────

/**
 * Undo a run by ENDING the workspace it founded, not by erasing it.
 *
 * WHY NOT A DELETE. Two reasons, and the second one alone settles it.
 *
 * 1 · Bluetick's doctrine is that a workspace is archived, never deleted:
 *     app.delete_workspace() sets archived_at and steps the owner down,
 *     precisely so that "everything that happened in it stays on the record".
 *     A script that hard-deletes a tenant is the only thing in the system that
 *     can take a fact off the record, and it should not exist.
 *
 * 2 · A delete could not be made to work here anyway. app.record_deed() writes
 *     one deed row PER WATCHED COLUMN on every DELETE and suppresses itself
 *     only for an INSERT on deed itself, so a delete of a deed IS recorded.
 *     Deleting ~21,700 imported rows would write ~200,000 deeds; deleting those
 *     deeds would write millions more; and `delete from workspace` would then
 *     cascade onto rows the same statement is removing. It runs away or it dies
 *     on a foreign key. It was never once run end to end, which is exactly how
 *     a safety net that does not hold gets written down as one.
 *
 * WHAT THIS DOES INSTEAD, in the order app.delete_workspace() uses and for its
 * reason: the workspace is archived FIRST, because app.assert_owner_remains()
 * reads archived_at to decide whether a room still needs an owner, and only
 * then does every membership step down to `removed`. Ending the memberships is
 * not tidiness — member_one_workspace_idx is partial on `status = 'active'`,
 * so an archived workspace full of active members would go on blocking every
 * one of those people from ever being imported again.
 *
 * Afterwards the diary is dark, nothing is routed there, nobody is held by it,
 * and --apply may run again. The events, bookings, memories and deeds all
 * stand, which is the point: they happened.
 */
async function undo(db, args, say, out) {
  const run = args.undoRun;
  say(`# Undo \`${run}\``);
  say();
  const ws = (await db.query(
    "select id, name, archived_at from workspace where attrs->>'imported' = $1 order by created_at", [run])).rows;
  if (!ws.length) {
    say(`No workspace carries \`attrs.imported = ${run}\`. Nothing to undo.`);
    process.stdout.write(`${out.join("\n")}\n`);
    return;
  }
  const ids = ws.map((w) => w.id);
  const counts = [];
  await db.query("begin");
  try {
    const archived = await db.query(
      `update workspace set archived_at = app.now(id)
        where id = any($1::uuid[]) and archived_at is null`, [ids]);
    counts.push(["workspace archived", archived.rowCount]);

    // status_set_by is not optional: member_status_provenance_ck insists that a
    // standing somebody moved says who moved it. The workspace's own first
    // owner is the honest answer — this run made them, and this run ends it —
    // and somebody ending their own membership falls back to themselves.
    const ended = await db.query(
      `update member m
          set status = 'removed',
              status_at = app.now(m.workspace_id),
              status_set_by = coalesce(
                (select o.person_id from member o
                  where o.workspace_id = m.workspace_id and o.is_owner
                  order by o.created_at limit 1),
                m.person_id)
        where m.workspace_id = any($1::uuid[]) and m.status <> 'removed'`, [ids]);
    counts.push(["member ended", ended.rowCount]);

    // A person this run invented who ended up in no workspace at all is the one
    // thing there is no record to keep: nothing ever happened to them. A person
    // insert writes no deed (app.record_deed returns early when the row names
    // no workspace), so this deletes what it says and nothing else. A person
    // who existed before the run is never touched.
    const p = await db.query(
      `delete from person p
        where p.attrs->>'imported' = $1
          and not exists (select 1 from member m where m.person_id = p.id)`, [run]);
    counts.push(["person deleted", p.rowCount]);

    const left = (await db.query(
      `select (select count(*)::int from event   where workspace_id = any($1::uuid[])) as event,
              (select count(*)::int from booking where workspace_id = any($1::uuid[])) as booking,
              (select count(*)::int from memory  where workspace_id = any($1::uuid[])) as memory,
              (select count(*)::int from deed    where workspace_id = any($1::uuid[])) as deed`,
      [ids])).rows[0];
    await db.query("commit");
    say(`Workspaces: ${ws.map((w) => `${w.name} (${w.id})${w.archived_at ? " — already archived" : ""}`).join(", ")}`);
    say();
    say("| what | rows |");
    say("| --- | --- |");
    for (const [t, n] of counts) say(`| ${t} | ${n} |`);
    say();
    say("The workspace is archived, not erased — bluetick archives a workspace rather than deleting it (`app.delete_workspace`) so that what happened in it stays on the record. Still standing, and meant to be:");
    say();
    say(`- ${left.event} event(s), ${left.booking} booking(s), ${left.memory} memory(ies) and ${left.deed} deed(s).`);
    say();
    say("Nothing is routed to an archived workspace and its diary is no longer public. Every membership is `removed`, which is what frees those people to be imported again — `member_one_workspace_idx` counts only active ones — so `--apply` may be run afresh.");
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
  process.stdout.write(`${out.join("\n")}\n`);
}

// ── --dry-run / --apply ──────────────────────────────────────────────────────

async function exportRun(db, args, say, warn, warnings, out) {
  const now = new Date();
  const z = (n, w = 2) => String(n).padStart(w, "0");
  const run = `sharwin-${now.getUTCFullYear()}${z(now.getUTCMonth() + 1)}${z(now.getUTCDate())}T${z(now.getUTCHours())}${z(now.getUTCMinutes())}${z(now.getUTCSeconds())}Z`;
  // Said out loud before anything is read, because the report is written at the
  // end and a run that dies at minute nine of an --apply would otherwise leave
  // the operator unable to even name the run they have to undo.
  process.stderr.write(`run ${run}\n`);
  const sinceTs = new Date(now.getTime() - duration(args.since));
  const horizonTs = new Date(now.getTime() + duration(args.horizon));

  say(`# Sharwin → Bluetick · ${args.mode === "apply" ? "apply" : "dry run"}`);
  say();
  say(`Run id \`${run}\` · history from ${istStamp(sinceTs)} · horizon to ${istStamp(horizonTs)} · workspace clock ${TZ}.`);
  say();

  // ── 1 · connection checks ──────────────────────────────────────────────────
  say("## Connections");
  say();
  const sb = sharwinClient();
  const probe = await sb.from("profiles").select("id", { count: "exact", head: true });
  if (probe.error) throw new Error(`Sharwin unreachable: ${probe.error.message}`);
  say(`- Sharwin (Supabase, service role, read-only): reachable — ${probe.count} profiles.`);

  const who = (await db.query("select current_user as u")).rows[0].u;
  const wsCount = Number((await db.query("select count(*)::int c from workspace")).rows[0].c);
  say(`- Bluetick (Postgres as \`${who}\`): reachable.`);
  if (wsCount === 0) {
    const any = Number((await db.query("select count(*)::int c from deed")).rows[0].c);
    say(`- **STOP.** \`select count(*) from workspace\` returned 0 while the database holds ${any} deeds. \`${who}\` is confined by row security and cannot be trusted to import anything. Nothing was written.`);
    process.stdout.write(`${out.join("\n")}\n`);
    process.exitCode = 2;
    return;
  }
  say(`- Row security bypassed: \`select count(*) from workspace\` as \`${who}\` returns ${wsCount} — more than zero, so nothing is hiding.`);
  say();

  const numRow = (await db.query("select id from sys.number where phone_e164 = $1", [LIVE_NUMBER])).rows[0];
  if (!numRow) throw new Error(`the live number ${last4(LIVE_NUMBER)} has no sys.number row`);
  const numberId = numRow.id;

  // ── 2 · what already stands on that number ────────────────────────────────
  const standing = (await db.query(
    `select w.id, w.name, w.live, w.archived_at, w.key,
            coalesce(json_agg(json_build_object('label', m.label, 'status', m.status,
                                                'owner', m.is_owner, 'phone', p.phone)
                              order by m.created_at) filter (where m.id is not null), '[]') as members
       from workspace w
       left join member m on m.workspace_id = w.id
       left join person p on p.id = m.person_id
      where w.number_id = $1
      group by w.id
      order by w.created_at`, [numberId])).rows;

  say(`## The live number ${last4(LIVE_NUMBER)}`);
  say();
  if (!standing.length) say("No workspace stands on it yet.");
  for (const w of standing) {
    // The key is never printed. It is the words somebody sends to get in, so a
    // report that carries it is a report that lets its readers walk into a
    // workspace that is not theirs. The id names the row well enough.
    say(`- **${w.name}** — \`${w.id}\`, live ${w.live}, ${w.archived_at ? `archived ${w.archived_at.toISOString().slice(0, 10)}` : "not archived"}`);
    for (const m of w.members) {
      say(`  - ${m.label} · ${m.status}${m.owner ? " · owner" : ""} · ${last4(m.phone)}`);
    }
  }
  say();

  const clash = standing.find((w) => !w.archived_at && w.name === WORKSPACE_NAME);
  if (clash && args.mode === "apply") {
    say(`**Refused.** A workspace called ${WORKSPACE_NAME} already stands on this number (\`${clash.id}\`). Nothing was written.`);
    process.stdout.write(`${out.join("\n")}\n`);
    process.exitCode = 2;
    return;
  }
  if (clash) say(`> A workspace called ${WORKSPACE_NAME} already stands on this number — \`--apply\` would refuse.`);

  // ── 3 · read Sharwin ──────────────────────────────────────────────────────
  const S = await loadSharwin(sb, sinceTs);
  const {
    people, byProfile, byPlayer, owners, skippedSeed, skippedDeleted, selfPlayers,
    mutedCount, unapprovedCount, disputedCount,
  } = buildPeople(S, args, warn);

  // ── 4 · people already in bluetick, and who is spoken for elsewhere ───────
  const phones = [...new Set([...people.values()].map((p) => p.phone).filter(Boolean))];
  const existing = new Map(
    (await db.query("select id, phone from person where phone = any($1::text[])", [phones]))
      .rows.map((r) => [r.phone, r.id]));

  const elsewhere = (await db.query(
    `select p.phone, m.label, m.status, w.name as workspace, w.archived_at
       from member m
       join person p on p.id = m.person_id
       join workspace w on w.id = m.workspace_id
      where m.number_id = $1 and m.status = 'active' and p.phone = any($2::text[])`,
    [numberId, phones])).rows;
  const conflictByPhone = new Map(elsewhere.map((r) => [r.phone, r]));

  // A person active in another room on this number cannot be made active here
  // (member_one_workspace_idx). Under --demote-conflicts they are written down at
  // `known` instead: a known membership is outside that index, so it neither
  // breaks the room they are in nor pretends this one holds them, and sending
  // this workspace's key moves them here the way it moves anybody. A known
  // member cannot run a room, so ownership is dropped with a warning rather
  // than left on a row that could not act on it.
  const demoted = [];
  for (const p of people.values()) {
    if (p.phone && existing.has(p.phone)) { p.id = existing.get(p.phone); p.reused = true; }
    else p.id = randomUUID();
    if (p.phone && p.status === "active" && conflictByPhone.has(p.phone)) {
      const c = conflictByPhone.get(p.phone);
      if (args.demoteConflicts) {
        p.status = "known";
        if (p.isOwner) warn("owners", `${p.label} (${last4(p.phone)}) is active in "${c.workspace}" on this number — written down at known, not made an owner`);
        else warn("conflicts", `${p.label} (${last4(p.phone)}) is active in "${c.workspace}" on this number — written down at known`);
        p.isOwner = false;
        p.memberAttrs.active_elsewhere = c.workspace;
        demoted.push(p);
      } else {
        p.conflict = c;
      }
    }
  }

  const hardConflicts = [...people.values()].filter((p) => p.conflict);
  const writable = [...people.values()].filter((p) => !p.conflict);
  const founder = owners.find((o) => !o.conflict && o.isOwner);
  if (!founder) {
    say("**STOP.** Every candidate owner already holds an active membership elsewhere on this number, so nobody can found the workspace. Nothing was written.");
    say();
    for (const o of owners) say(`- ${o.label} · ${last4(o.phone)} · active in **${o.conflict ? o.conflict.workspace : o.memberAttrs.active_elsewhere}**`);
    process.stdout.write(`${out.join("\n")}\n`);
    process.exitCode = 2;
    return;
  }

  say("## Owners to be made");
  say();
  say("| name | phone | founds | note |");
  say("| --- | --- | --- | --- |");
  for (const o of owners) {
    say(`| ${o.label} | ${last4(o.phone)} | ${o === founder ? "yes" : "no"} | ${o.conflict ? `**conflict** — active in ${o.conflict.workspace}, no member row written` : o.memberAttrs.active_elsewhere ? `**written down at known** — active in ${o.memberAttrs.active_elsewhere}; not an owner here until they send the key` : o.reused ? "reuses an existing person row" : "new person row"} |`);
  }
  say();

  if (args.mode === "apply" && hardConflicts.length) {
    say(`**Refused.** ${hardConflicts.length} hard conflict(s) — a person may hold only one active membership per sender number. Nothing was written.`);
    say();
    for (const c of hardConflicts) say(`- ${c.label} · ${last4(c.phone)} · already active in **${c.conflict.workspace}**${c.conflict.archived_at ? " (archived)" : ""}`);
    process.stdout.write(`${out.join("\n")}\n`);
    process.exitCode = 2;
    return;
  }

  // ── 5 · the diary ─────────────────────────────────────────────────────────
  const classById = new Map(S.classes.map((c) => [c.id, c]));
  const venueById = new Map(S.venues.map((v) => [v.id, v]));
  const pcdByClass = new Map(S.privateDetails.map((d) => [d.class_id, d]));

  // series_key: the class title in stable words, disambiguated where two
  // classes would claim the same one.
  const slugOwners = new Map();
  for (const c of S.classes) {
    if (!c.recurrence_rule) continue;
    const s = slug(c.title, "class");
    if (!slugOwners.has(s)) slugOwners.set(s, []);
    slugOwners.get(s).push(c.id);
  }
  const seriesKeyOf = (c) => {
    if (!c.recurrence_rule) return null;
    const s = slug(c.title, "class");
    return slugOwners.get(s).length > 1 ? `${s}-${c.id.replace(/-/g, "").slice(0, 6)}` : s;
  };

  const personOfProfile = (id) => (id ? byProfile.get(id) || null : null);

  /**
   * Who carries this person's messages. A reach must have a number of their
   * own — app.assert_reach_is_dialable() is what makes the hop exactly one —
   * so a child whose parent has no phone is reachable through nobody, and the
   * row says so rather than pointing at somebody who cannot be dialled.
   */
  let unreachable = 0;
  const reachFor = (p) => {
    if (!p.parentKey) return null;
    const parent = people.get(p.parentKey);
    if (!parent || parent.conflict) { unreachable++; return null; }
    if (!parent.phone) {
      unreachable++;
      warn("reach", `${p.label} is reached through ${parent.label}, who has no number — reach left empty`);
      return null;
    }
    return parent.memberId;
  };
  const hostFor = (profileId, whereabouts) => {
    const p = personOfProfile(profileId);
    // A coach who has since been switched off is not imported, so the session
    // they take has no host here. Say so: an empty host must not be
    // indistinguishable from a session that genuinely had no coach.
    if (!p) {
      if (profileId) {
        warn("hosts", `${whereabouts}: coach profile ${String(profileId).slice(0, 8)} is not imported (inactive coach?) — host left empty`);
      }
      return null;
    }
    if (p.conflict) { warn("hosts", `${whereabouts}: host ${p.label} is in conflict and has no member row — host left empty`); return null; }
    return p.id;
  };

  function placeAttrs(cls) {
    if (cls.class_type === "private") {
      const d = pcdByClass.get(cls.id);
      return {
        venue: d ? (d.venue_label || d.address || null) : null,
        venue_unit: d ? (d.unit_label || null) : null,
        address: d ? (d.address || null) : null,
      };
    }
    const v = cls.venue_id ? venueById.get(cls.venue_id) : null;
    return { venue: v ? v.name : null, venue_unit: v ? v.unit || null : null, address: v ? v.address || null : null };
  }

  const events = [];
  const eventBySession = new Map();
  const pushEvent = (e) => { events.push(e); return e; };

  // (a) and (b) — every session Sharwin already holds inside the window.
  for (const s of S.sessions) {
    const cls = classById.get(s.class_id);
    if (!cls) { warn("events", `session ${s.id.slice(0, 8)} names a class that is not there — skipped`); continue; }
    const starts = new Date(s.starts_at);
    const place = placeAttrs(cls);
    if (!s.coach_id) warn("coaches", `${cls.title} at ${istStamp(starts)} has no coach`);
    const e = pushEvent({
      id: randomUUID(),
      title: cls.title,
      starts_at: starts,
      ends_at: s.ends_at ? new Date(s.ends_at) : null,
      host_id: hostFor(s.coach_id, `${cls.title} at ${istStamp(starts)}`),
      capacity: s.capacity_override ?? cls.capacity ?? null,
      status: s.status === "cancelled" ? "cancelled" : "scheduled",
      series_key: seriesKeyOf(cls),
      kind: cls.is_school ? "school" : cls.class_type,
      bucket: starts < now ? "history" : "future",
      attrs: {
        kind: cls.is_school ? "school" : cls.class_type,
        ...place,
        school: !!cls.is_school,
        sharwin: { class_id: cls.id, session_id: s.id, series_id: null },
        imported: run,
      },
    });
    eventBySession.set(s.id, e);
  }

  // (c) the weekly runs, carried on to the horizon.
  const sessionsByClass = new Map();
  for (const s of S.allWeeklySessions) {
    if (!sessionsByClass.has(s.class_id)) sessionsByClass.set(s.class_id, []);
    sessionsByClass.get(s.class_id).push(s);
  }
  for (const list of sessionsByClass.values()) list.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  const BYDAY = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
  const NEAR = 30 * 60000;
  let backfillSkipped = 0;
  const extendedClassEvents = [];

  for (const cls of S.classes.filter((c) => c.active && c.recurrence_rule)) {
    const rule = cls.recurrence_rule.toUpperCase();
    if (!/FREQ=WEEKLY/.test(rule) || /INTERVAL=(?!1\b)/.test(rule) || (rule.match(/BYDAY=([A-Z,]+)/)?.[1] || "").includes(",")) {
      warn("recurrence", `${cls.title}: "${cls.recurrence_rule}" is not a simple weekly rule — not extended`);
      continue;
    }
    const list = sessionsByClass.get(cls.id) || [];
    if (!list.length) { warn("recurrence", `${cls.title} repeats weekly but has no session to walk from — not extended`); continue; }
    const lastSession = list[list.length - 1];
    const lastStart = new Date(lastSession.starts_at);
    const byday = BYDAY[(rule.match(/BYDAY=([A-Z]{2})/) || [])[1]];
    if (byday && istParts(lastStart).wd !== byday) {
      warn("recurrence", `${cls.title}: BYDAY says ${Object.keys(BYDAY)[byday - 1]} but its last session falls on ISO day ${istParts(lastStart).wd} — walking from the session`);
    }
    const durMs = lastSession.ends_at
      ? new Date(lastSession.ends_at) - lastStart
      : (cls.duration_minutes || 60) * 60000;
    const host = hostFor(lastSession.coach_id, `${cls.title} (extended)`);
    const place = placeAttrs(cls);
    const endsOn = cls.ends_on ? istInstant(...cls.ends_on.split("-").map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), 23, 59) : null;
    const existingStarts = list.map((s) => new Date(s.starts_at).getTime());

    for (let t = lastStart.getTime() + WEEK; t <= horizonTs.getTime(); t += WEEK) {
      if (endsOn && t > endsOn.getTime()) break;
      if (t < now.getTime()) { backfillSkipped++; continue; }
      if (existingStarts.some((x) => Math.abs(x - t) <= NEAR)) continue;
      const starts = new Date(t);
      const e = pushEvent({
        id: randomUUID(),
        title: cls.title,
        starts_at: starts,
        ends_at: new Date(t + durMs),
        host_id: host,
        capacity: cls.capacity ?? null,
        status: "scheduled",
        series_key: seriesKeyOf(cls),
        kind: cls.is_school ? "school" : cls.class_type,
        bucket: "extended",
        classId: cls.id,
        attrs: {
          kind: cls.is_school ? "school" : cls.class_type,
          ...place,
          school: !!cls.is_school,
          sharwin: { class_id: cls.id, session_id: null, series_id: null },
          imported: run,
        },
      });
      extendedClassEvents.push(e);
    }
  }

  // (c, second half) the standing private appointments.
  const bookingsBySeries = new Map();
  const bookingsByPlayer = new Map();
  for (const b of S.bookings) {
    if (b.private_series_id) {
      if (!bookingsBySeries.has(b.private_series_id)) bookingsBySeries.set(b.private_series_id, []);
      bookingsBySeries.get(b.private_series_id).push(b);
    }
    if (!bookingsByPlayer.has(b.player_id)) bookingsByPlayer.set(b.player_id, []);
    bookingsByPlayer.get(b.player_id).push(b);
  }
  // Every session a booking of a private series can point at, old ones
  // included, so "the last one already generated for it" is a true answer and
  // not merely the last one inside the history window.
  const allSessionsById = new Map();
  for (const s of [...S.sessions, ...S.allWeeklySessions]) allSessionsById.set(s.id, s);
  const wantedOld = [...new Set(S.bookings
    .filter((b) => (b.private_series_id || b.series_id) && !allSessionsById.has(b.session_id))
    .map((b) => b.session_id))];
  for (let i = 0; i < wantedOld.length; i += 200) {
    const slice = wantedOld.slice(i, i + 200);
    const older = await fetchAll(sb, "class_sessions",
      "id,class_id,coach_id,starts_at,ends_at,status,capacity_override", (q) => q.in("id", slice));
    for (const s of older) allSessionsById.set(s.id, s);
  }

  const extendedPrivateEvents = [];
  for (const ser of S.privateSeries) {
    const player = byPlayer.get(ser.player_id);
    if (!player) { warn("private", `private series ${ser.id.slice(0, 8)} names a player this import does not hold — skipped`); continue; }
    const [hh, mi] = String(ser.start_time).split(":").map(Number);

    let base = null, how = "next occurrence after now";
    const own = (bookingsBySeries.get(ser.id) || [])
      .map((b) => allSessionsById.get(b.session_id))
      .filter(Boolean)
      .map((s) => new Date(s.starts_at).getTime());
    if (own.length) { base = Math.max(...own); how = "last session booked against the series"; }
    else {
      const theirs = (bookingsByPlayer.get(ser.player_id) || [])
        .map((b) => allSessionsById.get(b.session_id))
        .filter((s) => s && classById.get(s.class_id)?.class_type === "private")
        .map((s) => new Date(s.starts_at).getTime());
      if (theirs.length) { base = Math.max(...theirs); how = "last private session this player was booked into (the series itself carries no link)"; }
      warn("private", `${player.label}: private series ${ser.id.slice(0, 8)} has no session booked against it — walked from ${how}`);
    }
    const from = Math.max(base ?? 0, now.getTime());

    // The first slot on the series' own weekday and wall time strictly after `from`.
    const p = istParts(new Date(from));
    let first = istInstant(p.y, p.m, p.d, hh, mi || 0).getTime();
    const shift = ((ser.weekday - istParts(new Date(first)).wd) + 7) % 7;
    first += shift * 86400e3;
    while (first <= from) first += WEEK;

    // Only the player's PRIVATE sessions can duplicate a private slot. Their
    // group classes are a different thing happening at a different place, and a
    // private lesson half an hour after Tuesday's group is not a double entry —
    // it is the lesson, and leaving it out would take it off the diary.
    const near = (bookingsByPlayer.get(ser.player_id) || [])
      .map((b) => allSessionsById.get(b.session_id))
      .filter((s) => s && classById.get(s.class_id)?.class_type === "private")
      .map((s) => new Date(s.starts_at).getTime());
    const label = ser.venue_label || String(ser.address || "").split(/[,\n]/)[0].trim() || "home";
    const host = hostFor(ser.preferred_coach, `private series for ${player.label}`);
    if (!ser.preferred_coach) warn("coaches", `private series for ${player.label} names no preferred coach`);

    for (let t = first; t <= horizonTs.getTime(); t += WEEK) {
      if (near.some((x) => Math.abs(x - t) <= NEAR)) continue;
      const e = pushEvent({
        id: randomUUID(),
        title: `Private session · ${label}`,
        starts_at: new Date(t),
        ends_at: new Date(t + (ser.duration_minutes || 60) * 60000),
        host_id: host,
        capacity: 1,
        status: "scheduled",
        series_key: `private-${ser.id.replace(/-/g, "").slice(0, 6)}`,
        kind: "private",
        bucket: "extended",
        privateSeriesId: ser.id,
        playerId: ser.player_id,
        attrs: {
          kind: "private",
          venue: ser.venue_label || ser.address || null,
          venue_unit: ser.unit_label || null,
          address: ser.address || null,
          school: false,
          sharwin: { class_id: null, session_id: null, series_id: ser.id },
          imported: run,
        },
      });
      extendedPrivateEvents.push(e);
    }
  }

  // ── 6 · bookings ──────────────────────────────────────────────────────────
  const RANK = { attended: 4, missed: 3, booked: 2, waitlisted: 1, cancelled: 0 };
  const STATUS = {
    confirmed: "booked", waitlisted: "waitlisted", attended: "attended", no_show: "missed",
    rescheduled: "cancelled", cancelled_by_client: "cancelled", cancelled_by_academy: "cancelled",
  };
  const bookings = new Map(); // `${eventId}:${personId}` → row
  let bookingsCollapsed = 0, bookingsDroppedConflict = 0, bookingsNoPerson = 0;

  /**
   * `takenAt` is when the place was actually taken — Sharwin's booked_at where
   * there is one. A generated place has none: it is a standing arrangement this
   * script turned into a row just now, and now is the honest answer for it.
   * Where two collapse onto one place the earlier moment is kept, because that
   * is when this person first had a place at this event.
   */
  const place = (event, person, status, attrs, takenAt = null) => {
    if (!person) { bookingsNoPerson++; return; }
    if (person.conflict) { bookingsDroppedConflict++; return; }
    const k = `${event.id}:${person.id}`;
    const seen = bookings.get(k);
    if (seen) {
      bookingsCollapsed++;
      if (RANK[status] > RANK[seen.status]) { seen.status = status; seen.attrs = attrs; }
      if (takenAt && (!seen.created_at || String(takenAt) < String(seen.created_at))) seen.created_at = takenAt;
      return;
    }
    bookings.set(k, { id: randomUUID(), event_id: event.id, person_id: person.id, status, attrs, created_at: takenAt });
  };

  for (const b of S.bookings) {
    const e = eventBySession.get(b.session_id);
    if (!e) continue;
    place(e, byPlayer.get(b.player_id), STATUS[b.status] || "booked",
      { imported: run, sharwin_booking_id: b.id }, b.booked_at ?? null);
  }

  // The standing arrangements, carried onto the events we generated.
  const seriesByClass = new Map();
  for (const bs of S.bookingSeries) {
    if (!seriesByClass.has(bs.class_id)) seriesByClass.set(bs.class_id, []);
    seriesByClass.get(bs.class_id).push(bs);
  }
  // Nothing in the database stops a place being written past a capacity —
  // app.book() is what enforces it and a raw insert never calls it. So count,
  // and say so, rather than either dropping somebody's standing place or
  // publishing a diary that reads 35/30 with nobody having been told.
  let overbooked = 0;
  const placedOn = new Map();
  for (const e of extendedClassEvents) {
    const list = seriesByClass.get(e.classId);
    if (!list) continue;
    const p = istParts(e.starts_at);
    for (const bs of list) {
      const [hh, mi] = String(bs.start_time).split(":").map(Number);
      if (bs.weekday !== p.wd || hh !== p.hh || (mi || 0) !== p.mi) continue;
      const before = bookings.size;
      place(e, byPlayer.get(bs.player_id), "booked", { imported: run, sharwin_series_id: bs.id });
      if (bookings.size === before) continue; // dropped, collapsed or nobody to place
      const taken = (placedOn.get(e.id) || 0) + 1;
      placedOn.set(e.id, taken);
      if (e.capacity != null && taken > e.capacity) {
        overbooked++;
        if (taken === e.capacity + 1) {
          warn("capacity", `${e.title} on ${istStamp(e.starts_at)} holds ${e.capacity} but ${list.length} standing arrangements match its weekday and time — the diary will read over capacity`);
        }
      }
    }
  }
  for (const e of extendedPrivateEvents) {
    place(e, byPlayer.get(e.playerId), "booked", { imported: run, sharwin_private_series_id: e.privateSeriesId });
  }

  // ── 7 · memories ──────────────────────────────────────────────────────────
  const setting = (k, fallback) => {
    const row = S.settings.find((s) => s.key === k);
    return row ? row.value : fallback;
  };
  const memories = [];
  const remember = (body, key, about, standingRow) =>
    memories.push({
      id: randomUUID(), body: cap(body), subject_key: key ? cap(key, 80) : null,
      about_person_id: about || null, standing: !!standingRow,
      attrs: { imported: run },
    });

  /** Standing memories are read on every turn, so they are few and they are short. */
  const standingRows = (prefix, parts, key) => {
    const rows = [];
    let body = prefix;
    for (const part of parts) {
      if (`${body} ${part}`.length > 500) { if (body !== prefix) rows.push(body); body = prefix; }
      body = `${body} ${part}`;
    }
    if (body !== prefix) rows.push(body);
    rows.forEach((b, i) => remember(b, rows.length > 1 ? `${key}-${i + 1}` : key, null, true));
  };

  const houseRules = [
    `Cancel or move a booking at least ${setting("cancellation_window_hours", 24)} hours before it starts.`,
    `Booking closes ${setting("booking_cutoff_minutes", 60)} minutes before a session begins.`,
    `A place offered from the waitlist is held for ${setting("waitlist_claim_minutes", 15)} minutes, then passes on.`,
    `A late payment has ${setting("dunning_grace_days", 7)} days of grace before it is chased.`,
  ];
  standingRows("How things run here:", houseRules, "house-rules");

  const activePlans = S.plans.filter((p) => p.active);
  const planLine = (p) => {
    const every = p.billing_interval_months === 1 ? "month" : `${p.billing_interval_months} months`;
    return `${p.name} ${rupees(p.price_pence)}/${every};`;
  };
  standingRows("Current plans:", activePlans.map(planLine), "plans");

  for (const p of activePlans) {
    const bits = [`${p.name}: ${rupees(p.price_pence)} every ${p.billing_interval_months === 1 ? "month" : `${p.billing_interval_months} months`}.`];
    if (p.group_sessions_per_week) bits.push(`${p.group_sessions_per_week} group session${p.group_sessions_per_week > 1 ? "s" : ""} a week.`);
    if (p.private_sessions_per_week) bits.push(`${p.private_sessions_per_week} private session${p.private_sessions_per_week > 1 ? "s" : ""} a week${p.private_session_minutes ? `, ${p.private_session_minutes} minutes each` : ""}.`);
    else if (p.private_minutes_per_cycle) bits.push(`${p.private_minutes_per_cycle} private minutes a cycle.`);
    if (p.description) bits.push(p.description);
    remember(bits.join(" "), `plan:${slug(p.name, p.id.slice(0, 6))}`, null, false);
  }
  for (const pr of S.products.filter((x) => x.active)) {
    const bits = [`${pr.name}: ${rupees(pr.price_pence)}`];
    if (pr.member_price_pence != null) bits.push(`(${rupees(pr.member_price_pence)} on a group plan)`);
    if (pr.duration_minutes) bits.push(`· ${pr.duration_minutes} minutes`);
    if (pr.description) bits.push(`· ${pr.description}`);
    remember(`${bits.join(" ")}.`, `plan:${slug(pr.id, "product")}`, null, false);
  }
  for (const v of S.venues.filter((x) => x.is_public)) {
    const post = v.postcode && !String(v.address || "").includes(v.postcode) ? `, ${v.postcode}` : "";
    const bits = [v.unit ? `${v.name}, ${v.unit}` : v.name, "—", `${v.address}${post}.`];
    if (v.notes) bits.push(v.notes);
    remember(bits.join(" "), `venue:${slug(v.name, v.id.slice(0, 6))}`, null, false);
  }
  const planById = new Map(S.plans.map((p) => [p.id, p]));
  for (const sub of S.subscriptions) {
    const person = byProfile.get(sub.client_id);
    if (!person || person.conflict) continue;
    const plan = planById.get(sub.plan_id);
    const paid = sub.source === "comp" ? "complimentary" : sub.source === "razorpay" ? "paid via Razorpay" : sub.source;
    const since = String(sub.current_period_start || sub.created_at).slice(0, 10);
    remember(`${person.label} is on ${plan ? plan.name : "a plan"} (${paid}), since ${since}.`,
      `arrangement:${person.id}`, person.id, false);
  }
  const notesByPlayer = new Map();
  for (const n of S.studentNotes) {
    if (!notesByPlayer.has(n.player_id)) notesByPlayer.set(n.player_id, []);
    notesByPlayer.get(n.player_id).push(n);
  }
  for (const child of [...people.values()].filter((p) => p.kind === "child" && !p.conflict)) {
    const parent = child.parentKey ? people.get(child.parentKey) : null;
    const bits = [parent ? `${child.label} is ${parent.label}'s child.` : `${child.label} is a child here.`];
    if (child.skill) bits.push(`Plays at ${child.skill} level.`);
    if (child.dob) bits.push(`Born ${child.dob}.`);
    if (child.notes) bits.push(child.notes);
    const notes = notesByPlayer.get(child.playerId) || [];
    if (notes.length === 1) bits.push(notes[0].body);
    else if (notes.length > 1) warn("notes", `${child.label} has ${notes.length} coach notes — none were folded in`);
    remember(bits.join(" "), `child:${child.id}`, child.id, false);
  }

  // ── 8 · role, permits, holders ────────────────────────────────────────────
  const roleId = randomUUID();
  const coachPeople = [...people.values()].filter((p) => p.kind === "coach" && !p.conflict);
  const permits = [
    { table_name: "booking", verbs: ["update"], columns: ["status"], whose: "anyone",
      limits: { status: { in: ["booked", "attended", "missed", "cancelled"] } }, row_cap: 30 },
    { table_name: "memory", verbs: ["insert"], columns: null, whose: "anyone", limits: {}, row_cap: 10 },
    { table_name: "booking", verbs: ["insert"], columns: null, whose: "anyone", limits: {}, row_cap: 10 },
  ];

  // ═══ write it — one transaction, committed only under --apply ════════════
  //
  // Order is forced by the schema: app.create_workspace needs its founder to be
  // a person already, so the people go in first and the workspace second; a
  // child's member row needs its parent's, so the adults go in before them.
  const counts = {};
  let committed = false;
  await db.query("begin");
  try {
    counts.person_new = await insertMany(db, "person", ["id", "phone", "wa_profile_name", "attrs"],
      writable.filter((p) => !p.reused).map((p) => ({
        id: p.id,
        phone: p.phone,
        wa_profile_name: null,
        attrs: JSON.stringify({
          imported: run,
          ...(p.profileIds.size ? { sharwin_profile_id: [...p.profileIds][0] } : {}),
          ...(p.profileIds.size > 1 ? { sharwin_profile_ids: [...p.profileIds] } : {}),
          ...(p.playerId ? { sharwin_player_id: p.playerId } : {}),
        }),
      })));
    counts.person_reused = writable.filter((p) => p.reused).length;

    const workspaceId = (await db.query("select app.create_workspace($1,$2,$3) as id",
      [WORKSPACE_NAME, founder.id, numberId])).rows[0].id;
    await db.query("update workspace set timezone = $2, attrs = attrs || $3::jsonb where id = $1",
      [workspaceId, TZ, JSON.stringify({ public_diary: true, imported: run })]);
    const wsRow = (await db.query("select key, timezone, live from workspace where id=$1", [workspaceId])).rows[0];
    counts.workspace = 1;
    counts.key = wsRow.key;

    // create_workspace wrote the founder's member row itself; take its id and
    // dress it with what this import knows.
    founder.memberId = (await db.query(
      "select id from member where workspace_id=$1 and person_id=$2", [workspaceId, founder.id])).rows[0].id;
    await db.query(
      `update member
          set label = $2,
              attrs = attrs || $3::jsonb,
              created_at = coalesce($4::timestamptz, created_at),
              opted_out_at = coalesce(opted_out_at, $5::timestamptz)
        where id = $1`,
      [founder.memberId, founder.label, JSON.stringify({ imported: run, ...founder.memberAttrs }),
       founder.joinedAt, founder.optedOut ? now : null]);

    // created_at is when they arrived at the academy, not when this script ran.
    // A workspace whose every member appears to have joined in the same second
    // is wrong about its own history from its first day, and deed reads its
    // stamp off the same clock. app.stamp_world_clock leaves a column that
    // already carries a value exactly as it was written, so this holds.
    const memberRow = (p) => ({
      id: p.memberId, workspace_id: workspaceId, person_id: p.id, label: p.label,
      status: p.status, is_owner: p.isOwner,
      reach_id: reachFor(p),
      created_at: p.joinedAt ?? null,
      opted_out_at: p.optedOut ? now : null,
      attrs: JSON.stringify({ imported: run, ...p.memberAttrs }),
    });
    const cols = ["id", "workspace_id", "person_id", "label", "status", "is_owner", "reach_id",
                  "created_at", "opted_out_at", "attrs"];
    const adults = writable.filter((p) => p !== founder && !p.parentKey);
    const children = writable.filter((p) => p !== founder && p.parentKey);
    counts.member = 1
      + await insertMany(db, "member", cols, adults.map(memberRow))
      + await insertMany(db, "member", cols, children.map(memberRow));

    counts.event = await insertMany(db, "event",
      ["id", "workspace_id", "title", "starts_at", "ends_at", "host_id", "capacity", "status", "series_key", "attrs"],
      events.map((e) => ({
        id: e.id, workspace_id: workspaceId, title: e.title, starts_at: e.starts_at,
        ends_at: e.ends_at, host_id: e.host_id, capacity: e.capacity, status: e.status,
        series_key: e.series_key, attrs: JSON.stringify(e.attrs),
      })));

    counts.booking = await insertMany(db, "booking",
      ["id", "workspace_id", "event_id", "person_id", "status", "created_at", "attrs"],
      [...bookings.values()].map((b) => ({
        id: b.id, workspace_id: workspaceId, event_id: b.event_id, person_id: b.person_id,
        status: b.status, created_at: b.created_at ?? null, attrs: JSON.stringify(b.attrs),
      })));

    counts.memory = await insertMany(db, "memory",
      ["id", "workspace_id", "body", "about_person_id", "standing", "actor", "subject_key", "attrs"],
      memories.map((m) => ({
        id: m.id, workspace_id: workspaceId, body: m.body, about_person_id: m.about_person_id,
        standing: m.standing, actor: "noticed", subject_key: m.subject_key,
        attrs: JSON.stringify(m.attrs),
      })));

    counts.role = await insertMany(db, "role",
      ["id", "workspace_id", "name", "description", "created_by", "attrs"],
      [{ id: roleId, workspace_id: workspaceId, name: "Coach",
         description: "Takes classes, marks who came, and writes notes about players",
         created_by: founder.id, attrs: JSON.stringify({ imported: run }) }]);

    counts.permit = await insertMany(db, "permit",
      ["id", "workspace_id", "role_id", "table_name", "verbs", "columns", "limits", "whose", "row_cap", "granted_by", "attrs"],
      permits.map((p) => ({
        id: randomUUID(), workspace_id: workspaceId, role_id: roleId, table_name: p.table_name,
        verbs: p.verbs, columns: p.columns, limits: JSON.stringify(p.limits), whose: p.whose,
        row_cap: p.row_cap, granted_by: founder.id, attrs: JSON.stringify({ imported: run }),
      })));

    counts.role_holder = await insertMany(db, "role_holder",
      ["id", "workspace_id", "role_id", "person_id", "granted_by"],
      coachPeople.map((c) => ({
        id: randomUUID(), workspace_id: workspaceId, role_id: roleId,
        person_id: c.id, granted_by: founder.id,
      })));

    // What the database itself says is there, before it is taken back.
    const real = (await db.query(
      `select (select count(*)::int from member   where workspace_id=$1) as member,
              (select count(*)::int from event    where workspace_id=$1) as event,
              (select count(*)::int from booking  where workspace_id=$1) as booking,
              (select count(*)::int from memory   where workspace_id=$1) as memory,
              (select count(*)::int from role     where workspace_id=$1) as role,
              (select count(*)::int from permit   where workspace_id=$1) as permit,
              (select count(*)::int from role_holder where workspace_id=$1) as role_holder,
              (select count(*)::int from deed     where workspace_id=$1) as deed`, [workspaceId])).rows[0];
    counts.verified = real;
    counts.workspaceId = workspaceId;

    if (args.mode === "apply") { await db.query("commit"); committed = true; }
    else {
      // A ROLLBACK never evaluates a DEFERRABLE INITIALLY DEFERRED constraint,
      // so without this a clean dry run would not prove that --apply reaches
      // COMMIT: the six deferred owner-only triggers would be checked for the
      // first time on the real run. Flushing them here asks exactly the
      // question a commit would and then takes everything back anyway. The
      // warning in 0010_permits.sql against flushing ALL is aimed at the
      // runtime executor, which speaks for a person; this session has no
      // speaker, which is the case app.assert_owner_acts() exempts outright.
      await db.query("set constraints all immediate");
      await db.query("rollback");
    }
  } catch (e) {
    await db.query("rollback");
    // Say what was learned before dying, so a failure at minute nine of an
    // --apply is still a readable report and not just a stack trace.
    if (out.length) process.stdout.write(`${out.join("\n")}\n\n**Failed — the transaction rolled back.**\n`);
    throw e;
  }

  // ── 9 · the report ────────────────────────────────────────────────────────
  const by = (list, f) => list.reduce((acc, x) => { const k = f(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const tally = (o) => Object.entries(o).sort().map(([k, v]) => `${k} ${v}`).join(", ") || "—";

  say(`## What ${args.mode === "apply" ? "was" : "would be"} written`);
  say();
  say(`Workspace \`${counts.workspaceId}\` · key \`${counts.key}\` · timezone ${TZ} · live **false** (the founder's own switch) · \`attrs.public_diary = true\`.`);
  say();
  say("| table | rows | shape |");
  say("| --- | --- | --- |");
  say(`| workspace | 1 | ${WORKSPACE_NAME} |`);
  say(`| person | ${counts.person_new} new, ${counts.person_reused} reused | reused = a person row already carrying that phone |`);
  say(`| member | ${counts.verified.member} | ${tally(by(writable, (p) => p.status))} · owners ${writable.filter((p) => p.isOwner).length} · reached through a parent ${writable.filter((p) => p.parentKey).length - unreachable} |`);
  say(`| event | ${counts.verified.event} | by kind: ${tally(by(events, (e) => e.kind))} · by origin: ${tally(by(events, (e) => e.bucket))} |`);
  say(`| booking | ${counts.verified.booking} | ${tally(by([...bookings.values()], (b) => b.status))} |`);
  say(`| memory | ${counts.verified.memory} | standing ${memories.filter((m) => m.standing).length}, told when it is relevant ${memories.filter((m) => !m.standing).length} |`);
  say(`| role | ${counts.verified.role} | Coach |`);
  say(`| permit | ${counts.verified.permit} | on the Coach role |`);
  say(`| role_holder | ${counts.verified.role_holder} | one per active coach |`);
  say(`| deed | ${counts.verified.deed} | written by the database, one marker per row |`);
  say();
  say(`Counts are read back out of Postgres inside the transaction${args.mode === "apply" ? "" : ", which then rolled back — nothing stands"}.`);
  say();

  say("## Conflicts");
  say();
  if (!hardConflicts.length) say("No hard conflict: nobody this import makes active already holds an active membership on this number.");
  else {
    say(`**${hardConflicts.length} hard.** A person may hold one active membership per sender number (\`member_one_workspace_idx\`). \`--apply\` refuses while any stands.`);
    say();
    say("| who | phone | already active in |");
    say("| --- | --- | --- |");
    for (const c of hardConflicts) say(`| ${c.label} | ${last4(c.phone)} | ${c.conflict.workspace}${c.conflict.archived_at ? " (archived)" : ""} |`);
    say();
    say("The way through is to end the other membership first — archive that workspace, or remove them from it — and run again. `--owner` only helps when the person in the way is an owner and nothing else here; somebody who also plays or coaches is written down whoever owns the room. Nothing here weakens a row to get past it. `--demote-conflicts` writes them down at `known` instead, which is not weaker: it is the standing of somebody this room has been told about and who has not yet walked in.");
  }
  if (demoted.length) {
    say();
    say(`**${demoted.length} written down at known** (\`--demote-conflicts\`): active in another room on this number, so not active here and not an owner. Sending this workspace's key moves them in.`);
    say();
    say("| who | phone | active in |");
    say("| --- | --- | --- |");
    for (const p of demoted) say(`| ${p.label} | ${last4(p.phone)} | ${p.memberAttrs.active_elsewhere} |`);
  }
  say();
  say(`**Soft.** ${counts.person_reused} person row(s) already exist on these phones and are reused rather than duplicated — that is the intended behaviour, not a problem.`);
  if (bookingsDroppedConflict) say(`${bookingsDroppedConflict} booking(s) dropped because the person they belong to is in conflict and gets no member row.`);
  if (bookingsNoPerson) say(`${bookingsNoPerson} booking(s) name a player this import does not hold.`);
  if (bookingsCollapsed) say(`${bookingsCollapsed} Sharwin booking(s) collapsed onto an existing (event, person) pair; the strongest outcome won.`);
  if (selfPlayers) say(`${selfPlayers} player row(s) carry their own client's name — an adult who plays, not a child. They are the same person here, with one member row, and no "X is X's child" memory.`);
  if (backfillSkipped) say(`${backfillSkipped} weekly occurrence(s) fell before now and were not invented as history.`);
  if (unreachable) say(`${unreachable} child(ren) have a parent with no number, so nobody carries their messages and \`reach_id\` is empty — the database refuses a reach who cannot be dialled.`);
  say(`**Consent.** ${mutedCount} person(s) muted in Sharwin — their membership is written with \`opted_out_at\` set, so the workspace sends them nothing. ${unapprovedCount} whose Sharwin sign-up was never approved are written down at \`known\` rather than made active. ${disputedCount} marked disputed, carried as a note on the membership.`);
  if (overbooked) {
    say(`**Over capacity.** ${overbooked} place(s) land on a generated class that is already full. Nothing in the database refuses them — \`app.book()\` is what enforces a capacity and a straight insert never calls it — so they are written and said out loud here instead: the diary will show those classes over their limit until somebody sorts them out.`);
  }
  say();

  say("## Warnings");
  say();
  if (!warnings.size) say("None.");
  for (const [bucket, lines] of warnings) {
    say(`**${bucket}** — ${lines.length}`);
    for (const l of lines.slice(0, 6)) say(`- ${l}`);
    if (lines.length > 6) say(`- …and ${lines.length - 6} more`);
    say();
  }
  const clean = [
    ["phones that would not normalise", (warnings.get("phones") || []).length],
    ["recurrence rules that are not simple weekly", (warnings.get("recurrence") || []).length],
    ["private series that could not be placed", (warnings.get("private") || []).length],
    ["players with no name", (warnings.get("players") || []).length],
    ["coach notes too many to fold in", (warnings.get("notes") || []).length],
    ["sessions whose host had to be dropped", (warnings.get("hosts") || []).length],
    ["people muted, unapproved or disputed in Sharwin", (warnings.get("consent") || []).length],
    ["generated classes written over their capacity", (warnings.get("capacity") || []).length],
  ].filter(([, n]) => n === 0).map(([w]) => w);
  if (clean.length) { say(`Checked and clean: ${clean.join("; ")} — none.`); say(); }

  say("## Five events");
  say();
  say("| title | starts (IST) | host | venue | seats |");
  say("| --- | --- | --- | --- | --- |");
  const personLabel = new Map([...people.values()].map((p) => [p.id, p.label]));
  const sample = [...events].sort((a, b) => a.starts_at - b.starts_at)
    .filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 5)) === 0).slice(0, 5);
  for (const e of sample) {
    say(`| ${e.title} | ${istStamp(e.starts_at)} | ${e.host_id ? personLabel.get(e.host_id) || "—" : "—"} | ${e.attrs.venue || "—"} | ${e.capacity ?? "no limit"} |`);
  }
  say();
  say("## Three memories");
  say();
  for (const m of [memories.find((x) => x.standing), memories.find((x) => x.subject_key?.startsWith("venue:")), memories.find((x) => x.subject_key?.startsWith("child:"))].filter(Boolean)) {
    say(`- ${m.standing ? "**standing** · " : ""}\`${m.subject_key}\` — ${m.body}`);
  }
  say();
  say("## Idempotency");
  say();
  say([
    "This script is not idempotent and does not pretend to be: a second `--apply` would found a second workspace.",
    `It is instead refused — \`--apply\` exits 2 without writing when a non-archived workspace called ${WORKSPACE_NAME} already stands on ${last4(LIVE_NUMBER)}, and again when any hard conflict stands.`,
    "Every row it writes carries `attrs.imported` set to the run id, and `--undo <run-id>` ENDS that run: it archives the workspace and steps every membership down to `removed`, which is what frees those people and lets `--apply` run again.",
    "It does not erase anything — bluetick archives a workspace rather than deleting it, so the events, bookings, memories and deeds all stay on the record, and so does anything real people wrote after the import.",
    "Person rows that already existed are reused, never rewritten, and `--undo` leaves them where they were; only a person this run invented who ended up in no workspace at all is removed.",
  ].join(" "));
  say();
  if (args.mode !== "apply") {
    say(`**Nothing was written.** The whole plan ran against ${args.bluetickEnv.replace(/.*[\\/]/, "…/")}'s database inside one transaction and that transaction ended in ROLLBACK${committed ? "" : " — proven by the counts above, which came from Postgres itself"}.`);
  } else {
    say(`**Committed.** Workspace \`${counts.workspaceId}\` now stands, not live. Inspect it in bluetick's /emu, then the founder flips \`live\`.`);
  }

  process.stdout.write(`${out.join("\n")}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e.stack || e.message}\n`);
  process.exitCode = 1;
});
