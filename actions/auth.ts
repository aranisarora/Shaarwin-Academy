"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { notifyWelcome } from "@/lib/whatsapp";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile;
}

export async function updateProfile(data: {
  full_name?: string;
  phone_number?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("profiles")
    .update(data)
    .eq("id", user.id);

  if (error) throw new Error(error.message);
}

/**
 * Send a WhatsApp welcome message to the current user.
 * Call this once after the user's phone number is first saved.
 */
export async function sendWelcomeNotification() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, phone_number")
      .eq("id", user.id)
      .single();

    if (profile?.phone_number) {
      await notifyWelcome(profile.phone_number, profile.full_name || "Student");
    }
  } catch (e) {
    console.warn("sendWelcomeNotification failed (non-blocking):", e);
  }
}
