import { Card } from "@/components/ui/Card";
import { WhatsAppSayHi } from "@/components/app/WhatsAppSayHi";

/** WhatsApp assistant promo card. There's no linking flow anymore — the
 *  account's confirmed phone IS the bot binding the moment it's saved,
 *  so the only action left is opening the chat. Renders nothing when no bot
 *  number is configured (WhatsAppSayHi returns null). */
export function WhatsAppAssistantCard() {
  return (
    <Card>
      <Card.Content className="space-y-4">
        <div>
          <p className="label">WhatsApp assistant</p>
          <p className="mt-1 text-sm text-muted">
            Book, cancel, reschedule or check your schedule just by chatting in
            plain English.
          </p>
        </div>
        <WhatsAppSayHi label="Chat on WhatsApp" message="Hi!" />
      </Card.Content>
    </Card>
  );
}
