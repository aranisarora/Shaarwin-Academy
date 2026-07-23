# Skills & Mastery rework — implementation plan

Status: planned, not implemented. This document is decision-complete: follow it as written.
Written against commit `bad4852` on `main`.

## Read first (non-negotiable)

- `AGENTS.md`: this Next.js version has breaking changes vs. training data. **Copy existing in-repo patterns** (server components + `requireUser`, `"use server"` action files, client components with `useTransition`) rather than writing Next.js from memory. If unsure about an API, read the guide in `node_modules/next/dist/docs/`.
- `supabase/schema.sql` is the canonical schema. The migration below was written against it — re-verify column names there before applying.
- DB changes go through the **Supabase MCP** (`apply_migration`, project ref `jkjgdpifimvnptpxjixk`), then **regenerate `supabase/schema.sql` via MCP** and commit it in the same commit as the migration file (pre-commit hook enforces this).

## Concept summary

- **Skill categories** (e.g. "Physical", "Mental") — created/managed by the **admin (founder) only**.
- **Skills** (e.g. "Forehand", "Backhand") — belong to a category. Coaches may **add and remove** skills; only the founder may edit categories.
- **Ratings** — coaches rate a player 1–5 per skill, in "assessments". Ratings are **never visible to clients**.
- **Mastery** — 0–100 score derived from the latest rating per active skill. Clients see only mastery + label.
- **Label** ladder (derived from mastery, computed in TS): 0–24 **Beginner**, 25–49 **Intermediate**, 50–74 **Advanced**, 75–100 **Elite**.
- **Mastery formula** (locked): `round(100 * sum(latest rating per active skill) / (5 * count(active skills)))`. Unrated active skills count as 0. No active skills → mastery 0. Latest rating per skill is taken **across all coaches** by assessment `created_at`.
- **Pending assessments** — after a session a coach taught, every player marked `attended` owes that coach one assessment for that session. A blocking popup in the coach app cycles through them until all are done. Lookback is **7 days** (prevents a backfill mountain at launch and lets stale ones expire).
- The old `players.skill_level` enum stays in the DB (admin tooling and class levels still use it) but is **removed from every client-facing surface** (onboarding, profile editor, client badges).

---

## Part 1 — Database migration

Create `supabase/migrations/0035_skills_mastery.sql` and apply via MCP `apply_migration`. Content:

