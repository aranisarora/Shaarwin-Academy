import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function POST(req: NextRequest) {
  const { phone, otp, name, email, next } = await req.json();

  if (!phone || !otp) {
    return NextResponse.json({ error: "Missing phone or otp" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Find latest unused, unexpired OTP for this phone
  const { data: record } = await admin
    .from("otp_codes")
    .select("id, code, expires_at")
    .eq("phone", phone)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!record || record.code !== otp) {
    return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 401 });
  }

  // Mark OTP as used
  await admin.from("otp_codes").update({ used: true }).eq("id", record.id);

  // Check if this is a new registration or existing login
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, email")
    .eq("phone_number", phone)
    .maybeSingle();

  let userEmail: string;

  if (!existingProfile) {
    // Register: create auth user and profile
    if (!email || !name) {
      return NextResponse.json({ error: "Name and email required for registration" }, { status: 400 });
    }

    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email,
      phone,
      user_metadata: { full_name: name },
      email_confirm: true,
    });

    if (createError || !newUser.user) {
      console.error("verify-otp: createUser failed", createError);
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    await admin.from("profiles").insert({
      id: newUser.user.id,
      email,
      full_name: name,
      phone_number: phone,
    });

    userEmail = email;
  } else {
    // Login: get user email from profile
    userEmail = existingProfile.email;
  }

  // Generate magic link for session establishment
  const redirectTo = `${APP_URL}/auth/callback?next=${encodeURIComponent(next || "/dashboard/bookings")}`;
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userEmail,
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error("verify-otp: generateLink failed", linkError);
    return NextResponse.json({ error: "Failed to generate session link" }, { status: 500 });
  }

  return NextResponse.json({ actionLink: linkData.properties.action_link });
}
