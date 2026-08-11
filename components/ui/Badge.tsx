type Tone = "neutral" | "ember" | "ok" | "err";

const tones: Record<Tone, string> = {
  neutral: "border-line text-fg-2",
  ember: "border-ember text-ember",
  // The border keeps the bright green, the words take the darker one: at 11px
  // uppercase on paper, --ok is 3.3:1 and a dimmed card takes it lower still.
  // The arrival chip is the only thing a finished session card says, so it has
  // to read. See --ok-ink in globals.css.
  ok: "border-ok text-ok-ink",
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
