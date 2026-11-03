import ExcelJS from "exceljs";

type BlankCardExportRow = {
  id: string;
  serialId: string | null;
  qrCodeUrl: string | null;
  portfolioUrl: string | null;
  generatedAt: Date | null;
  claimedAt: Date | null;
  claimedByName: string | null;
  claimedByEmail: string | null;
};

type ExportMeta = {
  exportedBy: string;
  status: "all" | "claimed" | "unclaimed";
  fromDate?: string | null;
  toDate?: string | null;
};

export async function buildBlankBizcardsWorkbook(
  rows: BlankCardExportRow[],
  meta: ExportMeta
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = meta.exportedBy;
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet("Blank Bizcards");
  worksheet.columns = [
    { header: "Serial ID", key: "serialId", width: 22 },
    { header: "QR Code URL", key: "qrCodeUrl", width: 50 },
    { header: "Portfolio URL", key: "portfolioUrl", width: 50 },
    { header: "Status", key: "status", width: 14 },
    { header: "Generated At", key: "generatedAt", width: 24 },
    { header: "Claimed At", key: "claimedAt", width: 24 },
    { header: "Claimed By", key: "claimedByName", width: 28 },
    { header: "Claimed Email", key: "claimedByEmail", width: 32 },
    { header: "Bizcard ID", key: "id", width: 16 },
  ];

  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2937" },
  };

  for (const row of rows) {
    worksheet.addRow({
      serialId: row.serialId ?? "",
      qrCodeUrl: row.qrCodeUrl ?? "",
      portfolioUrl: row.portfolioUrl ?? "",
      status: row.claimedAt ? "Claimed" : "Unclaimed",
      generatedAt: row.generatedAt ? row.generatedAt.toISOString() : "",
      claimedAt: row.claimedAt ? row.claimedAt.toISOString() : "",
      claimedByName: row.claimedByName ?? "",
      claimedByEmail: row.claimedByEmail ?? "",
      id: row.id,
    });
  }

  const summarySheet = workbook.addWorksheet("Summary");
  const claimedCount = rows.filter((row) => row.claimedAt).length;

  summarySheet.addRow(["Total Generated", rows.length]);
  summarySheet.addRow(["Claimed", claimedCount]);
  summarySheet.addRow(["Unclaimed", rows.length - claimedCount]);
  summarySheet.addRow(["Status Filter", meta.status]);
  summarySheet.addRow(["From Date", meta.fromDate ?? "All"]);
  summarySheet.addRow(["To Date", meta.toDate ?? "All"]);
  summarySheet.addRow(["Exported By", meta.exportedBy]);
  summarySheet.addRow(["Exported At", new Date().toISOString()]);

  const workbookBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(workbookBuffer as ArrayBuffer);
}
