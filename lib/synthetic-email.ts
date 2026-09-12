// Some accounts are opened without anyone ever typing an email. A WhatsApp
// client is provisioned against their phone number; a school login is minted
// from the campus name. Both get a made-up address so Supabase auth has the
// unique key it insists on, and neither address is ever sent to — the phone
// number and the password are the real identities.
//
// So an address under one of our own fake domains is plumbing, not information,
// and putting it on a row only teaches the founder to ignore that line. The two
// domains are listed here rather than checked ad hoc, because the school one is
// a sub-domain of the client one and the obvious `endsWith("@sharwin.local")`
// silently misses it.
//
// One place must show it anyway, and it is worth saying so here because it
// looks like an oversight otherwise: a school's sign-in sheet, and the message
// the founder sends that school, both print the minted address in full. It is
// half of a credential a human has to type. What this flag decides there is not
// whether to show the address but what to say about it — an address of ours
// needs "nothing is ever sent to it", and a school's own inbox must not be
// described that way.

const SYNTHETIC_DOMAINS = ["@sharwin.local", "@schools.sharwin.local"];

/** True when this address was minted by us and is not an inbox. */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return e === "" || SYNTHETIC_DOMAINS.some((d) => e.endsWith(d));
}
