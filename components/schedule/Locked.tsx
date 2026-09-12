import { WhatsAppCta } from "@/components/marketing/WhatsAppCta";

/**
 * What /schedule shows a request with no key behind it — which is everybody
 * except the founder on a phone that has opened his link.
 *
 * It says whose page this is and how the right person gets in, and then does
 * for a stranger what every other page on the site does: hands them to
 * WhatsApp. It does not say whether a key exists, and there is nothing here
 * to type into — the door is the link, not a form.
 */
export function Locked() {
  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-[12px] border border-line bg-surface-2 p-5">
        <p className="font-semibold">This page is the academy&apos;s.</p>
        <p className="mt-1 text-sm text-fg-2">
          It opens from the link the assistant sends the owner on WhatsApp. If
          that&apos;s you, ask for the schedule in your thread and tap the link it
          sends back — this phone is remembered from then on.
        </p>
        <p className="mt-3 text-sm text-fg-2">
          Looking for a class? Message us and we&apos;ll send you this week&apos;s
          times for your area.
        </p>
        <WhatsAppCta
          className="mt-4 w-full"
          message="Hi! I'd like to know this week's class times."
        >
          Message us on WhatsApp
        </WhatsAppCta>
      </div>
    </div>
  );
}
