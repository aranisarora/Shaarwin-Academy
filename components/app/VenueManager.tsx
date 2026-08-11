"use client";

// Every place we coach at — thirty of them now, read mostly on a phone between
// sessions. Two things had to become visible here.
//
// One: whether a venue is a school. That was nowhere on this screen. A campus
// quietly joined the Schools tab because somebody published a School class at
// it, and left again when that class was deleted. It is a switch in the editor
// now, and a section of its own on this list.
//
// Two: which venues are hidden. A green "shown on website" badge on all thirty
// rows is not information, it is wallpaper you learn to skip past. Only the
// unusual state earns a badge, and a hidden venue is dimmed so the eye finds it
// before you've read a word.
//
// The row also stopped being two competing tap targets. Everything you can do
// to a venue is in its sheet, which is what makes the card safe to tap with a
// thumb — and lets the wide screen carry two columns of them instead of one
// phone-width list stranded down the middle, the way the weekly list already
// uses its width.

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Fab } from "@/components/ui/Fab";
import { Input } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { KindIcon } from "./class-type";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { AddressForm, isAddressComplete } from "@/components/app/AddressForm";
import {
  EMPTY_ADDRESS,
  fromDetails,
  type StructuredAddress,
} from "@/lib/address";
import { saveVenue, deleteVenue } from "@/app/admin/actions";
import { BENGALURU } from "@/lib/coverage";
import { venueDisplayName, venueNeedsUnit } from "@/lib/venue-display";

type Venue = {
  id: string;
  name: string;
  unit: string | null;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  is_public: boolean;
  is_school: boolean;
  address_details?: Partial<StructuredAddress> | null;
};

type Editing = {
  id?: string;
  name: string;
  unit: string;
  isSchool: boolean;
  isPublic: boolean;
  addr: StructuredAddress;
};

/** One venue, as a card. Tapping anywhere on it opens the editor — there is no
 *  second control to miss on a phone. */
function VenueCard({ venue, onOpen }: { venue: Venue; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className={`flex h-full w-full flex-col gap-1 rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-left transition-colors hover:border-ember ${
        venue.is_public || venue.is_school ? "" : "opacity-60"
      }`}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="min-w-0 font-medium">{venueDisplayName(venue)}</span>
        {/* "This place is a school" is the same fact a school class carries on
            the Schedule, so it is said the same way: the teal glyph, not an
            ember badge. Ember here meant a venue could look live, and a badge
            here meant identity could look like a state — on the one screen
            where the only real badge, Hidden, IS a state. */}
        <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
          {venue.is_school && (
            <span className="flex items-center gap-1 text-xs text-fg-2">
              <KindIcon kind="school" className="text-school" />
              School
            </span>
          )}
          {/* A school is never offered to clients, so "not public" is its normal
              state and a badge saying so on all eleven of them would be noise —
              only an unusual state earns one. */}
          {!venue.is_public && !venue.is_school && <Badge>Hidden</Badge>}
        </span>
      </span>
      <span className="line-clamp-2 text-sm text-fg-2">
        {venue.address} · {venue.postcode}
      </span>
    </button>
  );
}

