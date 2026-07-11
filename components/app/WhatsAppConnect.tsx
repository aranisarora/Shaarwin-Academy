import { getWhatsAppLinkedPhone } from "@/lib/whatsapp/link-action";
import { WhatsAppConnectCard } from "@/components/app/WhatsAppConnectCard";

/** "Connect WhatsApp" card — shown on every role's profile/settings screen.
 *  Server component: resolves the current link state so the card can offer
 *  "Connect" or "Unlink" accordingly. */
export async function WhatsAppConnect() {
  const linkedPhone = await getWhatsAppLinkedPhone();
  return <WhatsAppConnectCard linkedPhone={linkedPhone} />;
}
