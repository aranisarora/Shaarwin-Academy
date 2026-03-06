import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/whatsapp";

export async function POST(req: NextRequest) {
  const { phone, name, email, mode } = await req.json();

  if (!phone || !mode) {
    return NextResponse.json({ error: "Missing phone or mode" }, { status: 400 });
  }

  const admin = createAdminClient();

  if (mode === "login") {
    // Phone must already be registered
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("phone_number", phone)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "Phone not registered" }, { status: 404 });
    }
  } else if (mode === "register") {
    // Phone must not already exist
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("phone_number", phone)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Phone already registered" }, { status: 409 });
    }
  } else {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  // Delete previous unused codes for this phone
  await admin.from("otp_codes").delete().eq("phone", phone).eq("used", false);

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await admin.from("otp_codes").insert({ phone, code: otp, expires_at: expiresAt });

  // Send via WhatsApp
  await sendText(phone, `Your Shaarwin Academy code: ${otp}. Valid for 5 minutes.`);

  return NextResponse.json({ sent: true });
}
