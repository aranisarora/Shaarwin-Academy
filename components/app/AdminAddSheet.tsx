"use client";

// "Add to schedule" sheet: a new weekly class, an extra one-off session of an
// existing class, or a private session booked for a client.

import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { createGroupClass } from "@/app/admin/actions";
import { createOneOffSession, createPrivateSession } from "@/app/admin/calendar/actions";
import { AddressForm, isAddressComplete } from "@/components/app/AddressForm";
import { EMPTY_ADDRESS, type StructuredAddress } from "@/lib/address";
import { ClassDetailFields, EMPTY_CLASS_FORM, generateClassTitle, type ClassFormState } from "./ClassFields";
import { TimeSelect12h } from "./TimeSelect12h";
import {
  WEEKDAYS,
  type ClientOption,
  type Coach,
  type Venue,
} from "./admin-calendar-types";

type Mode = "weekly" | "oneoff" | "private";

const MODES: { value: Mode; label: string; blurb: string }[] = [
  {
    value: "weekly",
    label: "Weekly class",
    blurb: "A new group class that repeats every week — the next 8 weeks go on the schedule.",
  },
  {
    value: "oneoff",
    label: "Extra session",
    blurb: "One extra date for an existing class — handy for holidays or make-up sessions.",
  },
  {
    value: "private",
    label: "Private session",
    blurb: "A one-to-one session for a client at their address. Uses the client's private minutes.",
  },
];

