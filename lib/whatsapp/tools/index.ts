// Role → tool list. Availability here is UX; RLS on the user-scoped client is
// the actual security boundary.

import { adminClient } from "@/lib/whatsapp/identity";
import { academyInfo, guestTools, linkAccount } from "./guest";
import { clientTools } from "./client";
import { coachTools } from "./coach";
import { founderTools } from "./founder";
import { fail, ok, type WaTool } from "./types";

export type { ToolContext, WaTool } from "./types";

const unlinkAccount: WaTool = {
  name: "unlink_whatsapp",
  description:
    "Disconnect this WhatsApp number from the academy account. Confirm with the user first; they can re-link any time with a fresh code from the webapp.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    if (!ctx.profile) return fail("Nothing is linked.");
    await adminClient().from("wa_links").delete().eq("phone", ctx.phone);
    return ok({ unlinked: true });
  },
};

export function toolsForRole(role: "guest" | "client" | "coach" | "founder"): WaTool[] {
  switch (role) {
    case "client":
      return [...clientTools, academyInfo, linkAccount, unlinkAccount];
    case "coach":
      return [...coachTools, academyInfo, linkAccount, unlinkAccount];
    case "founder":
      return [...founderTools, academyInfo, linkAccount, unlinkAccount];
    default:
      return guestTools;
  }
}
