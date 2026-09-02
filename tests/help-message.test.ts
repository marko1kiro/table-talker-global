import { describe, expect, it } from "vitest";
import {
  buildWhatsAppHelpUrl,
  buildWhatsAppMessage,
  SUPPORT_WHATSAPP_NUMBER,
} from "../src/lib/help-message";

describe("buildWhatsAppMessage", () => {
  it("formats a tidy multi-line report with code, name, and issue", () => {
    const message = buildWhatsAppMessage("CKRBUL", "Budi", "Tombol meja 12 tidak bersuara.");
    expect(message).toBe(
      [
        "*LAPORAN KENDALA LIME*",
        "",
        "Kode Resto: CKRBUL",
        "Nama Crew: Budi",
        "",
        "Kendala:",
        "Tombol meja 12 tidak bersuara.",
      ].join("\n"),
    );
  });

  it("preserves multi-line issue descriptions verbatim", () => {
    const message = buildWhatsAppMessage("CKRBUL", "Budi", "Baris satu\nBaris dua");
    expect(message).toContain("Kendala:\nBaris satu\nBaris dua");
  });

  it("does not silently drop or trim caller-provided values", () => {
    const message = buildWhatsAppMessage(" CKRBUL ", " Budi ", " Error muncul ");
    expect(message).toContain("Kode Resto:  CKRBUL ");
    expect(message).toContain("Nama Crew:  Budi ");
    expect(message).toContain(" Error muncul ");
  });
});

describe("buildWhatsAppHelpUrl", () => {
  it("targets the support WhatsApp number via wa.me", () => {
    const url = buildWhatsAppHelpUrl("CKRBUL", "Budi", "Error muncul.");
    expect(url.startsWith(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=`)).toBe(true);
  });

  it("uses the documented internal-format number without a leading plus", () => {
    expect(SUPPORT_WHATSAPP_NUMBER).toBe("6283826748958");
    expect(SUPPORT_WHATSAPP_NUMBER.startsWith("+")).toBe(false);
  });

  it("URL-encodes the message so it round-trips exactly through decodeURIComponent", () => {
    const url = buildWhatsAppHelpUrl("CKRBUL", "Budi & Ani", "Ada tanda spesial: 100% #error?");
    const encoded = url.slice(url.indexOf("text=") + "text=".length);
    const decoded = decodeURIComponent(encoded);
    expect(decoded).toBe(
      buildWhatsAppMessage("CKRBUL", "Budi & Ani", "Ada tanda spesial: 100% #error?"),
    );
  });

  it("keeps newlines from a multi-line issue intact after encoding", () => {
    const url = buildWhatsAppHelpUrl("CKRBUL", "Budi", "Baris satu\nBaris dua");
    const encoded = url.slice(url.indexOf("text=") + "text=".length);
    expect(decodeURIComponent(encoded)).toContain("Baris satu\nBaris dua");
  });
});
