import { describe, expect, it } from "vitest";
import { toolsForRole } from "./index";

function names(role: "guest" | "client" | "coach" | "founder"): string[] {
  return toolsForRole(role).map((t) => t.name);
}

describe("toolsForRole", () => {
  it("gives clients the tools to actually manage their membership (not just fetch)", () => {
    const n = names("client");
    for (const tool of [
      "my_schedule",
      "book_group_session",
      "cancel_booking",
      "reschedule_booking",
      "book_private_session",
      "send_membership_checkout_link",
      "update_profile",
      "add_player",
      "unlink_whatsapp",
    ]) {
      expect(n).toContain(tool);
    }
  });

  it("gives coaches schedule, roster, availability, attendance and drop tools", () => {
    const n = names("coach");
    for (const tool of [
      "my_coach_sessions",
      "session_roster",
      "add_availability_window",
      "request_time_off",
      "mark_attendance",
      "cant_make_session",
    ]) {
      expect(n).toContain(tool);
    }
  });

  it("gives the founder full website parity (every admin domain has a tool)", () => {
    const n = names("founder");
    for (const tool of [
      "update_class",
      "end_class",
      "top_up_sessions",
      "move_session",
      "set_session_capacity",
      "create_one_off_session",
      "create_private_session",
      "promote_client_to_coach",
      "update_coach",
      "set_coach_active",
      "update_client",
      "block_client",
      "archive_client",
      "save_venue",
      "delete_venue",
      "get_settings",
      "update_settings",
      "list_subscriptions",
      "list_dunning",
    ]) {
      expect(n).toContain(tool);
    }
  });

  it("guests can only see public info + onboarding", () => {
    const n = names("guest");
    expect(n).toContain("get_academy_info");
    expect(n).not.toContain("book_group_session");
    expect(n).not.toContain("cancel_session");
  });

  it("every tool has a unique name and a description per role", () => {
    for (const role of ["client", "coach", "founder"] as const) {
      const tools = toolsForRole(role);
      const set = new Set(tools.map((t) => t.name));
      expect(set.size).toBe(tools.length);
      expect(tools.every((t) => t.description.length > 0)).toBe(true);
    }
  });
});