```sql
-- Skills & mastery: admin-defined categories, coach-managed skills,
-- per-session coach assessments with 1-5 ratings, mastery derived 0-100.

create table public.skill_categories (
  id uuid default gen_random_uuid() not null primary key,
  name text not null,
  sort_order smallint default 0 not null,
  created_at timestamptz default now() not null
);

create table public.skills (
  id uuid default gen_random_uuid() not null primary key,
  category_id uuid not null references public.skill_categories(id) on delete cascade,
  name text not null,
  -- Coaches "remove" by deactivating so rating history survives; only the
  -- founder hard-deletes. Mastery counts active skills only.
  active boolean default true not null,
  sort_order smallint default 0 not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now() not null
);
create index skills_category_idx on public.skills (category_id);

-- One assessment event = one coach rating one player once (optionally tied to
-- the session that prompted it). Ratings hang off it so history is kept.
create table public.skill_assessments (
  id uuid default gen_random_uuid() not null primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.class_sessions(id) on delete set null,
  created_at timestamptz default now() not null
);
-- One assessment per coach per player per session ("pending" completion marker).
create unique index skill_assessments_once_per_session
  on public.skill_assessments (player_id, session_id, coach_id)
  where session_id is not null;
create index skill_assessments_player_created_idx
  on public.skill_assessments (player_id, created_at desc);
create index skill_assessments_coach_idx on public.skill_assessments (coach_id);
create index skill_assessments_session_idx on public.skill_assessments (session_id);

create table public.skill_ratings (
  id uuid default gen_random_uuid() not null primary key,
  assessment_id uuid not null references public.skill_assessments(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  unique (assessment_id, skill_id)
);
create index skill_ratings_skill_idx on public.skill_ratings (skill_id);

-- ---------- RLS ----------
alter table public.skill_categories enable row level security;
alter table public.skills enable row level security;
alter table public.skill_assessments enable row level security;
alter table public.skill_ratings enable row level security;

-- Categories: founder manages, coaches read. Clients get nothing (mastery via RPC).
create policy "staff reads categories" on public.skill_categories
  for select using ((select is_coach()) or (select is_founder()));
create policy "founder manages categories" on public.skill_categories
  for all using ((select is_founder())) with check ((select is_founder()));

-- Skills: coaches add + deactivate; founder full control; hard delete founder-only.
create policy "staff reads skills" on public.skills
  for select using ((select is_coach()) or (select is_founder()));
create policy "staff adds skills" on public.skills
  for insert with check ((select is_coach()) or (select is_founder()));
create policy "staff updates skills" on public.skills
  for update using ((select is_coach()) or (select is_founder()));
create policy "founder deletes skills" on public.skills
  for delete using ((select is_founder()));

-- Assessments/ratings: staff-only. No client policies at all — clients only
-- ever see the derived mastery number via get_players_mastery().
create policy "staff reads assessments" on public.skill_assessments
  for select using ((select is_coach()) or (select is_founder()));
create policy "author writes assessments" on public.skill_assessments
  for insert with check (
    coach_id = (select auth.uid())
    and ((select is_coach()) or (select is_founder()))
  );
create policy "founder deletes assessments" on public.skill_assessments
  for delete using ((select is_founder()));

create policy "staff reads ratings" on public.skill_ratings
  for select using ((select is_coach()) or (select is_founder()));
create policy "author writes ratings" on public.skill_ratings
  for insert with check (
    exists (
      select 1 from skill_assessments a
      where a.id = assessment_id and a.coach_id = (select auth.uid())
    )
  );
create policy "founder deletes ratings" on public.skill_ratings
  for delete using ((select is_founder()));

-- ---------- Views & functions ----------

-- Latest rating per (player, skill) across all coaches. security_invoker so
-- the staff-only RLS of the underlying tables applies to direct reads.
create view public.latest_skill_ratings
  with (security_invoker = true) as
  select distinct on (a.player_id, r.skill_id)
         a.player_id, r.skill_id, r.rating, a.coach_id, a.created_at
    from skill_ratings r
    join skill_assessments a on a.id = r.assessment_id
   order by a.player_id, r.skill_id, a.created_at desc;

-- Mastery 0-100 for a set of players. SECURITY DEFINER: silently filters to
-- players the caller may see (founder: all; coach: own roster; client: own
-- household) — never exposes per-skill ratings.
create or replace function public.get_players_mastery(p_players uuid[])
returns table(player_id uuid, mastery integer)
language sql stable security definer
set search_path to 'public'
as $$
  with authorized as (
    select pl.id from players pl
    where pl.id = any(p_players)
      and (
        is_founder()
        or (is_coach() and coach_has_player(pl.id))
        or pl.client_id = auth.uid()
      )
  ),
  n_skills as (select count(*)::int as n from skills where active),
  latest as (
    select distinct on (a.player_id, r.skill_id)
           a.player_id, r.skill_id, r.rating
      from skill_ratings r
      join skill_assessments a on a.id = r.assessment_id
      join skills s on s.id = r.skill_id and s.active
     order by a.player_id, r.skill_id, a.created_at desc
  )
  select au.id,
         case when (select n from n_skills) = 0 then 0
              else round(100.0 * coalesce(sum(l.rating), 0)
                         / (5 * (select n from n_skills)))::int
         end
    from authorized au
    left join latest l on l.player_id = au.id
   group by au.id;
$$;

-- Sessions this coach has taught (ended, last 7 days) with attended players
-- still lacking that coach's assessment. Founder may query any coach (preview).
create or replace function public.get_pending_assessments(p_coach uuid default auth.uid())
returns table(player_id uuid, player_name text, session_id uuid,
              class_title text, session_ended_at timestamptz)
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if p_coach <> auth.uid() and not is_founder() then
    raise exception 'not_authorised';
  end if;
  return query
    select b.player_id, pl.full_name, s.id, c.title, s.ends_at
      from bookings b
      join class_sessions s on s.id = b.session_id
      join classes c on c.id = s.class_id
      join players pl on pl.id = b.player_id
     where s.coach_id = p_coach
       and b.status = 'attended'
       and s.ends_at < now()
       and s.ends_at > now() - interval '7 days'
       and not exists (
         select 1 from skill_assessments a
          where a.player_id = b.player_id
            and a.session_id = s.id
            and a.coach_id = p_coach
       )
     order by s.ends_at asc, pl.full_name;
end;
$$;
```

