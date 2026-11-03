import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { OrderReceiptData } from "@/server/lib/billing/order-receipt";

// Professional document standards (ISO 216 A4)
const DOC_STANDARDS = {
  pageWidth: 595,  // 210mm in points
  pageHeight: 842, // 297mm in points
  marginTop: 40,
  marginRight: 40,
  marginBottom: 40,
  marginLeft: 40,
  lineHeight: 1.4,
  sectionSpacing: 16,
  rowHeight: 18,
  fontSize: {
    header: 9,
    title: 20,
    sectionTitle: 10,
    body: 11,
    table: 10,
    small: 9,
    tiny: 8,
  },
  colors: {
    primary: rgb(0.18, 0.22, 0.55),
    text: rgb(0.1, 0.1, 0.1),
    textSecondary: rgb(0.4, 0.4, 0.4),
    border: rgb(0.85, 0.85, 0.85),
    headerBg: rgb(0.97, 0.97, 0.98),
    success: rgb(0.13, 0.78, 0.34),
  },
};

function formatMoney(amount: number, currency: string): string {
  try {
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
    
    return formatted
      .replace('₱', 'PHP ')
      .replace('€', 'EUR ')
      .replace('¥', 'JPY ')
      .replace('₹', 'INR ')
      .replace('₩', 'KRW ')
      .replace('₪', 'ILS ')
      .replace('₨', 'PKR ')
      .replace('฿', 'THB ')
      .replace('₦', 'NGN ')
      .replace('₡', 'CRC ')
      .replace('₱', 'PHP ');
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function buildOrderReceiptPdf(
  receipt: OrderReceiptData,
): Promise<Uint8Array> {
  try {
    console.log("[PDF_BUILDER] Starting PDF generation");

    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const page = pdf.addPage([DOC_STANDARDS.pageWidth, DOC_STANDARDS.pageHeight]);
    let y = DOC_STANDARDS.pageHeight - DOC_STANDARDS.marginTop;

    const contentWidth = DOC_STANDARDS.pageWidth - DOC_STANDARDS.marginLeft - DOC_STANDARDS.marginRight;

    // Header section
    page.drawText(String(receipt.business.name ?? 'OnTap'), {
      x: DOC_STANDARDS.marginLeft,
      y,
      size: DOC_STANDARDS.fontSize.title,
      font: bold,
      color: DOC_STANDARDS.colors.primary,
    });
    y -= 28;

    const companyDetails = [
      receipt.business.email,
      receipt.business.phone,
      receipt.business.address,
    ].filter(Boolean);

    for (const detail of companyDetails) {
      page.drawText(String(detail), {
        x: DOC_STANDARDS.marginLeft,
        y,
        size: DOC_STANDARDS.fontSize.small,
        font: regular,
        color: DOC_STANDARDS.colors.textSecondary,
      });
      y -= 12;
    }

    y -= 12;

    // Primary divider
    page.drawLine({
      start: { x: DOC_STANDARDS.marginLeft, y },
      end: { x: DOC_STANDARDS.pageWidth - DOC_STANDARDS.marginRight, y },
      thickness: 2,
      color: DOC_STANDARDS.colors.primary,
    });
    y -= 20;

    // Document title and invoice number
    page.drawText('INVOICE', {
      x: DOC_STANDARDS.marginLeft,
      y,
      size: DOC_STANDARDS.fontSize.title,
      font: bold,
      color: DOC_STANDARDS.colors.text,
    });

    const orderDetailsX = DOC_STANDARDS.pageWidth - DOC_STANDARDS.marginRight - 120;
    page.drawText(`Invoice #`, {
      x: orderDetailsX,
      y,
      size: DOC_STANDARDS.fontSize.body,
      font: regular,
      color: DOC_STANDARDS.colors.textSecondary,
    });
    page.drawText(String(receipt.invoice_number ?? ''), {
      x: orderDetailsX,
      y: y - 14,
      size: DOC_STANDARDS.fontSize.body,
      font: bold,
      color: DOC_STANDARDS.colors.text,
    });

    y -= 28;

    // Bill To and Order Details section
    const colWidth = (contentWidth / 2) - 8;

    // Left column
    page.drawText('BILL TO:', {
      x: DOC_STANDARDS.marginLeft,
      y,
      size: DOC_STANDARDS.fontSize.sectionTitle,
      font: bold,
      color: DOC_STANDARDS.colors.textSecondary,
    });
    y -= 14;

    page.drawText(String(receipt.customer.name ?? ''), {
      x: DOC_STANDARDS.marginLeft,
      y,
      size: DOC_STANDARDS.fontSize.body,
      font: bold,
      color: DOC_STANDARDS.colors.text,
    });
    y -= 14;

    page.drawText(String(receipt.customer.email ?? ''), {
      x: DOC_STANDARDS.marginLeft,
      y,
      size: DOC_STANDARDS.fontSize.small,
      font: regular,
      color: DOC_STANDARDS.colors.textSecondary,
      maxWidth: colWidth,
    });
    y -= 14;

    // Right column
    const detailsX = DOC_STANDARDS.marginLeft + colWidth + 16;
    const detailsStartY = y + 28;

    page.drawText('ORDER DETAILS', {
      x: detailsX,
      y: detailsStartY,
      size: DOC_STANDARDS.fontSize.sectionTitle,
      font: bold,
      color: DOC_STANDARDS.colors.textSecondary,
    });

    page.drawText('Order #', {
      x: detailsX,
      y: detailsStartY - 14,
      size: DOC_STANDARDS.fontSize.small,
      font: regular,
      color: DOC_STANDARDS.colors.textSecondary,
    });
    page.drawText(String(receipt.order_number ?? ''), {
      x: detailsX,
      y: detailsStartY - 28,
      size: DOC_STANDARDS.fontSize.body,
      font: bold,
      color: DOC_STANDARDS.colors.text,
    });

    page.drawText('Date', {
      x: detailsX,
      y: detailsStartY - 42,
      size: DOC_STANDARDS.fontSize.small,
      font: regular,
      color: DOC_STANDARDS.colors.textSecondary,
    });
    page.drawText(formatDate(String(receipt.date ?? '')), {
      x: detailsX,
      y: detailsStartY - 56,
      size: DOC_STANDARDS.fontSize.body,
      font: regular,
      color: DOC_STANDARDS.colors.text,
    });

    page.drawText('Status', {
      x: detailsX,
      y: detailsStartY - 70,
      size: DOC_STANDARDS.fontSize.small,
      font: regular,
      color: DOC_STANDARDS.colors.textSecondary,
    });
    page.drawText(String(receipt.status ?? '').toUpperCase(), {
      x: detailsX,
      y: detailsStartY - 84,
      size: DOC_STANDARDS.fontSize.body,
      font: bold,
      color: receipt.status?.toLowerCase() === 'completed' ? DOC_STANDARDS.colors.success : DOC_STANDARDS.colors.primary,
    });

    y -= 100;
    y -= 12;

    // Items table
    const tableHeaderY = y;
    page.drawRectangle({
      x: DOC_STANDARDS.marginLeft,
      y: tableHeaderY - 20,
      width: contentWidth,
      height: 20,
      color: DOC_STANDARDS.colors.headerBg,
      borderColor: DOC_STANDARDS.colors.border,
      borderWidth: 1,
    });

    const col1 = DOC_STANDARDS.marginLeft + 10;
    const col2 = DOC_STANDARDS.pageWidth / 2 + 40;
    const col3 = DOC_STANDARDS.pageWidth - DOC_STANDARDS.marginRight - 100;

    page.drawText('ITEM DESCRIPTION', {
      x: col1,
      y: tableHeaderY - 14,
      size: DOC_STANDARDS.fontSize.table,
      font: bold,
      color: DOC_STANDARDS.colors.text,
    });

    page.drawText('QTY', {
      x: col2,
      y: tableHeaderY - 14,
      size: DOC_STANDARDS.fontSize.table,
      font: bold,
      color: DOC_STANDARDS.colors.text,
    });

    page.drawText('AMOUNT', {
      x: col3,
      y: tableHeaderY - 14,
      size: DOC_STANDARDS.fontSize.table,
      font: bold,
      color: DOC_STANDARDS.colors.text,
    });

    y = tableHeaderY - 26;

    const currency = String(receipt.currency ?? 'USD');
    let rowIndex = 0;

    if (Array.isArray(receipt.items) && receipt.items.length > 0) {
      for (const item of receipt.items) {
        if (rowIndex % 2 === 0) {
          page.drawRectangle({
            x: DOC_STANDARDS.marginLeft,
            y: y - DOC_STANDARDS.rowHeight,
            width: contentWidth,
            height: DOC_STANDARDS.rowHeight,
            color: rgb(0.99, 0.99, 1),
          });
        }

        page.drawLine({
          start: { x: DOC_STANDARDS.marginLeft, y: y - DOC_STANDARDS.rowHeight },
          end: { x: DOC_STANDARDS.pageWidth - DOC_STANDARDS.marginRight, y: y - DOC_STANDARDS.rowHeight },
          thickness: 0.5,
          color: DOC_STANDARDS.colors.border,
        });

        const desc = String(item.description ?? '');
        const qty = Number(item.quantity ?? 0);
        const amt = Number(item.amount ?? 0);

        page.drawText(desc, {
          x: col1,
          y: y - 12,
          size: DOC_STANDARDS.fontSize.table,
          font: regular,
          color: DOC_STANDARDS.colors.text,
          maxWidth: col2 - col1 - 10,
        });

        page.drawText(String(qty), {
          x: col2,
          y: y - 12,
          size: DOC_STANDARDS.fontSize.table,
          font: regular,
          color: DOC_STANDARDS.colors.text,
        });

        page.drawText(formatMoney(amt, currency), {
          x: col3,
          y: y - 12,
          size: DOC_STANDARDS.fontSize.table,
          font: bold,
          color: DOC_STANDARDS.colors.text,
        });

        y -= DOC_STANDARDS.rowHeight;
        rowIndex++;
      }
    }

    page.drawLine({
      start: { x: DOC_STANDARDS.marginLeft, y },
      end: { x: DOC_STANDARDS.pageWidth - DOC_STANDARDS.marginRight, y },
      thickness: 2,
      color: DOC_STANDARDS.colors.primary,
    });

    y -= 20;

    // Totals section
    const totalsX = DOC_STANDARDS.pageWidth - DOC_STANDARDS.marginRight - 150;
    const totalsLabelX = totalsX - 80;

    const subtotal = Number(receipt.subtotal ?? 0);
    const discount = Number(receipt.discount ?? 0);
    const shipping = Number(receipt.shipping ?? 0);
    const tax = Number(receipt.tax ?? 0);

    page.drawText('Subtotal:', {
      x: totalsLabelX,
      y,
      size: DOC_STANDARDS.fontSize.body,
      font: regular,
      color: DOC_STANDARDS.colors.textSecondary,
    });
    page.drawText(formatMoney(subtotal, currency), {
      x: totalsX,
      y,
      size: DOC_STANDARDS.fontSize.body,
      font: regular,
      color: DOC_STANDARDS.colors.text,
    });
    y -= 18;

    if (discount > 0) {
      page.drawText('Discount:', {
        x: totalsLabelX,
        y,
        size: DOC_STANDARDS.fontSize.body,
        font: regular,
        color: DOC_STANDARDS.colors.textSecondary,
      });
      page.drawText(`-${formatMoney(discount, currency)}`, {
        x: totalsX,
        y,
        size: DOC_STANDARDS.fontSize.body,
        font: regular,
        color: DOC_STANDARDS.colors.success,
      });
      y -= 18;
    }

    if (shipping > 0) {
      page.drawText('Shipping:', {
        x: totalsLabelX,
        y,
        size: DOC_STANDARDS.fontSize.body,
        font: regular,
        color: DOC_STANDARDS.colors.textSecondary,
      });
      page.drawText(formatMoney(shipping, currency), {
        x: totalsX,
        y,
        size: DOC_STANDARDS.fontSize.body,
        font: regular,
        color: DOC_STANDARDS.colors.text,
      });
      y -= 18;
    }

    page.drawText('Tax:', {
      x: totalsLabelX,
      y,
      size: DOC_STANDARDS.fontSize.body,
      font: regular,
      color: DOC_STANDARDS.colors.textSecondary,
    });
    page.drawText(formatMoney(tax, currency), {
      x: totalsX,
      y,
      size: DOC_STANDARDS.fontSize.body,
      font: regular,
      color: DOC_STANDARDS.colors.text,
    });
    y -= 20;

    page.drawLine({
      start: { x: totalsLabelX, y },
      end: { x: DOC_STANDARDS.pageWidth - DOC_STANDARDS.marginRight, y },
      thickness: 1.5,
      color: DOC_STANDARDS.colors.primary,
    });
    y -= 18;

    // Grand total box
    page.drawRectangle({
      x: totalsLabelX - 10,
      y: y - 24,
      width: DOC_STANDARDS.pageWidth - DOC_STANDARDS.marginRight - (totalsLabelX - 10),
      height: 24,
      color: rgb(0.97, 0.98, 1),
      borderColor: DOC_STANDARDS.colors.primary,
      borderWidth: 1.5,
    });

    page.drawText('TOTAL:', {
      x: totalsLabelX,
      y: y - 6,
      size: DOC_STANDARDS.fontSize.body + 2,
      font: bold,
      color: DOC_STANDARDS.colors.primary,
    });
    page.drawText(String(receipt.formatted_total ?? '0.00'), {
      x: totalsX,
      y: y - 6,
      size: DOC_STANDARDS.fontSize.body + 2,
      font: bold,
      color: DOC_STANDARDS.colors.primary,
    });

    y -= 40;

    // Payment method
    page.drawText('Payment Method:', {
      x: DOC_STANDARDS.marginLeft,
      y,
      size: DOC_STANDARDS.fontSize.body,
      font: bold,
      color: DOC_STANDARDS.colors.textSecondary,
    });
    y -= 14;

    const paymentType = String(receipt.payment_method.type ?? 'Unknown');
    const paymentBrand = receipt.payment_method.brand ? ` (${String(receipt.payment_method.brand)})` : '';
    page.drawText(`${paymentType}${paymentBrand}`, {
      x: DOC_STANDARDS.marginLeft,
      y,
      size: DOC_STANDARDS.fontSize.body,
      font: regular,
      color: DOC_STANDARDS.colors.text,
    });

    y -= 30;

    // Footer
    page.drawLine({
      start: { x: DOC_STANDARDS.marginLeft, y },
      end: { x: DOC_STANDARDS.pageWidth - DOC_STANDARDS.marginRight, y },
      thickness: 0.5,
      color: DOC_STANDARDS.colors.border,
    });

    y -= 14;

    page.drawText('Thank you for your business!', {
      x: DOC_STANDARDS.marginLeft,
      y,
      size: DOC_STANDARDS.fontSize.body,
      font: bold,
      color: DOC_STANDARDS.colors.primary,
    });

    y -= 14;

    page.drawText(`For inquiries, contact ${String(receipt.business.email ?? '')} | Invoice: ${String(receipt.invoice_number ?? '')}`, {
      x: DOC_STANDARDS.marginLeft,
      y,
      size: DOC_STANDARDS.fontSize.tiny,
      font: regular,
      color: DOC_STANDARDS.colors.textSecondary,
      maxWidth: contentWidth,
    });

    console.log("[PDF_BUILDER] PDF saved successfully");
    const pdfBytes = await pdf.save();
    return pdfBytes;
  } catch (err) {
    console.error("[PDF_BUILDER] Error during PDF generation:", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(
      `PDF generation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
