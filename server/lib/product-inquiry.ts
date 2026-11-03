import { prisma } from "@/server/lib/prisma";
import { createNotificationFromEvent } from "@/server/lib/notifications";

export type ProductInquiryAttachment = {
  url: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt?: string;
};

export type ProductInquiryLineItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  variant: string | null;
  subscriptionTier: string | null;
  logoType: string | null;
  note: string | null;
  imageUrl: string | null;
  cartItemId: string | null;
};

export const PRODUCT_INQUIRY_STATUSES = [
  "pending",
  "read",
  "contacted",
  "quoted",
  "closed",
  "cancelled",
] as const;

export type ProductInquiryStatus = (typeof PRODUCT_INQUIRY_STATUSES)[number];

export function isProductInquiryStatus(value: string): value is ProductInquiryStatus {
  return (PRODUCT_INQUIRY_STATUSES as readonly string[]).includes(value);
}

export function generateInquiryReferenceNumber(): string {
  const date = new Date();
  const yyyymmdd =
    date.getFullYear().toString() +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");
  const suffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `INQ-${yyyymmdd}-${suffix}`;
}

export function buildInquiryTitle(items: ProductInquiryLineItem[]): string {
  if (items.length === 0) return "Product inquiry";
  if (items.length === 1) return `Inquiry about ${items[0].productName}`;
  return `Inquiry about ${items[0].productName} +${items.length - 1} more`;
}

export function parseInquiryItems(raw: string): ProductInquiryLineItem[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      productId: String(item?.productId ?? ""),
      productName: String(item?.productName ?? "Product"),
      quantity: Math.max(0, Number(item?.quantity) || 0),
      unitPrice: Math.max(0, Number(item?.unitPrice) || 0),
      variant: item?.variant ? String(item.variant) : null,
      subscriptionTier: item?.subscriptionTier ? String(item.subscriptionTier) : null,
      logoType: item?.logoType ? String(item.logoType) : null,
      note: item?.note ? String(item.note) : null,
      imageUrl: item?.imageUrl ? String(item.imageUrl) : null,
      cartItemId: item?.cartItemId ? String(item.cartItemId) : null,
    }));
  } catch {
    return [];
  }
}

export function parseInquiryAttachments(raw: string | null | undefined): ProductInquiryAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.url === "string" && item.url.trim())
      .map((item) => ({
        url: String(item.url).trim(),
        name: String(item.name ?? "attachment").slice(0, 255),
        mimeType: String(item.mimeType ?? "application/octet-stream").slice(0, 120),
        size: Math.max(0, Number(item.size) || 0),
        uploadedAt: item.uploadedAt ? String(item.uploadedAt) : undefined,
      }))
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function serializeInquiryRecord(row: {
  id: bigint;
  user_id: bigint | null;
  reference_number: string | null;
  title: string | null;
  name: string;
  email: string;
  contact: string;
  note: string | null;
  items: string;
  attachments: string | null;
  status: string;
  assigned_to: bigint | null;
  read_at: Date | null;
  contacted_at: Date | null;
  staff_notes: string | null;
  source: string | null;
  created_at: Date;
  updated_at: Date;
}) {
  const items = parseInquiryItems(row.items);
  return {
    id: row.id.toString(),
    userId: row.user_id?.toString() ?? null,
    referenceNumber: row.reference_number,
    title: row.title || buildInquiryTitle(items),
    name: row.name,
    email: row.email,
    contact: row.contact,
    note: row.note,
    items,
    attachments: parseInquiryAttachments(row.attachments),
    status: row.status,
    assignedTo: row.assigned_to?.toString() ?? null,
    readAt: row.read_at?.toISOString() ?? null,
    contactedAt: row.contacted_at?.toISOString() ?? null,
    staffNotes: row.staff_notes,
    source: row.source,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Fan-out in-app (+ email) notifications to every active staff user.
 * Also notifies assigned staff for the client when present (deduped).
 */
export async function notifyAllStaffForProductInquiry(params: {
  inquiryId: bigint;
  referenceNumber: string;
  title: string;
  clientUserId: bigint | null;
  customerName: string;
}): Promise<void> {
  const staffUsers = await prisma.user.findMany({
    where: { role: "staff", is_active: true },
    select: { user_id: true },
  });

  const assigned = params.clientUserId
    ? await prisma.staffClientAssignment.findMany({
        where: { client_user_id: params.clientUserId, is_active: true },
        select: { staff_id: true },
      })
    : [];

  const recipientIds = new Set<string>();
  for (const staff of staffUsers) recipientIds.add(staff.user_id.toString());
  for (const row of assigned) recipientIds.add(row.staff_id.toString());

  if (recipientIds.size === 0) return;

  const metadata = {
    inquiry_id: params.inquiryId.toString(),
    reference_number: params.referenceNumber,
    title: params.title,
    client_name: params.customerName,
  };

  await Promise.allSettled(
    Array.from(recipientIds).map((staffId) =>
      createNotificationFromEvent({
        targetUserId: BigInt(staffId),
        triggerUserId: params.clientUserId ?? undefined,
        eventType: "product_inquiry_received",
        priority: "high",
        metadata,
        needsEmail: true,
        emailPriority: "immediate",
      }),
    ),
  );
}
