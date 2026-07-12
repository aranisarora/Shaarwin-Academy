// Role → tool list. Availability here is UX; RLS on the user-scoped client is
// the actual security boundary.

import { academyInfo, guestTools } from "./guest";
import { clientTools } from "./client";
import { coachTools } from "./coach";
import { founderTools } from "./founder";
import type { WaTool } from "./types";

export type { ToolContext, WaTool } from "./types";

export function toolsForRole(role: "guest" | "client" | "coach" | "founder"): WaTool[] {
  switch (role) {
    case "client":
      return [...clientTools, academyInfo];
    case "coach":
      return [...coachTools, academyInfo];
    case "founder":
      return [...founderTools, academyInfo];
    default:
      return guestTools;
  }
}
