import type { OrderReceiptData } from "@/server/lib/billing/order-receipt";

// Professional document standards
const IMG_STANDARDS = {
  width: 800,
  height: 1050,
  marginTop: 40,
  marginRight: 40,
  marginBottom: 40,
  marginLeft: 40,
  fontSize: {
    title: 22,
    sectionTitle: 11,
    body: 10,
    small: 9,
    tiny: 8,
  },
  colors: {
    primary: '#2D3A8C',
    text: '#111827',
    textSecondary: '#6b7280',
    border: '#d8deee',
    headerBg: '#f3f4f6',
    lightBg: '#fafbff',
    success: '#22c55e',
  },
  spacing: {
    sectionGap: 20,
    lineHeight: 14,
    rowHeight: 18,
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

function generateReceiptSVG(receipt: OrderReceiptData): string {
  const width = IMG_STANDARDS.width;
  const height = IMG_STANDARDS.height;
  const currency = String(receipt.currency ?? 'USD');
  const margin = IMG_STANDARDS.marginLeft;
  const contentWidth = width - margin - IMG_STANDARDS.marginRight;
  
  let y = IMG_STANDARDS.marginTop;
  const elements: string[] = [];

  // Helper to add text with proper positioning
  const addText = (
    text: string,
    x: number,
    yPos: number,
    size: number,
    bold = false,
    color = IMG_STANDARDS.colors.text,
    textAnchor = 'start',
    maxWidth?: number
  ) => {
    const fontWeight = bold ? 'bold' : 'normal';
    const anchor = textAnchor === 'middle' ? 'middle' : textAnchor === 'end' ? 'end' : 'start';
    const style = maxWidth ? `style="word-wrap: break-word; max-width: ${maxWidth}px;"` : '';
    elements.push(`<text x="${x}" y="${yPos}" font-size="${size}" font-weight="${fontWeight}" fill="${color}" font-family="Arial, sans-serif" text-anchor="${anchor}" ${style}>${escapeXml(text)}</text>`);
  };

  // Helper to draw rectangles
  const drawRect = (x: number, yPos: number, w: number, h: number, fill?: string, stroke?: string, strokeWidth = 1) => {
    const fillAttr = fill ? `fill="${fill}"` : 'fill="none"';
    const strokeAttr = stroke ? `stroke="${stroke}" stroke-width="${strokeWidth}"` : '';
    elements.push(`<rect x="${x}" y="${yPos}" width="${w}" height="${h}" ${fillAttr} ${strokeAttr}/>`);
  };

  // Helper to draw lines
  const drawLine = (x1: number, y1: number, x2: number, y2: number, stroke = IMG_STANDARDS.colors.border, strokeWidth = 1) => {
    elements.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
  };

  // ==================== HEADER ====================
  addText(String(receipt.business.name ?? 'OnTap'), margin, y, IMG_STANDARDS.fontSize.title, true, IMG_STANDARDS.colors.primary);
  y += 32;

  const businessDetails = [receipt.business.email, receipt.business.phone, receipt.business.address].filter(Boolean);
  for (const detail of businessDetails) {
    addText(String(detail), margin, y, IMG_STANDARDS.fontSize.small, false, IMG_STANDARDS.colors.textSecondary);
    y += 14;
  }

  y += 8;
  drawLine(margin, y, width - IMG_STANDARDS.marginRight, y, IMG_STANDARDS.colors.primary, 2);
  y += IMG_STANDARDS.spacing.sectionGap;

  // ==================== INVOICE TITLE & NUMBER ====================
  addText('INVOICE', margin, y, IMG_STANDARDS.fontSize.title, true);
  addText(String(receipt.invoice_number ?? ''), width - IMG_STANDARDS.marginRight, y, IMG_STANDARDS.fontSize.body, true, IMG_STANDARDS.colors.text, 'end');
  y += 28;

  // ==================== BILL TO & ORDER DETAILS ====================
  const colWidth = (contentWidth / 2) - 8;

  // Left column header
  addText('BILL TO', margin, y, IMG_STANDARDS.fontSize.sectionTitle, true, IMG_STANDARDS.colors.textSecondary);
  // Right column header
  addText('ORDER DETAILS', margin + colWidth + 16, y, IMG_STANDARDS.fontSize.sectionTitle, true, IMG_STANDARDS.colors.textSecondary);
  y += 16;

  // Left column content
  addText(String(receipt.customer.name ?? ''), margin, y, IMG_STANDARDS.fontSize.body, true);
  // Right column content
  addText('Order #', margin + colWidth + 16, y, IMG_STANDARDS.fontSize.small, false, IMG_STANDARDS.colors.textSecondary);
  y += 14;

  addText(String(receipt.customer.email ?? ''), margin, y, IMG_STANDARDS.fontSize.small, false, IMG_STANDARDS.colors.textSecondary, 'start', colWidth);
  addText(String(receipt.order_number ?? ''), margin + colWidth + 16, y, IMG_STANDARDS.fontSize.body, true);
  y += 16;

  // Right side second row
  addText('Date', margin + colWidth + 16, y, IMG_STANDARDS.fontSize.small, false, IMG_STANDARDS.colors.textSecondary);
  y += 14;

  addText(formatDate(String(receipt.date ?? '')), margin + colWidth + 16, y, IMG_STANDARDS.fontSize.body);
  y += 16;

  // Right side third row
  addText('Status', margin + colWidth + 16, y, IMG_STANDARDS.fontSize.small, false, IMG_STANDARDS.colors.textSecondary);
  y += 14;

  const statusColor = receipt.status?.toLowerCase() === 'completed' ? IMG_STANDARDS.colors.success : IMG_STANDARDS.colors.primary;
  addText(String(receipt.status ?? '').toUpperCase(), margin + colWidth + 16, y, IMG_STANDARDS.fontSize.body, true, statusColor);
  y += 24;

  drawLine(margin, y, width - IMG_STANDARDS.marginRight, y, IMG_STANDARDS.colors.border);
  y += IMG_STANDARDS.spacing.sectionGap;

  // ==================== ITEMS TABLE ====================
  // Table header background
  drawRect(margin, y - 14, contentWidth, 18, IMG_STANDARDS.colors.headerBg, IMG_STANDARDS.colors.border, 1);

  const col1X = margin + 8;
  const col2X = margin + contentWidth * 0.65;
  const col3X = width - IMG_STANDARDS.marginRight - 60;

  addText('ITEM DESCRIPTION', col1X, y - 2, IMG_STANDARDS.fontSize.body, true, IMG_STANDARDS.colors.text);
  addText('QTY', col2X, y - 2, IMG_STANDARDS.fontSize.body, true, IMG_STANDARDS.colors.text);
  addText('AMOUNT', col3X, y - 2, IMG_STANDARDS.fontSize.body, true, IMG_STANDARDS.colors.text, 'end');

  y += 20;

  // Table rows
  let rowIndex = 0;
  if (Array.isArray(receipt.items) && receipt.items.length > 0) {
    for (const item of receipt.items) {
      // Alternating row background
      if (rowIndex % 2 === 0) {
        drawRect(margin, y - 12, contentWidth, IMG_STANDARDS.spacing.rowHeight, IMG_STANDARDS.colors.lightBg);
      }

      const desc = String(item.description ?? '');
      const qty = Number(item.quantity ?? 0);
      const amt = Number(item.amount ?? 0);

      addText(desc, col1X, y + 2, IMG_STANDARDS.fontSize.small, false, IMG_STANDARDS.colors.text, 'start', 200);
      addText(String(qty), col2X, y + 2, IMG_STANDARDS.fontSize.small);
      addText(formatMoney(amt, currency), col3X, y + 2, IMG_STANDARDS.fontSize.small, true, IMG_STANDARDS.colors.text, 'end');

      drawLine(margin, y + 8, width - IMG_STANDARDS.marginRight, y + 8, IMG_STANDARDS.colors.border, 0.5);

      y += IMG_STANDARDS.spacing.rowHeight;
      rowIndex++;
    }
  }

  drawLine(margin, y, width - IMG_STANDARDS.marginRight, y, IMG_STANDARDS.colors.primary, 2);
  y += IMG_STANDARDS.spacing.sectionGap;

  // ==================== TOTALS ====================
  const totalsLabelX = width - IMG_STANDARDS.marginRight - 160;
  const totalsValueX = width - IMG_STANDARDS.marginRight - 8;

  const subtotal = Number(receipt.subtotal ?? 0);
  const discount = Number(receipt.discount ?? 0);
  const shipping = Number(receipt.shipping ?? 0);
  const tax = Number(receipt.tax ?? 0);

  addText('Subtotal:', totalsLabelX, y, IMG_STANDARDS.fontSize.body, false, IMG_STANDARDS.colors.textSecondary);
  addText(formatMoney(subtotal, currency), totalsValueX, y, IMG_STANDARDS.fontSize.body, false, IMG_STANDARDS.colors.text, 'end');
  y += 18;

  if (discount > 0) {
    addText('Discount:', totalsLabelX, y, IMG_STANDARDS.fontSize.body, false, IMG_STANDARDS.colors.textSecondary);
    addText(`-${formatMoney(discount, currency)}`, totalsValueX, y, IMG_STANDARDS.fontSize.body, false, IMG_STANDARDS.colors.success, 'end');
    y += 18;
  }

  if (shipping > 0) {
    addText('Shipping:', totalsLabelX, y, IMG_STANDARDS.fontSize.body, false, IMG_STANDARDS.colors.textSecondary);
    addText(formatMoney(shipping, currency), totalsValueX, y, IMG_STANDARDS.fontSize.body, false, IMG_STANDARDS.colors.text, 'end');
    y += 18;
  }

  addText('Tax:', totalsLabelX, y, IMG_STANDARDS.fontSize.body, false, IMG_STANDARDS.colors.textSecondary);
  addText(formatMoney(tax, currency), totalsValueX, y, IMG_STANDARDS.fontSize.body, false, IMG_STANDARDS.colors.text, 'end');
  y += 16;

  // Total divider
  drawLine(totalsLabelX - 10, y, width - IMG_STANDARDS.marginRight, y, IMG_STANDARDS.colors.primary, 1.5);
  y += 18;

  // Grand total box
  drawRect(totalsLabelX - 10, y - 16, width - IMG_STANDARDS.marginRight - (totalsLabelX - 10), 22, IMG_STANDARDS.colors.lightBg, IMG_STANDARDS.colors.primary, 1.5);
  addText('TOTAL:', totalsLabelX, y, IMG_STANDARDS.fontSize.body + 1, true, IMG_STANDARDS.colors.primary);
  addText(String(receipt.formatted_total ?? '0.00'), totalsValueX, y, IMG_STANDARDS.fontSize.body + 1, true, IMG_STANDARDS.colors.primary, 'end');
  y += 30;

  // ==================== PAYMENT METHOD ====================
  addText('Payment Method:', margin, y, IMG_STANDARDS.fontSize.body, true, IMG_STANDARDS.colors.textSecondary);
  y += 14;

  const paymentType = String(receipt.payment_method.type ?? 'Unknown');
  const paymentBrand = receipt.payment_method.brand ? ` (${String(receipt.payment_method.brand)})` : '';
  addText(`${paymentType}${paymentBrand}`, margin, y, IMG_STANDARDS.fontSize.body);
  y += 24;

  // ==================== FOOTER ====================
  drawLine(margin, y, width - IMG_STANDARDS.marginRight, y, IMG_STANDARDS.colors.border, 0.5);
  y += 14;

  addText('Thank you for your business!', width / 2, y, IMG_STANDARDS.fontSize.body, true, IMG_STANDARDS.colors.primary, 'middle');
  y += 14;

  addText(`For inquiries, contact ${String(receipt.business.email ?? '')}`, width / 2, y, IMG_STANDARDS.fontSize.tiny, false, IMG_STANDARDS.colors.textSecondary, 'middle');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="white"/>
      ${elements.join('\n')}
    </svg>
  `;
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function buildOrderReceiptImage(receipt: OrderReceiptData): Promise<Buffer> {
  try {
    console.log("[IMAGE_BUILDER] Starting image generation", {
      hasReceipt: !!receipt,
      businessName: receipt?.business?.name,
      itemsCount: receipt?.items?.length,
    });

    // Generate SVG content
    const svg = generateReceiptSVG(receipt);

    // Use sharp to convert SVG to PNG
    const sharp = await import('sharp');
    const pngBuffer = await sharp.default(Buffer.from(svg))
      .png()
      .toBuffer();

    console.log("[IMAGE_BUILDER] Image generated successfully", { bytesCount: pngBuffer.length });
    return pngBuffer;
  } catch (err) {
    console.error("[IMAGE_BUILDER] Error during image generation:", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      type: err?.constructor?.name,
    });
    throw new Error(
      `Image generation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
