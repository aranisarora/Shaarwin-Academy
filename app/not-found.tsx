import Image from "next/image";
import { StageShell } from "@/components/shells/StageShell";
import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <StageShell>
      <div className="relative flex min-h-[80dvh] items-center justify-center overflow-hidden">
        <Image
          src="/images/404-edge.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover opacity-70"
          aria-hidden
        />
        <div className="scrim-ink-bottom absolute inset-0" aria-hidden />
        <div className="relative px-6 text-center">
          <p className="font-display tnum text-7xl">404</p>
          <p className="mt-3 text-lg text-smoke">Out. Let&apos;s replay the point.</p>
          <ButtonLink href="/" className="mt-8">
            Back to the table
          </ButtonLink>
        </div>
      </div>
    </StageShell>
  );
}
