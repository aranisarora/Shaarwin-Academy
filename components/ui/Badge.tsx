type Tone = "neutral" | "ember" | "ok" | "err";

const tones: Record<Tone, string> = {
  neutral: "border-line text-fg-2",
  ember: "border-ember text-ember",
  ok: "border-ok text-ok",
  err: "border-err text-err",
};

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