Do **not** seed categories/skills — the admin creates them (empty states must read well). After applying, regenerate `supabase/schema.sql` via MCP and commit both together. Also run MCP `get_advisors` (security) after applying and fix anything it flags on the new objects.

## Part 2 — Shared TS helpers

New file `lib/mastery.ts`:

```ts
export type MasteryLabel = "Beginner" | "Intermediate" | "Advanced" | "Elite";

export function masteryLabel(mastery: number): MasteryLabel {
  if (mastery >= 75) return "Elite";
  if (mastery >= 50) return "Advanced";
  if (mastery >= 25) return "Intermediate";
  return "Beginner";
}
```

Add a small helper `getMasteryMap(supabase, playerIds: string[]): Promise<Map<string, number>>` (same file or `lib/data.ts`, matching local style) that calls `supabase.rpc("get_players_mastery", { p_players: ids })`, returns empty map for empty input, and maps missing players to 0.

## Part 3 — Admin app

### 3a. New "Skills" tab (`/admin/skills`)

- `components/app/AdminShell.tsx`: add `{ href: "/admin/skills", label: "Skills", icon: "★" }` to `tabs` (after Coaches). Do **not** add to `mobileTabs` (bottom bar fits 5); instead add a Skills entry to the `items` list in `app/admin/more/page.tsx` (hint: "Skill categories & rating metrics"). Update the comment atop `AdminShell.tsx` that enumerates which sections live under More.
- New `app/admin/skills/page.tsx` (server component, `requireUser("/admin/skills")`, `AdminShell` title "Skills"): fetch `skill_categories` (ordered by `sort_order, created_at`) and `skills` (all, including inactive, ordered same), render a client `SkillsManager`.
- New `app/admin/skills/actions.ts` (`"use server"`, follow the `addStudentNote` pattern — plain inserts relying on RLS, return `{ ok, error }`, `revalidatePath` the pages involved): `createCategory(name)`, `renameCategory(id, name)`, `deleteCategory(id)` (cascades its skills — confirm in UI), `createSkill(categoryId, name)`, `setSkillActive(id, active)`, `deleteSkill(id)`, `renameSkill(id, name)`. Revalidate `/admin/skills` and `/coach/skills`.
- New `components/app/SkillsManager.tsx` (client): one card per category (category name editable inline for admin), skills listed inside with add-skill input, deactivate/reactivate toggle, and delete. Prop `role: "founder" | "coach"` — coach mode hides category create/rename/delete and skill hard-delete (coaches only add + deactivate/reactivate). Reuse `Button`, `Input`, `Badge` from `components/ui`. Inactive skills render dimmed with a "hidden" badge.

### 3b. Admin player rows show mastery

- `app/admin/players/page.tsx`: after the players fetch, collect all player ids (household + school) and call `getMasteryMap`. Add `mastery: number` to `householdRows`/`schoolRows`.
- `components/app/PlayerManager.tsx`: add `mastery` to its row type; in each row render `{mastery}%` (tnum styling like the sibling stats) next to the existing level badge. Also show mastery + label in the selected-player detail panel (near lines 197/222 where the level badge renders).

### 3c. Admin player profile (`app/admin/players/[playerId]/page.tsx`)

- Fetch in the existing `Promise.all`: `get_players_mastery` for this player, `skill_categories` + active `skills`, and latest per-skill ratings via the `latest_skill_ratings` view filtered by `player_id` (founder passes RLS).
- Render a new section "Skills" above Coach notes: mastery headline (`{mastery} / 100 · {label}` — reuse `Badge`), then per category a list of skills with the latest rating shown as 5 dots/pips (filled count = rating, unrated = "—"). Build this as a server-renderable `components/app/SkillRatingsView.tsx` shared with the coach page (read-only; the coach page wraps it with the editor below).

## Part 4 — Coach app

### 4a. Rename "Clients" → "Players" (route + label)