export function AdminAddSheet({
  onClose,
  onDone,
  classes,
  coaches,
  venues,
  clients,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
  classes: { id: string; title: string }[];
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
}) {
  // Mounted fresh each time the sheet opens, so initializers read props.
  const [mode, setMode] = useState<Mode>("weekly");
  const [form, setForm] = useState<ClassFormState>(() => {
    const base = { ...EMPTY_CLASS_FORM, venueId: venues[0]?.id ?? "" };
    return { ...base, title: generateClassTitle(base.skillLevel, base.weekday, base.time) };
  });

  function updateForm(next: ClassFormState) {
    setForm({ ...next, title: generateClassTitle(next.skillLevel, next.weekday, next.time) });
  }
  const [oneOff, setOneOff] = useState({
    classId: classes[0]?.id ?? "",
    date: "",
    time: "18:30",
    coachId: "",
  });
  const [priv, setPriv] = useState({
    clientId: "",
    playerId: "",
    date: "",
    time: "17:00",
    duration: 60,
    coachId: "",
  });
  const [address, setAddress] = useState<StructuredAddress>(EMPTY_ADDRESS);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const client = clients.find((c) => c.id === priv.clientId) ?? null;

  function reset(next: Mode) {
    setMode(next);
    setMessage(null);
    if (next === "weekly") {
      const base = { ...EMPTY_CLASS_FORM, venueId: venues[0]?.id ?? "" };
      setForm({ ...base, title: generateClassTitle(base.skillLevel, base.weekday, base.time) });
    }
    if (next === "oneoff")
      setOneOff({ classId: classes[0]?.id ?? "", date: "", time: "18:30", coachId: "" });
    if (next === "private") {
      setPriv({ clientId: "", playerId: "", date: "", time: "17:00", duration: 60, coachId: "" });
      setAddress(EMPTY_ADDRESS);
    }
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      if (mode === "weekly") {
        const r = await createGroupClass(form);
        if (r.ok) onDone("Class is live — the next 8 weeks of sessions are on the schedule.");
        else setMessage(r.error ?? "Couldn't create the class.");
      } else if (mode === "oneoff") {
        const r = await createOneOffSession(
          oneOff.classId,
          oneOff.date,
          oneOff.time,
          oneOff.coachId
        );
        if (r.ok) onDone("Session added to the schedule.");
        else setMessage(r.error ?? "Couldn't add the session.");
      } else {
        const r = await createPrivateSession({
          clientId: priv.clientId,
          playerId: priv.playerId || undefined,
          date: priv.date,
          time: priv.time,
          durationMinutes: priv.duration,
          address: address.formatted,
          postcode: address.postcode ?? "",
          lat: address.lat!,
          lng: address.lng!,
          accessNotes: address.accessNotes ?? undefined,
          addressDetails: address as unknown as Record<string, unknown>,
          coachId: priv.coachId || undefined,
        });
        if (r.ok) onDone("Private session booked — the client has been told.");
        else setMessage(r.error ?? "Couldn't book the session.");
      }
    });
  }

  const canSubmit =
    mode === "weekly"
      ? !!form.venueId
      : mode === "oneoff"
        ? !!oneOff.classId && !!oneOff.date && !!oneOff.time
        : !!priv.clientId && !!priv.date && !!priv.time && isAddressComplete(address);

  return (
    <Sheet open onClose={onClose} title="Add to schedule">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => reset(m.value)}
              aria-pressed={mode === m.value}
              className={`min-h-11 rounded-[8px] border px-2 text-sm font-semibold ${
                mode === m.value
                  ? "border-ember bg-ember text-ivory"
                  : "border-line hover:border-ember"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-fg-2">{MODES.find((m) => m.value === mode)!.blurb}</p>

        {mode === "weekly" && (
          <>
            <ClassDetailFields form={form} onChange={updateForm} venues={venues} />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Day"
                value={form.weekday}
                onChange={(e) => updateForm({ ...form, weekday: e.target.value })}
              >
                {WEEKDAYS.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </Select>
              <TimeSelect12h
                label="Time"
                value={form.time}
                onChange={(time) => updateForm({ ...form, time })}
              />
            </div>
            <Select
              label="Coach"
              hint="Leave on automatic and the best-fitting coach is picked for you."
              value={form.coachId}
              onChange={(e) => setForm({ ...form, coachId: e.target.value })}
            >
              <option value="">Automatic — pick the best fit</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </>
        )}

        {mode === "oneoff" && (
          <>
            <Select
              label="Class"
              value={oneOff.classId}
              onChange={(e) => setOneOff({ ...oneOff, classId: e.target.value })}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Day"
                type="date"
                value={oneOff.date}
                onChange={(e) => setOneOff({ ...oneOff, date: e.target.value })}
              />
              <TimeSelect12h
                label="Time"
                value={oneOff.time}
                onChange={(time) => setOneOff({ ...oneOff, time })}
              />
            </div>
            <Select
              label="Coach"
              hint="Leave on automatic and the best-fitting coach is picked for you."
              value={oneOff.coachId}
              onChange={(e) => setOneOff({ ...oneOff, coachId: e.target.value })}
            >
              <option value="">Automatic — pick the best fit</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </>
        )}

        {mode === "private" && (
          <>
            <Select
              label="Client"
              value={priv.clientId}
              onChange={(e) => setPriv({ ...priv, clientId: e.target.value, playerId: "" })}
            >
              <option value="">— pick a client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            {client && client.players.length > 1 && (
              <Select
                label="Player"
                value={priv.playerId}
                onChange={(e) => setPriv({ ...priv, playerId: e.target.value })}
              >
                <option value="">{client.players[0].name} (default)</option>
                {client.players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Day"
                type="date"
                value={priv.date}
                onChange={(e) => setPriv({ ...priv, date: e.target.value })}
              />
              <TimeSelect12h
                label="Time"
                value={priv.time}
                onChange={(time) => setPriv({ ...priv, time })}
              />
            </div>
            <Select
              label="Length"
              value={priv.duration}
              onChange={(e) => setPriv({ ...priv, duration: Number(e.target.value) })}
            >
              {[60, 90].map((d) => (
                <option key={d} value={d}>{d} min</option>
              ))}
            </Select>
            <AddressForm
              value={address}
              onChange={setAddress}
              searchLabel="Where does the session happen?"
            />
            <Select
              label="Coach"
              hint="Leave on automatic and the best-fitting coach is picked for you."
              value={priv.coachId}
              onChange={(e) => setPriv({ ...priv, coachId: e.target.value })}
            >
              <option value="">Automatic — pick the best fit</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <p className="text-sm text-fg-2">
              This takes the session&apos;s minutes from the client&apos;s private balance —
              top it up from the Clients tab if needed.
            </p>
          </>
        )}

        <Button onClick={submit} disabled={pending || !canSubmit} className="w-full">
          {pending ? (
            <Spinner />
          ) : mode === "weekly" ? (
            "Publish class"
          ) : mode === "oneoff" ? (
            "Add session"
          ) : (
            "Book private session"
          )}
        </Button>
        {message && <p className="text-sm text-err">{message}</p>}
      </div>
    </Sheet>
  );
}
