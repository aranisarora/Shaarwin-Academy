// Role → tool list. Availability here is UX; RLS on the user-scoped client is
// the actual security boundary.
//
// Signed-in roles also get `find`, the generic reader. Its description is built
// per role from the entity registry, so a coach's copy advertises only the
// entities a coach may query. Guests are deliberately excluded: they have no
// RLS-scoped client at all and run on ctx.admin through get_academy_info, so a
// generic reader there would be a service-role query surface for unauthenticated
// numbers.

import { academyInfo, guestTools } from "./guest";
import { clientTools } from "./client";
import { coachTools } from "./coach";
import { founderTools } from "./founder";
import { findTool } from "./find";
import type { WaTool } from "./types";

export type { ToolContext, WaTool } from "./types";

export function toolsForRole(role: "guest" | "client" | "coach" | "founder"): WaTool[] {
  switch (role) {
    case "client":
      return [...clientTools, findTool("client"), academyInfo];
    case "coach":
      return [...coachTools, findTool("coach"), academyInfo];
    case "founder":
      return [...founderTools, findTool("founder"), academyInfo];
    default:
      return guestTools;
  }
}
