import { Input } from "@/components/ui/Input";

/**
 * The one phone input. Every phone the app collects is matched against WhatsApp
 * inbound numbers (`lib/whatsapp/identity.ts`), so the "with country code" label
 * and the `+91 …` placeholder are load-bearing copy, not decoration: they are
 * what stops a bare `9812345678` reaching the server. Existed in three drifting
 * copies (onboarding, pending, profile) — the profile one had lost the hint, the
 * placeholder and the autocomplete. Server-side normalization still runs on
 * every write path regardless of what this renders.
 */
export function PhoneField({
  label = "Phone (with country code)",
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      label={label}
      type="tel"
      autoComplete="tel"
      placeholder="+91 98123 45678"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...props}
    />
  );
}
