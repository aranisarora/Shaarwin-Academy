import { Badge } from "@/components/ui/Badge";
import { formatDateFull, formatSessionDate } from "@/lib/academy-time";
import type { AttendanceEntry, StudentInsightsData } from "@/lib/student-insights";

const STATUS_LABELS: Record<string, { label: string; tone: "neutral" | "ember" | "ok" | "err" }> = {
  attended: { label: "attended", tone: "ok" },
  no_show: { label: "no-show", tone: "err" },
  confirmed: { label: "booked", tone: "neutral" },
  waitlisted: { label: "waitlisted", tone: "ember" },
  cancelled_by_client: { label: "cancelled", tone: "neutral" },
  cancelled_by_academy: { label: "cancelled by academy", tone: "neutral" },
};

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-line bg-surface-2 px-4 py-3">
      <p className="tnum text-2xl font-medium">{value}</p>
      <p className="text-xs text-fg-2">{label}</p>
    </div>
  );
}

function AttendanceList({ entries }: { entries: AttendanceEntry[] }) {
  return (
    <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
      {entries.map((e) => {
        const s = STATUS_LABELS[e.status] ?? { label: e.status, tone: "neutral" as const };
        return (
          <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-medium">{e.title}</p>
              <p className="tnum text-xs text-fg-2">
                {formatSessionDate(e.startsAt)} · {e.classType === "private" ? "private" : "group"}
              </p>
            </div>
            <Badge tone={s.tone}>{s.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Stats tiles + upcoming/past attendance for one student. Server component —
 * pass it the result of `getStudentInsights`.
 */
export function StudentInsights({ data }: { data: StudentInsightsData }) {
  const { stats, history, upcoming } = data;
  return (
    <div className="space-y-6">
      <div>
        <p className="label mb-3">At a glance</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="attended" value={stats.attended} />
          <Stat label="no-shows" value={stats.noShows} />
          <Stat label="upcoming" value={stats.upcoming} />
          <Stat
            label="attendance"
            value={stats.attendanceRate === null ? "—" : `${stats.attendanceRate}%`}
          />
        </div>
        <p className="mt-2 text-xs text-fg-2">
          {stats.lastAttended
            ? `Last attended ${formatDateFull(stats.lastAttended)}`
            : "No attended sessions yet"}
          {stats.cancelled > 0 && ` · ${stats.cancelled} cancelled`}
        </p>
      </div>

      {upcoming.length > 0 && (
        <div>
          <p className="label mb-3">Upcoming</p>
          <AttendanceList entries={upcoming.slice(0, 5)} />
        </div>
      )}

      <div>
        <p className="label mb-3">Attendance history</p>
        {history.length === 0 ? (
          <p className="text-sm text-fg-2">No past sessions yet.</p>
        ) : (
          <AttendanceList entries={history.slice(0, 20)} />
        )}
      </div>
    </div>
  );
}
