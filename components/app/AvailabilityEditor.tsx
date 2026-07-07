"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import {
  addWindow,
  removeWindow,
  requestTimeOff,
} from "@/app/coach/availability/actions";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Window = { id: string; weekday: number; start_time: string; end_time: string };
type TimeOff = { id: string; starts_at: string; ends_at: string; reason: string | null; status: string };

export function AvailabilityEditor({
  windows,
  timeOff,
}: {
  windows: Window[];
  timeOff: TimeOff[];
}) {
  const [weekday, setWeekday] = useState(0);
  const [start, setStart] = useState("16:00");
  const [end, setEnd] = useState("22:00");
  const [offStart, setOffStart] = useState("");
  const [offEnd, setOffEnd] = useState("");
  const [offReason, setOffReason] = useState("");
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-8">
      <div>
        <p className="label mb-2">Weekly windows</p>
        <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
          {windows.map((w) => (
            <li key={w.id} className="flex items-center justify-between px-4 py-3">
              <p className="text-sm">
                <span className="font-medium">{DAYS[w.weekday]}</span>{" "}
                <span className="tnum text-fg-2">
                  {w.start_time.slice(0, 5)}–{w.end_time.slice(0, 5)}
                </span>
              </p>
              <button
                onClick={() => startTransition(() => removeWindow(w.id).then(() => {}))}
                className="text-sm text-fg-2 hover:text-err"
              >
                Remove
              </button>
            </li>
          ))}
          {windows.length === 0 && (
            <li className="px-4 py-3 text-sm text-fg-2">
              No availability set — you won&apos;t be assigned sessions.
            </li>
          )}
        </ul>
        <div className="mt-3 grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
          <Select label="Day" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
          <Input label="From" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input label="To" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await addWindow(weekday, start, end);
              })
            }
          >
            Add
          </Button>
        </div>
        <p className="mt-2 text-xs text-fg-2">
          Editing availability never cancels existing sessions — clashes go to the founder.
        </p>
      </div>

      <div>
        <p className="label mb-2">Time off</p>
        <div className="space-y-2 rounded-[12px] border border-line bg-surface-2 p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              label="From"
              type="datetime-local"
              value={offStart}
              onChange={(e) => setOffStart(e.target.value)}
            />
            <Input
              label="To"
              type="datetime-local"
              value={offEnd}
              onChange={(e) => setOffEnd(e.target.value)}
            />
          </div>
          <Input
            label="Reason (optional)"
            value={offReason}
            onChange={(e) => setOffReason(e.target.value)}
          />
          {overlapWarning && (
            <p className="text-sm text-ember">{overlapWarning}</p>
          )}
          <Button
            disabled={pending || !offStart || !offEnd}
            onClick={() =>
              startTransition(async () => {
                const r = await requestTimeOff(offStart, offEnd, offReason);
                if (!r.ok) {
                  setMessage(r.error ?? null);
                  return;
                }
                if (r.overlaps && r.overlaps > 0 && !overlapWarning) {
                  setOverlapWarning(
                    `${r.overlaps} booked session${r.overlaps === 1 ? "" : "s"} overlap — the founder will resolve these on approval. Submit again to confirm.`
                  );
                  return;
                }
                setOverlapWarning(null);
                setMessage("Requested — you'll hear once the founder decides.");
                setOffStart("");
                setOffEnd("");
                setOffReason("");
              })
            }
          >
            {pending ? <Spinner /> : "Request time off"}
          </Button>
          {message && <p className="text-sm text-fg-2">{message}</p>}
        </div>

        <ul className="mt-3 space-y-2">
          {timeOff.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between rounded-[12px] border border-line bg-surface-2 px-4 py-3"
            >
              <p className="tnum text-sm">
                {new Date(t.starts_at).toLocaleDateString("en-GB")} –{" "}
                {new Date(t.ends_at).toLocaleDateString("en-GB")}
                {t.reason ? ` · ${t.reason}` : ""}
              </p>
              <Badge
                tone={
                  t.status === "approved" ? "ok" : t.status === "rejected" ? "err" : "neutral"
                }
              >
                {t.status}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
