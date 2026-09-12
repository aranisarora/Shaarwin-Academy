# Blind-user UX audit (agentic, occasional)

This is the **token-spending** layer of the testing harness, and the only one an
agent runs by hand. It is deliberately manual and occasional — before a release,
or after a big UX change — never part of `npm test`.

The idea: give an agent a running local app, one role login, and a goal — and
**no other product context**. Because the harness seeds a realistic world and
mints a login instantly, the agent starts "inside" the product as a real user
would, and reports where it got confused, what labels were unclear, and where it
hit a dead end. An audit costs minutes, not hours.

## Setup (once per audit)

```bash
npm run db:start          # local Supabase up
npm run db:reset          # fresh seeded world
npx next dev -p 3100      # app on local Supabase (or reuse the flows server)
# mint a login for the role you want the agent to be:
node -e "import('./e2e/lib/auth.js')"   # or let the agent call getStorageState()
```

Give the agent the storage state from `e2e/.auth/local-<role>.json` (load it into
a browser context via the browser skill / Playwright MCP), the base URL
`http://localhost:3100`, and the prompt below. Seeded personas:
`client-a@sharwin.example` (parent), `samir@sharwin.example` (coach),
`founder@sharwin.example` (founder) — password `SeedPass!2026`.

## The reusable prompt

> You are a real user of a table-tennis coaching app, opening it on your phone
> for the first time. I will not tell you how the app works or where anything is
> — figure it out the way a first-timer would.
>
> **You are:** a parent whose child has a trial class booked for tomorrow.
> **Your goal:** find out *where* and *when* the class is, and whether you need
> to bring anything or do anything before then.
>
> You're already logged in at `http://localhost:3100`. Drive the browser
> yourself. As you go, narrate:
> - every point where you were unsure what to tap or what a label meant,
> - anything you expected to find but couldn't,
> - any dead end, confusing message, or moment you'd have given up,
> - anything that felt genuinely clear and good (so we don't break it).
>
> Do **not** read the source code or ask me questions — the whole point is to
> experience the app cold. At the end, give me: (1) did you achieve the goal?
> (2) the top 3 friction points, ranked, each with the screen and the fix you'd
> suggest, (3) one thing that worked well.

## Other goals worth rotating in

Swap the persona + goal, keep the rest of the prompt:

- **Parent, first booking:** "Book a group class for your child this week." (role: `client`)
- **Parent, cancel & rebook:** "You can't make Thursday — move it." (role: `client`)
- **Coach, match day:** "It's 20 minutes before your session. Tell everyone you're on your way, then mark yourself arrived when you get there." (role: `coach`)
- **Coach, can't make it:** "Something came up — you can't take tomorrow's 5pm. Deal with it in the app." (role: `coach`)
- **Founder, morning triage:** "It's Monday morning. What needs your attention, and can you clear it?" (role: `founder`)

## Coach cold-open protocol (phone, session-based)

A coach doesn't sit in the app. They open it on their phone for a few seconds at
a specific moment — to check where a class is, or once they're standing in it —
and close it again. So audit the coach the same way: separate **cold opens**,
each a fresh start with no memory of the last, on a phone-sized screen. The
`e2e/flows/coach-day.spec.ts` flow already proves the *facts* are present and
wired on each of these screens, for free, on every run; this protocol is the
qualitative pass — is it actually clear to someone who's never seen it?

Setup per moment: mint a coach login (`getStorageState("coach")`, or a fresh
harness-seeded coach), load it into a **phone-sized** browser context
(390×844, mobile), and give the agent one moment's goal and nothing else. Reset
between moments so each is a genuine cold open — the coach isn't carrying state
from an hour ago.

Run each moment as its own short audit, swapping only the "you are / your goal"
lines into the reusable prompt above:

1. **Before you leave — "which class, and where?"**
   *You are:* a coach with classes today, glancing at your phone before heading
   out. *Your goal:* work out which class is next, what time, and where it is —
   would you know where to drive without asking anyone?

2. **On your way — "does the app tell me what to do?"**
   *You are:* a coach about an hour before a session. *Your goal:* open the app
   and do whatever it's asking of you, without hunting for it. (It should meet
   you with a "coming?" prompt — did it, and was it obvious?)

3. **In the class — "run it from here."**
   *You are:* a coach who's just reached the venue, class about to start. *Your
   goal:* tell the parents you've arrived, then take the register as kids turn
   up — and if something's gone wrong (wrong venue, a child's hurt), find your
   way to raise it.

Keep each to its one goal and stop when it's met — that's what holds the audit to
minutes and a small token bill. Report per moment: did you achieve it, the single
biggest friction point (name the screen + a fix), and one thing that was clearly
good.

## Why it's cheap and honest

- The seeded scenario + instant login remove all setup cost — the agent spends its tokens *using* the product, not logging in.
- Because Layer 2 specs prefer accessible roles/labels (`getByRole`, `getByLabel`), an audit that struggles to find a control is a real accessibility signal, not a harness artifact.
- It burns tokens only when the founder chooses to run it. Everything else in the harness (`test:db`, `e2e:flows`) is plain code and costs nothing per run.
