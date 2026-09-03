import { toBuffer } from "qrcode";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { DynamicQrRow } from "./qr-export.server";

const QR_RENDER_PX = 520;
const QR_DISPLAY_PX = 128;
const PER_ROW = 4;

export function sortQrRowsAscending(rows: DynamicQrRow[]): DynamicQrRow[] {
  return [...rows].sort((a, b) => a.tableNumber - b.tableNumber);
}

function noBorders() {
  const nil = { style: BorderStyle.NIL, size: 0, color: "FFFFFF" };
  return {
    top: nil,
    bottom: nil,
    left: nil,
    right: nil,
    insideHorizontal: nil,
    insideVertical: nil,
  };
}

export async function buildDynamicQrExportDocxBuffer(
  rows: DynamicQrRow[],
  domain: string,
): Promise<Buffer> {
  const base = domain.trim().replace(/\/+$/, "");
  const sorted = sortQrRowsAscending(rows);
  const tableRows: TableRow[] = [];

  for (let i = 0; i < sorted.length; i += PER_ROW) {
    const cells: TableCell[] = [];
    for (let j = 0; j < PER_ROW; j++) {
      const item = sorted[i + j];
      if (!item) {
        cells.push(
          new TableCell({
            width: { size: 25, type: WidthType.PERCENTAGE },
            borders: noBorders(),
            children: [new Paragraph("")],
          }),
        );
        continue;
      }
      const png = await toBuffer(`${base}/q/${item.token}`, {
        type: "png",
        width: QR_RENDER_PX,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      cells.push(
        new TableCell({
          width: { size: 25, type: WidthType.PERCENTAGE },
          borders: noBorders(),
          margins: { top: 80, bottom: 150, left: 50, right: 50 },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 40 },
              children: [
                new ImageRun({
                  data: png,
                  transformation: { width: QR_DISPLAY_PX, height: QR_DISPLAY_PX },
                  type: "png",
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: `Meja ${item.tableNumber}`,
                  bold: true,
                  size: 22,
                  font: "Arial",
                }),
              ],
            }),
          ],
        }),
      );
    }
    tableRows.push(new TableRow({ children: cells, cantSplit: true }));
  }

  const doc = new Document({
    creator: "LIME",
    title: "QR Nomor Meja",
    description: "QR nomor meja, empat kolom per baris",
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 500, right: 450, bottom: 500, left: 450 },
          },
        },
        children: [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: [2750, 2750, 2750, 2750],
            borders: noBorders(),
            rows: tableRows,
          }),
        ],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
