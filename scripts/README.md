# scripts

Two scripts live here. Both read Sharwin's Supabase project and neither ever
writes to it.

- `export-content.mjs` — freezes the academy's public reference data into
  `content/academy.json` so the site needs no database at build time.
- `export-to-bluetick.mjs` — moves the academy itself into a Bluetick
  workspace: its people, its diary, its standing arrangements and the house
  rules. This file is about that one.

---

## export-to-bluetick.mjs

```
node scripts/export-to-bluetick.mjs --dry-run
node scripts/export-to-bluetick.mjs --apply
node scripts/export-to-bluetick.mjs --undo sharwin-20260911T160512Z
```

| flag | meaning |
| --- | --- |
| `--dry-run` | Run the whole plan against Bluetick's real database inside one transaction, read the counts back out of Postgres, then `ROLLBACK`. Prints the report below. Writes nothing. |
| `--apply` | The same run, committed. Refuses before writing a single row if anything is in the way (see **Refusals**). |
| `--undo <run-id>` | End the workspace that run founded: archive it, and step every membership down to `removed`. Nothing is erased. Then delete the person rows the run created that no workspace holds. |
| `--owner +91…` | Repeatable. Who becomes an owner. Default: every profile with role `founder` that carries a phone, oldest first; the first founds the workspace and the rest are made owners after. |
| `--since 30d` | How much history comes across. Default 30 days. |
| `--horizon 52w` | How far the weekly runs are carried forward. Default 52 weeks. |
| `--bluetick-env PATH` | Where `DATABASE_URL` lives. Default `C:/Users/Aranis/Desktop/bluetick/.env.local`. |

Spans are written `30d`, `52w`, `12h`, `1y`.

### Where the credentials come from

