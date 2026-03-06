import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

const FROM = `whatsapp:${process.env.TWILIO_WHATSAPP_FROM!}`;
const FOUNDER_PHONE = process.env.FOUNDER_PHONE!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

function toWhatsApp(phone: string): string {
  const e164 = phone.startsWith("+") ? phone : `+${phone}`;
  return `whatsapp:${e164}`;
}

export async function sendText(to: string, body: string) {
  try {
    await client.messages.create({ from: FROM, to: toWhatsApp(to), body });
  } catch (e) {
    console.warn("Twilio sendText failed:", e);
  }
}

export async function sendImage(to: string, url: string, caption?: string) {
  try {
    await client.messages.create({
      from: FROM,
      to: toWhatsApp(to),
      body: caption ?? "",
      mediaUrl: [url],
    });
  } catch (e) {
    console.warn("Twilio sendImage failed:", e);
  }
}

// ── Notification helpers ──────────────────────────────────────────────────────

export async function notifyWelcome(phone: string, name: string) {
  await sendText(
    phone,
    `Welcome to Shaarwin Academy, ${name}! 🏓\n\nYour account is all set. Head over to book your first class:\n${APP_URL}/book`
  );
}

export async function notifyBookingConfirmed(
  phone: string,
  name: string,
  details: string
) {
  await sendText(
    phone,
    `Hi ${name}! Your booking is confirmed 🎉\n\n${details}\n\nManage your bookings here:\n${APP_URL}/dashboard/bookings`
  );
}

export async function notifyFounderNewBooking(
  userName: string,
  userPhone: string,
  details: string,
  screenshotUrl?: string,
  totalAmount?: number
) {
  const amountLine =
    totalAmount !== undefined
      ? `\nExpected payment: ₹${totalAmount.toLocaleString("en-IN")}\n\nIf the payment looks incorrect, please message the client directly.`
      : "";

  await sendText(
    FOUNDER_PHONE,
    `New Booking! 🏓\n\nStudent: ${userName}\nPhone: ${userPhone}\n\n${details}${amountLine}`
  );
  if (screenshotUrl) {
    await sendImage(FOUNDER_PHONE, screenshotUrl, "Payment Screenshot");
  }
}

export async function notifyAbsenceConfirmed(
  phone: string,
  name: string,
  className: string,
  dateStr: string
) {
  await sendText(
    phone,
    `Got it, ${name}! ✓\n\nYou've been marked absent for:\n${className}\n${dateStr}\n\nLet us know if you need to reschedule.`
  );
}

export async function notifyRescheduleConfirmed(
  phone: string,
  name: string,
  className: string,
  newDateStr: string
) {
  await sendText(
    phone,
    `Done, ${name}! ✓\n\nYour class has been rescheduled.\n\n${className}\nNew time: ${newDateStr}`
  );
}
