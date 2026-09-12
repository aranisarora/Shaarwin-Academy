import { Reveal } from "@/components/Reveal";
import { ButtonLink } from "@/components/ui/Button";

const tiles = [
  {
    label: "WhatsApp",
    value: "+91 84314 35758",
    href: "https://wa.me/918431435758",
  },
  {
    label: "Email",
    value: "stalin@sharwinacademy.com",
    href: "mailto:stalin@sharwinacademy.com",
  },
  {
    label: "Location",
    value:
      "No. 594, 4th Cross, 7th Ward, Gundappa Beedi, Dommasandra, Bengaluru, Karnataka 562125",
    href: "https://maps.google.com/?q=12.877306,77.753917",
  },
];

/** Dedicated contact block above the footer. */
export function ContactSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:py-36">
      <Reveal>
        <p className="label mb-3">Get in touch</p>
        <h2 className="font-display mb-4 max-w-[20ch] text-3xl md:text-5xl">
          Contact us
        </h2>
        <p className="mb-10 max-w-[48ch] text-lg text-smoke">
          Ready to start? Reach out and we&apos;ll come to you.
        </p>
      </Reveal>

      <div className="grid gap-4 md:grid-cols-3">
        {tiles.map((tile, i) => (
          <Reveal key={tile.label} delay={i * 90}>
            <a
              href={tile.href}
              target="_blank"
              rel="noreferrer"
              className="group flex h-full flex-col rounded-[12px] border border-line bg-ink-2 p-6 transition-colors hover:border-ember"
            >
              <p className="label mb-2">{tile.label}</p>
              <p className="font-medium text-ivory transition-colors group-hover:text-ember">
                {tile.value}
              </p>
            </a>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/signup" size="lg">
            Book a class
          </ButtonLink>
          <ButtonLink href="/login" variant="ghost" size="lg">
            Sign in
          </ButtonLink>
        </div>
      </Reveal>
    </section>
  );
}