Sharwin: `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, parsed out
of this worktree's `.env.local` by hand — no `dotenv`, and every statement
against it is a `select`.

Bluetick: `DATABASE_URL` out of `--bluetick-env`. That URL is the `runtime`
Postgres role, which holds `BYPASSRLS`; the script proves it on every run by
counting workspaces, and stops outright if that count comes back zero while the
database plainly holds rows, because a confined role would import a tenant that
nobody could then see.

### What it writes

Everything lands in **one workspace**, on the live sender number
`+1 240 262 3933`, founded by `app.create_workspace` — the only thing in
Bluetick that creates a workspace. That function mints the workspace key
itself; the script does not re-mint it. Afterwards the script sets
`timezone = 'Asia/Kolkata'` and `attrs = {public_diary: true, imported: <run>}`.

`live` stays **false**. Flipping it is the founder's own switch and this script
does not touch it.

| Bluetick | from Sharwin |
| --- | --- |
| `person` | one row per human with a phone, normalised to E.164; a bare ten-digit number is Indian. An existing person row carrying that phone is reused, never duplicated. Somebody with no phone gets a fresh row with `phone` empty. |
| `member` | coaches and clients with a phone at `active`; clients with none, school logins, children and school pupils at `known`. Somebody whose Sharwin sign-up was never approved stays at `known` whatever phone they carry. `created_at` is when they arrived at the academy, not when the script ran. Somebody who set `wa_muted` in Sharwin arrives with `opted_out_at` set, so the workspace sends them nothing. A child's `reach_id` names the parent's membership — one hop, and only when the parent has a number of their own, which is what the database insists on. |
| `event` | every `class_session` from `--since` ago onward, plus the weekly runs carried on to `--horizon`, plus the standing private appointments carried on the same way. `attrs` carries `kind`, `venue`, `venue_unit`, `address`, `school`, `sharwin.{class_id, session_id, series_id}` and `imported`, which is exactly what the diary route and the page read. |
| `booking` | every Sharwin booking on an imported session, at its own `booked_at`, and a `booked` row on each generated event for every active `booking_series` and `private_booking_series`. `confirmed → booked`, `no_show → missed`, `rescheduled` and both cancellations → `cancelled`. Where two collapse onto one place, the strongest outcome wins: attended, then missed, then booked, then waitlisted, then cancelled. Nothing in the database refuses a place past a class's capacity — `app.book()` is what enforces one and a straight insert never calls it — so a generated class that fills past its limit is written and counted in **Warnings** rather than silently trimmed. |
| `memory` | two standing rows — the house rules, and the current plans with their prices — and then one row per plan, per product, per public venue, per client on an active subscription, and per child. |
| `role`, `permit`, `role_holder` | one role, **Coach**, with three permits: change a booking's status (30 rows a change), write a memory (10), take a booking (10). Every active coach holds it. |

Two things it deliberately does **not** carry: money (orders, invoices, the
ledger) and messages (`wa_messages`, notifications, push subscriptions,
invites, skill assessments). A workspace that inherits a conversation it was
not part of would answer as though it remembered it.

### What it cannot do, and says so

A memory written outside a turn lands at `actor = 'noticed'`, whatever the
script passes: `app.memory_is_derived()` derives that column from the turn
context and an import has none. So nothing imported claims an owner said it.
That is the honest record, and it is left alone rather than worked around.

### Refusals

`--apply` exits `2` having written nothing when:

- a non-archived workspace called **Sharwin Table Tennis Academy** already
  stands on the live number; or
- any **hard conflict** stands — somebody this import would make `active`
  already holds an active membership on that same sender number. Bluetick
  allows one active membership per person per number
  (`member_one_workspace_idx`), and the script will not weaken a row to get
  past it. Either end the other membership first (archive that workspace, or
  remove them from it) and run again, or pass `--demote-conflicts`: the person
  is then written down at `known` here — the standing of somebody the room has
  been told about who has not yet walked in — with no ownership, and sending
  this workspace's key moves them in the way it moves anybody.

`--dry-run` reports both instead of refusing, and plans around a conflicted
person by leaving their member row and their bookings out, so the counts for
everybody else are still real.

### The switch

1. `--dry-run`. Read the report: the owners named, the conflicts, the counts,
   the five sample events and the three sample memories. Nothing is written.
2. Decide what to do about any hard conflict. As of 2026-09-11 there is exactly
   one: the account owner (a Sharwin founder profile, and a player's contact)
   holds an active membership in their own unrelated workspace on this same
   sender number. `--owner` cannot move them out of the way, because they are
   written down whoever owns the room. Two ways through: archive that other
   workspace (or remove their member row from it) and `--dry-run` again until
   the conflict table is empty; or run with `--demote-conflicts`, which writes
   them down at `known` here and leaves the other founder as the only owner —
   the way the first import was done. Nothing here weakens
   `member_one_workspace_idx` to get past it.
3. `--apply`. One transaction; any error rolls the whole thing back. The run id
   is printed to stderr before anything is read, so a run that dies half way
   can still be named to `--undo`.
4. Open the workspace in Bluetick's `/emu` and look at it — the diary, the
   people, the standing memories, the Coach role.
5. The founder flips `live` to true when it looks right. Until then the
   workspace is real but serves nobody.

### Undo

Every row the script writes carries `attrs.imported = <run id>`, and the run id
is a UTC-second stamp printed at the top of the report
(`sharwin-20260911T160512Z`).

```
node scripts/export-to-bluetick.mjs --undo sharwin-20260911T160512Z
```

**It ends the run; it does not erase it.** Two moves, in the order
`app.delete_workspace()` makes them and for its reasons:

1. `update workspace set archived_at = app.now(id)` — the room is over. Nothing
   is routed to it, and the diary route answers `404`, because it only serves a
   workspace with `archived_at is null`.
2. `update member set status = 'removed'` on every membership. This is not
   tidiness. `member_one_workspace_idx` is partial on `status = 'active'`, so an
   archived workspace still full of active members would go on blocking every
   one of those people from ever being imported again. Archiving first is what
   lets it through: `app.assert_owner_remains()` reads `archived_at` to decide
   whether a room still needs an owner.

Then, and only then, it deletes the person rows the run created that hold no
member row anywhere — somebody it invented who ended up in no workspace at all.
A person row that existed before the run is left exactly where it was.

Everything else stays: the events, the bookings, the memories, the deeds, and
anything real people wrote after the import. That is deliberate. Bluetick
archives a workspace rather than deleting it precisely so that everything that
happened in it stays on the record, and a hard delete could not be made to work
here anyway — `app.record_deed()` writes a deed per column on every `DELETE` and
suppresses itself only for an `INSERT` on `deed` itself, so deleting the
import's rows would write hundreds of thousands of deeds, deleting those would
write millions, and `delete from workspace` would then cascade onto rows the
same statement is removing.

After an undo the number is free, the people are free, and `--apply` may be run
again from scratch.

**Not yet run end to end.** `--undo` has only ever been run against a run id
that matched no workspace, which returns before it does anything. It is four
bounded statements now rather than a cascade that could not finish, but until it
has actually ended a real imported workspace it is reasoning, not evidence. Run
it once on a throwaway workspace founded on a number that is not live before
trusting it with this one.

### Idempotency

The script is not idempotent and does not pretend to be: a second `--apply`
would found a second workspace. It is refused instead, by name and by
conflict. `--undo <run-id>` is how a run is taken back: it archives that run's
workspace and ends its memberships, which clears both refusals and leaves the
record whole. It does not remove the rows the run wrote, and nothing removes
them.

## export-to-bluetick.mjs (2026-09-12)

Fills an EXISTING bluetick workspace with the academy's people and standing timetable.
Contacts and rules only: no history, no school pupils, no plans, no money.

```
node scripts/export-to-bluetick.mjs --dry-run --workspace <uuid> [--manager +91…] [--report FILE]
node scripts/export-to-bluetick.mjs --apply   --workspace <uuid> [--manager +91…] [--report FILE]
```

- `--workspace` is required. The run refuses unless the workspace exists, is not archived,
  has exactly one active owner and holds no series, event, booking, role, permit or
  role_holder. Members who arrived by key beforehand are kept and relabelled by number.
- `--dry-run` runs the whole plan inside a transaction that ends in ROLLBACK after
  `set constraints all immediate`; its counts are real.
- Sharwin is read with the service key from `.env.local`; bluetick is written as `runtime`
  over `DATABASE_URL` from `--bluetick-env` (default the bluetick checkout's `.env.local`).
- The report (markdown, also written to `--report`) carries a Data quality section naming
  everything skipped and why, the people and the timetable written, and the three tasks.
- There is no undo. Emptying a workspace is a deliberate act done by hand.