- Rename directory `app/coach/clients` → `app/coach/players`.
- Grep for `/coach/clients` and update every reference (currently: `components/app/CoachShell.tsx` tab, `components/app/StudentNotes.tsx` action import, `components/app/AdminAddSheet.tsx`, `components/app/ClientManager.tsx`, `app/coach/clients/page.tsx` + `[playerId]/page.tsx` internal `requireUser`/links, `[playerId]/actions.ts` revalidate paths — re-grep after renaming, don't trust this list).
- Tab label "Clients" → "Players"; page `metadata.title` and `CoachShell title` "Clients" → "Players"; empty-state copy already says "players".
- Add a permanent redirect in `next.config.ts`: `/coach/clients/:path*` → `/coach/players/:path*` (check `node_modules/next/dist/docs` for the current redirects API shape before writing it).

### 4b. Coach skills management (`/coach/skills`)

- New `app/coach/skills/page.tsx`: `requireUser`, fetch categories + skills, render `SkillsManager` with `role="coach"`.
- Coach-safe actions: reuse `createSkill` / `setSkillActive` from `app/admin/skills/actions.ts` (RLS enforces the boundary; the category/delete actions will simply fail for coaches, and coach-mode UI never offers them).
- Link it from `app/coach/more/page.tsx` (a simple card/link "Skills — rating metrics for assessments" above `InstallAppCard`).

### 4c. Assessment UI on the coach player page (`app/coach/players/[playerId]/page.tsx`)

- Extend the page fetch: categories + active skills, this player's latest per-skill ratings (via `latest_skill_ratings`), mastery via RPC, and read `searchParams` for `?session=<id>` (the pending-popup deep link).
- Replace the `skill_level` badge with mastery: `{mastery}% · {label}`.
- New section "Skills" above Coach notes: `SkillRatingsView` (current state) plus a client component `components/app/AssessmentEditor.tsx`:
  - Groups active skills by category; each skill gets a 1–5 segmented button row, prefilled with the latest rating (any coach's) so a coach adjusts rather than starts blank; skills can be left untouched (partial assessments are fine — only changed/confirmed skills submit, but always submit at least the assessment row itself).
  - Save button calls a new server action `submitAssessment(playerId, sessionId | null, ratings: {skillId, rating}[])` in `app/coach/players/[playerId]/actions.ts`: insert into `skill_assessments` (`coach_id: user.id`, `session_id`), then bulk-insert `skill_ratings`. On unique-violation for (player, session, coach) return `{ ok: false, error: "Already assessed for that session." }`. Revalidate the coach player page, `/admin/players/[playerId]`, `/app`, and `/app/players/[playerId]`.
  - If `?session=` is present, show context ("Assessing for {class title}") and pass the session id through; otherwise save an ad-hoc assessment (`session_id` null).
- Note composer: keep `StudentNotes` as is, but change its caption (see Part 6).

### 4d. Pending-assessments popup

- `app/coach/layout.tsx`: render a new client component `<PendingAssessments />` (no props needed — it self-fetches, so it stays fresh across client-side navigations, which layouts don't re-render for).
- New `components/app/PendingAssessments.tsx` (client):
  - On mount and on every `usePathname()` change, call a server action `getPendingAssessments()` (new file `app/coach/assess-actions.ts`, `"use server"`): resolves `effectiveCoachId(user.id)` (import from `lib/coach-preview`, same as the pages do) and calls the `get_pending_assessments` RPC with it.
  - If the list is non-empty **and** the current pathname is not `/coach/players/<currentItem.player_id>`, render a fixed bottom-sheet/modal (match `InstallPrompt`'s styling approach for a fixed overlay card): headline "Pending assessments ({n})", body "Complete assessment for **{player_name}** — {class_title}", primary `ButtonLink` → `/coach/players/{player_id}?session={session_id}`, and a secondary "Next player" button that cycles `index = (index+1) % n`. **No close/dismiss control** — it disappears only when the list is empty. Hide it (render nothing) while the coach is on the deep-linked player's page so it never blocks the form it points to.
  - After `submitAssessment` succeeds, the next pathname change (or a `router.refresh()` the editor triggers on success) re-fetches and the item drops out.
- Known accepted quirk: in founder preview mode the popup shows the previewed coach's pending list, but a founder-submitted assessment records `coach_id = founder` and won't clear the coach's pending item. Fine — preview is read-mostly.

### 4e. Coach roster page (`app/coach/players/page.tsx`)

- Replace the `skill_level` badge with mastery: fetch `getMasteryMap` for the unique player ids and show `{mastery}% · {label}` (Badge for the label, tnum text for the %). Drop `skill_level` from the select string.

## Part 5 — Client app

Clients must never see ratings — only mastery + label. The RPC enforces this server-side; the UI work:

- `app/app/page.tsx` (home): fetch `getMasteryMap` for the household players (ids already fetched). On each player card add a mastery line, e.g. `Mastery {m}% · {label}` (use `masteryLabel`). Drop `skill_level` from the players select.
- `app/app/players/[playerId]/page.tsx`: replace the `skill_level` `Badge` with `{label}` badge + `{m}% mastery` text (single-player RPC call). Notes section stays (parents already read notes via `get_player_notes`).
- `app/app/players/page.tsx`: replace any `skill_level` display with mastery + label (check the file; same pattern).
- `components/app/ProfileEditor.tsx`: remove the skill-level display (line ~137) and the skill-level `Select` from the add-player form; stop sending `skillLevel` in its action payload (update the corresponding action in `app/app/profile/actions.ts` — the DB default `'beginner'` covers inserts).

## Part 6 — Onboarding: remove skill_level

- `components/app/onboarding/PlayersStep.tsx`: delete the `SKILL_LEVELS` const, the two `Select` blocks, and `skillLevel` from the `Row` type / `blankRow` / `toRow` / `ExistingPlayer`.
- `app/app/onboarding/actions.ts` → `savePlayers`: drop `skillLevel` from `PlayerInput` and from the upsert row (new inserts take the DB default; **updates must not touch `skill_level`** so coach/admin-set values survive re-onboarding edits).
- `app/app/onboarding/page.tsx`: stop selecting `skill_level` for `existing` players if it does.
- Do **not** drop the column or enum — `classes.skill_level`, booking surfaces, and admin tooling still use them.

## Part 7 — Notes visibility copy

Notes already flow to parents via `get_player_notes` (client player page renders them). Fix the stale caption in `components/app/StudentNotes.tsx` ("Visible to all coaches and the founder.") to:

> Visible to the player's family, all coaches, and the founder.

Also update the textarea placeholder to reflect the audience (e.g. "Progress, focus areas, wins — the family reads this too."). No RLS change needed.

## Part 8 — Realtime (optional, cheap)

`app/coach/layout.tsx` already mounts `RealtimeRefresh` for bookings/class_sessions; that's what makes newly-marked attendance produce pending items on next fetch. No change required. Do **not** add realtime on the new tables.

## Execution order & commits

Work in this order (each step leaves the app buildable):

1. **Migration** (Part 1) via MCP + regenerate `supabase/schema.sql` + commit together.
2. `lib/mastery.ts` + helpers (Part 2).
3. Coach route rename (Part 4a) — pure refactor, commit alone.
4. Admin skills tab + SkillsManager (Part 3a).
5. Coach skills page (Part 4b).
6. Assessment editor + actions + admin/coach player-profile skill sections (Parts 3c, 4c).
7. Pending popup (Part 4d).
8. Mastery surfacing: admin rows (3b), coach roster (4e), client app (Part 5).
9. Onboarding/profile skill_level removal + notes copy (Parts 6, 7).

## Verification checklist

- `npm run lint` and `npm run build` pass after each commit.
- MCP `get_advisors` (security + performance) clean for the new tables/functions/view.
- Manual RLS spot-checks via MCP `execute_sql` with `set role authenticated; set request.jwt.claims ...` or by reasoning through policies: a client must get zero rows from `skills`, `skill_ratings`, `skill_assessments`, `latest_skill_ratings`, but correct mastery from `get_players_mastery` for their own players and zero rows for others'.
- Pending flow end-to-end: mark a booking `attended` on an ended session (via MCP on a test row) → popup appears for that coach → deep link lands on the player page with session context → submit → popup clears.
- Onboarding shows no skill selector; re-running onboarding for an existing account does not reset coach-set `skill_level`.
- `/coach/clients/...` URLs redirect to `/coach/players/...`.
