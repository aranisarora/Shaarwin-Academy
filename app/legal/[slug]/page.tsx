import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StageShell } from "@/components/shells/StageShell";

const pages: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: "Terms of Service",
    body: [
      "Memberships are billed monthly in advance and renew automatically until cancelled. Cancelling stops the next renewal; access continues to the end of the paid month. Single classes and private sessions can also be bought one at a time without a membership.",
      "Every child's first group class is free — one trial per player. The discounted intro private session is a promotional offer, limited to one per child.",
      "Group sessions may be cancelled or rescheduled by you up to 24 hours before the start without using your allowance. Inside 24 hours, the session counts as used.",
      "Private coaching minutes are granted each month with a Private plan; unused minutes roll over for one further month before expiring. Minutes bought as one-off sessions follow the same rules. Minutes are debited when a session is booked and refunded for cancellations made more than 24 hours ahead.",
      "We may cancel sessions for venue closures or coach illness. When we cancel, your session or minutes are always returned in full.",
      "Sharwin Table Tennis Academy, No. 594, 4th Cross, 7th Ward, Gundappa Beedi, Dommasandra, Bengaluru, Karnataka 562125. Reg. No. 38/DOM/CE/0013/2026. Questions: sharwinttacademy@gmail.com or WhatsApp +91 84314 35758.",
    ],
  },
  privacy: {
    title: "Privacy Policy",
    body: [
      "We collect the details you give us — name, email, phone, and for private coaching your address — to run your membership and sessions. Nothing more.",
      "Payment details are held by Razorpay, our payment processor. We never see or store your card number.",
      "Coaches see only what they need to teach: player names, skill levels, age bands and emergency contacts. They never see payment or subscription data.",
      "We don't sell data, and we don't run third-party advertising trackers.",
      "You can ask for a copy of your data, or for deletion, at any time: sharwinttacademy@gmail.com.",
    ],
  },
  safeguarding: {
    title: "Safeguarding",
    body: [
      "Every coach who works with players under 18 holds a verified background check — this is enforced by our booking system, not just by policy.",
      "Junior sessions always have a parent or guardian contact on file, and emergency contacts are visible to the coach running the session.",
      "Concerns are taken seriously and handled by the academy founder as designated safeguarding lead: sharwinttacademy@gmail.com.",
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(pages).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = pages[slug];
  return { title: page?.title ?? "Legal" };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = pages[slug];
  if (!page) notFound();

  return (
    <StageShell>
      <div className="mx-auto max-w-2xl px-6 pb-24 pt-28">
        <p className="label mb-3">Legal</p>
        <h1 className="font-display mb-10 text-4xl md:text-5xl">{page.title}</h1>
        <div className="space-y-5 text-smoke">
          {page.body.map((para) => (
            <p key={para.slice(0, 24)}>{para}</p>
          ))}
        </div>
      </div>
    </StageShell>
  );
}
