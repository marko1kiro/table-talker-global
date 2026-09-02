// Domain logic untuk fitur "Contact Bantuan": memformat laporan kendala crew
// menjadi pesan WhatsApp yang rapi dan membangun deep-link wa.me siap kirim.

// Nomor tujuan laporan kendala (format internasional tanpa "+" untuk wa.me).
export const SUPPORT_WHATSAPP_NUMBER = "6283826748958";

export function buildWhatsAppMessage(
  restaurantCode: string,
  crewName: string,
  issue: string,
): string {
  const lines = [
    "*LAPORAN KENDALA LIME*",
    "",
    `Kode Resto: ${restaurantCode}`,
    `Nama Crew: ${crewName}`,
    "",
    "Kendala:",
    issue,
  ];
  return lines.join("\n");
}

export function buildWhatsAppHelpUrl(
  restaurantCode: string,
  crewName: string,
  issue: string,
): string {
  const message = buildWhatsAppMessage(restaurantCode, crewName, issue);
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
