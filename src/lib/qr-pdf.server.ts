import PDFDocument from "pdfkit";
import { toBuffer } from "qrcode";
import { A2_COLUMNS, A2_ROWS, buildA2QrSlots, type DynamicQrRow } from "./qr-pdf-domain";
import { getRobotoBoldFontBuffer } from "./embedded-font.server";

// 1 mm = 72 / 25.4 pt = 2.83464567 pt
const MM_TO_PT = 72 / 25.4;

const A2_WIDTH_PT = 420 * MM_TO_PT;
const A2_HEIGHT_PT = 594 * MM_TO_PT;

const STICKER_SIZE_MM = 35;
const GAP_MM = 3;
const STICKER_SIZE_PT = STICKER_SIZE_MM * MM_TO_PT;
const PITCH_PT = (STICKER_SIZE_MM + GAP_MM) * MM_TO_PT;

// Center 10 columns x 15 rows on A2 sheet
const GRID_WIDTH_MM = A2_COLUMNS * STICKER_SIZE_MM + (A2_COLUMNS - 1) * GAP_MM; // 377 mm
const GRID_HEIGHT_MM = A2_ROWS * STICKER_SIZE_MM + (A2_ROWS - 1) * GAP_MM; // 567 mm

const MARGIN_LEFT_PT = ((420 - GRID_WIDTH_MM) / 2) * MM_TO_PT; // 21.5 mm in pt
const MARGIN_TOP_PT = ((594 - GRID_HEIGHT_MM) / 2) * MM_TO_PT; // 13.5 mm in pt

export async function generateA2QrPdfBuffer(rows: DynamicQrRow[], domain: string): Promise<Buffer> {
  const base = domain.trim().replace(/\/+$/, "");
  const slots = buildA2QrSlots(rows);

  // Parallel pre-generation of unique QR PNG buffers
  const uniqueRows = Array.from(new Map(rows.map((row) => [row.token, row])).values());
  const pngBuffers = await Promise.all(
    uniqueRows.map(async (row) => {
      const url = `${base}/q/${row.token}`;
      const buf = await toBuffer(url, {
        errorCorrectionLevel: "H",
        type: "png",
        margin: 1,
        width: 200,
      });
      return [row.token, buf] as const;
    }),
  );
  const qrCache = new Map<string, Buffer>(pngBuffers);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [A2_WIDTH_PT, A2_HEIGHT_PT],
        margin: 0,
        autoFirstPage: true,
        font: null as unknown as string,
      });

      doc.registerFont("Roboto-Bold", getRobotoBoldFontBuffer());
      doc.font("Roboto-Bold");

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err: Error) => reject(err));

      // Draw all 150 slots
      for (let idx = 0; idx < slots.length; idx++) {
        const item = slots[idx];
        const col = idx % A2_COLUMNS;
        const row = Math.floor(idx / A2_COLUMNS);

        const stickerX = MARGIN_LEFT_PT + col * PITCH_PT;
        const stickerY = MARGIN_TOP_PT + row * PITCH_PT;

        // 1. Draw light hairline cutting guide border (35mm x 35mm)
        doc
          .save()
          .rect(stickerX, stickerY, STICKER_SIZE_PT, STICKER_SIZE_PT)
          .lineWidth(0.25)
          .strokeColor("#cbd5e1")
          .stroke()
          .restore();

        // 2. Draw QR code image centered inside the sticker (33mm x 33mm with 1mm inner margin)
        const qrSizePt = 33 * MM_TO_PT;
        const qrOffsetPt = 1 * MM_TO_PT;
        const qrX = stickerX + qrOffsetPt;
        const qrY = stickerY + qrOffsetPt;

        const png = qrCache.get(item.token);
        if (png) {
          doc.image(png, qrX, qrY, { width: qrSizePt, height: qrSizePt });
        }

        // 3. Draw high-contrast center badge for Table Number (Center Badge Overlay)
        // Center of sticker
        const centerX = stickerX + STICKER_SIZE_PT / 2;
        const centerY = stickerY + STICKER_SIZE_PT / 2;

        const badgeWidthMm = item.tableNumber >= 100 ? 9.5 : 8.5;
        const badgeHeightMm = 8.5;
        const badgeWidthPt = badgeWidthMm * MM_TO_PT;
        const badgeHeightPt = badgeHeightMm * MM_TO_PT;
        const badgeX = centerX - badgeWidthPt / 2;
        const badgeY = centerY - badgeHeightPt / 2;

        // White background box with subtle dark border
        doc
          .save()
          .roundedRect(badgeX, badgeY, badgeWidthPt, badgeHeightPt, 1.5)
          .fillColor("#ffffff")
          .fill()
          .roundedRect(badgeX, badgeY, badgeWidthPt, badgeHeightPt, 1.5)
          .lineWidth(0.5)
          .strokeColor("#1e293b")
          .stroke()
          .restore();

        // Table number text in center of badge
        const fontSize = item.tableNumber >= 100 ? 9 : 10.5;
        doc.save().font("Roboto-Bold").fontSize(fontSize).fillColor("#000000");

        const text = String(item.tableNumber);
        const textWidth = doc.widthOfString(text);
        const textHeight = doc.currentLineHeight();

        doc.text(text, centerX - textWidth / 2, centerY - textHeight / 2 + 0.5, {
          lineBreak: false,
        });
        doc.restore();
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
