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
      "cancel_bookings",
      "reschedule_booking",
      "book_private_session",
      "send_membership_checkout_link",
      "update_profile",
      "add_player",
    ]) {
      expect(n).toContain(tool);
    }
  });

  it("gives coaches schedule, roster, cover, attendance and drop tools", () => {
    const n = names("coach");
    for (const tool of [
      "my_coach_sessions",
      "session_roster",
      "confirm_session",
      "mark_arrival",
      "list_cover_offers",
      "claim_cover_session",
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

  it("gives every signed-in role the generic reader, and guests none of it", () => {
    for (const role of ["client", "coach", "founder"] as const) {
      expect(names(role)).toContain("find");
    }
    // Guests run on the service-role client, so a generic reader there would be
    // an unauthenticated query surface.
    expect(names("guest")).not.toContain("find");
  });

  it("scopes find's advertised entities to the role", () => {
    const forRole = (role: "client" | "coach" | "founder") =>
      toolsForRole(role).find((t) => t.name === "find")!.description;
    expect(forRole("founder")).toContain("subscriptions:");
    expect(forRole("client")).not.toContain("subscriptions:");
    expect(forRole("client")).not.toContain("clients:");
    expect(forRole("coach")).toContain("coaches:");
    expect(forRole("client")).not.toContain("coaches:");
  });

  it("only the founder can message an arbitrary set of people", () => {
    expect(names("founder")).toContain("notify");
    expect(names("client")).not.toContain("notify");
    expect(names("coach")).not.toContain("notify");
  });

  it("exposes the set-taking write tools under their plural names", () => {
    expect(names("founder")).toContain("cancel_sessions");
    expect(names("founder")).not.toContain("cancel_session");
    expect(names("client")).not.toContain("cancel_booking");
  });

  it("every set-taking tool asks for an array, not a single id", () => {
    const plural: Record<string, string> = {
      cancel_sessions: "session_ids",
      reassign_coach: "session_ids",
      adjust_private_credits: "client_ids",
      move_session: "session_ids",
      set_session_capacity: "session_ids",
      set_class_active: "class_ids",
      set_coach_active: "coach_ids",
      block_client: "client_ids",
      archive_client: "client_ids",
      set_venue_public: "venue_ids",
      notify: "user_ids",
    };
    const founder = toolsForRole("founder");
    for (const [tool, field] of Object.entries(plural)) {
      const def = founder.find((t) => t.name === tool);
      expect(def, `${tool} missing`).toBeDefined();
      const prop = def!.input_schema.properties[field] as { type?: string } | undefined;
      expect(prop?.type, `${tool}.${field}`).toBe("array");
      expect(def!.input_schema.required).toContain(field);
    }
  });

  it("guests (unresolved numbers) can only see public info", () => {
    const n = names("guest");
    expect(n).toEqual(["get_academy_info"]);
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
