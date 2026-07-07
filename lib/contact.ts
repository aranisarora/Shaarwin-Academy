// Academy contact points (see also StageShell footer, legal pages).
export const WHATSAPP_NUMBER = "918431435758"; // +91 84314 35758
export const CONTACT_EMAIL = "sharwinttacademy@gmail.com";

export function whatsappLink(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