export function VenueManager({ venues }: { venues: Venue[] }) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A refusal has to land inside the sheet. The sheet is a portal over a
  // full-screen backdrop, so anything written to `message` — which renders down
  // in the page body — is a sentence nobody will ever read: the founder flips
  // "This venue is a school" off, taps Save, the spinner stops, and as far as he
  // can tell nothing happened. `message` keeps the outcomes that close the sheet
  // first; this one carries the ones that don't. The tag says which control it
  // belongs beside, because "remove the login first" only means something next
  // to the button that just refused.
  const [sheetError, setSheetError] = useState<{
    at: "save" | "visibility" | "delete";
    text: string;
  } | null>(null);

  const errorAt = (at: "save" | "visibility" | "delete") =>
    sheetError?.at === at ? <p className="text-sm text-err">{sheetError.text}</p> : null;

  const query = search.trim().toLowerCase();
  const matches = useMemo(
    () =>
      venues.filter(
        (v) =>
          query === "" ||
          venueDisplayName(v).toLowerCase().includes(query) ||
          v.address.toLowerCase().includes(query) ||
          v.postcode.toLowerCase().includes(query)
      ),
    [venues, query]
  );

  // Coaching venues first because that is the daily list; schools are the
  // smaller, rarer group and sit under it rather than competing with it.
  const sections = [
    { key: "coaching", title: "Places we coach", rows: matches.filter((v) => !v.is_school) },
    { key: "schools", title: "Schools", rows: matches.filter((v) => v.is_school) },
  ];

  function openNew() {
    setMessage(null);
    setSheetError(null);
    setEditing({ name: "", unit: "", isSchool: false, isPublic: true, addr: EMPTY_ADDRESS });
  }

  function openEdit(v: Venue) {
    setMessage(null);
    setSheetError(null);
    setEditing({
      id: v.id,
      name: v.name,
      unit: v.unit ?? "",
      isSchool: v.is_school,
      isPublic: v.is_public,
      addr: fromDetails(v.address_details, {
        address: v.address,
        postcode: v.postcode,
        lat: v.lat,
        lng: v.lng,
      }),
    });
  }

  // Mirrors the server-side guard in saveVenueCore, so the founder sees why the
  // save is blocked before pressing it rather than after.
  const needsUnit =
    editing !== null &&
    venueNeedsUnit(
      { name: editing.name, unit: editing.unit },
      venues.filter((v) => v.id !== editing.id)
    );

  function submit() {
    if (!editing || !editing.name.trim() || !isAddressComplete(editing.addr)) return;
    if (needsUnit) return;
    setSheetError(null);
    startTransition(async () => {
      const a = editing.addr;
      const r = await saveVenue({
        id: editing.id,
        name: editing.name,
        unit: editing.unit,
        address: a.formatted,
        postcode: a.postcode ?? "",
        lat: a.lat ?? BENGALURU.lat,
        lng: a.lng ?? BENGALURU.lng,
        details: a,
        isSchool: editing.isSchool,
        // A school is never offered to clients, so the two flags cannot
        // disagree — the switch is disabled while "is a school" is on, and this
        // is the same rule applied to what actually gets written.
        isPublic: editing.isSchool ? false : editing.isPublic,
      });
      if (r.ok) {
        setMessage("Saved.");
        setEditing(null);
      } else {
        setSheetError({ at: "save", text: r.error ?? "Save failed." });
      }
    });
  }

  return (
    <div className="space-y-4">
      {venues.length > 0 && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-sm text-fg-2">
              Everywhere we coach, and every school campus.
            </p>
            <div className="flex items-center gap-3">
              <span className="tnum shrink-0 text-sm text-fg-2">
                {matches.length} of {venues.length}
              </span>
              <Button className="hidden lg:inline-flex" onClick={openNew}>
                New venue
              </Button>
            </div>
          </div>
          <Input
            placeholder="Search by name, address or pincode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </>
      )}

      {message && <p className="text-sm text-fg-2">{message}</p>}

      {venues.length === 0 ? (
        <EmptyState
          image="/images/empty-ivory.jpg"
          copy="Add the places you coach at. A venue's name and map pin show up on class cards and in directions — and a campus you mark as a school gets its own row in the Schools tab."
          action={<Button onClick={openNew}>Add your first venue</Button>}
        />
      ) : matches.length === 0 ? (
        <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          Nothing here matches &ldquo;{search.trim()}&rdquo;.
        </p>
      ) : (
        sections.map(
          (s) =>
            s.rows.length > 0 && (
              <section key={s.key} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="label">{s.title}</p>
                  <span className="tnum text-xs text-fg-2">{s.rows.length}</span>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {s.rows.map((v) => (
                    <li key={v.id}>
                      <VenueCard venue={v} onOpen={() => openEdit(v)} />
                    </li>
                  ))}
                </ul>
              </section>
            )
        )
      )}

      {venues.length > 0 && <Fab label="New venue" onClick={openNew} />}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit venue" : "New venue"}
      >
        {editing && (
          <div className="space-y-4">
            <Input
              label="Name"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Adarsh Palm Retreat"
            />
            <Input
              label="Which part (optional)"
              value={editing.unit}
              onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
              placeholder="Villas · Apartments · Lakefront"
            />
            <p className="-mt-2 text-sm text-fg-2">
              {needsUnit ? (
                <span className="text-ember">
                  Another venue is already called &ldquo;{editing.name.trim()}
                  &rdquo;. Say which part this one is — coaches need to know
                  which entrance to use.
                </span>
              ) : (
                <>
                  Shows as{" "}
                  <span className="font-medium">
                    {venueDisplayName({ name: editing.name || "Venue", unit: editing.unit })}
                  </span>
                  . Use this when one complex has several places you coach at.
                </>
              )}
            </p>

            <label className="flex items-start justify-between gap-4 rounded-[12px] border border-line p-4">
              <span className="min-w-0">
                <span className="block font-medium">This venue is a school</span>
                <span className="mt-1 block text-sm text-fg-2">
                  A school gets its own row in the Schools tab, where you can
                  give the campus a login that sees its pupils. It is never
                  offered to clients as a place to book.
                </span>
              </span>
              <Switch
                checked={editing.isSchool}
                onChange={(isSchool) => setEditing({ ...editing, isSchool })}
              />
            </label>

            {/* Said the same way as the school flag, because it is the same kind
                of fact: something the founder decides about the place, not a
                state the app derives. It used to be a "Hide venue" button below
                the save, which read as an action on a live thing — and that
                framing is how `active` came to be treated as visibility and
                ended up hiding campuses from the coaches standing in them. */}
            <label className="flex items-start justify-between gap-4 rounded-[12px] border border-line p-4">
              <span className="min-w-0">
                <span className="block font-medium">Offered to clients</span>
                <span className="mt-1 block text-sm text-fg-2">
                  {editing.isSchool
                    ? "A school is never offered to clients, so this stays off."
                    : "Listed on the website and pickable when a place gets chosen — yours and the client's. Turn it off for somewhere you only use internally: classes already here keep it, it just stops being offered for new ones."}
                </span>
              </span>
              <Switch
                checked={!editing.isSchool && editing.isPublic}
                disabled={editing.isSchool}
                onChange={(isPublic) => setEditing({ ...editing, isPublic })}
              />
            </label>

            <AddressForm
              value={editing.addr}
              onChange={(addr) => setEditing({ ...editing, addr })}
              searchLabel="Address"
              searchPlaceholder="Start typing the venue address…"
              showAccessNotes
            />
            {errorAt("save")}
            <Button onClick={submit} disabled={pending || needsUnit} className="w-full">
              {pending ? <Spinner /> : "Save venue"}
            </Button>

            {editing.id && (
              <>
                {errorAt("delete")}
                <ConfirmAction
                  label="Delete venue"
                  confirmLabel="Delete"
                  prompt="Delete this venue for good? This only works if no classes use it."
                  pending={pending}
                  onConfirm={() => {
                    setSheetError(null);
                    startTransition(async () => {
                      const r = await deleteVenue(editing.id!);
                      if (r.ok) {
                        setMessage("Venue deleted.");
                        setEditing(null);
                      } else {
                        setSheetError({
                          at: "delete",
                          text: r.error ?? "Delete failed.",
                        });
                      }
                    });
                  }}
                />
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
