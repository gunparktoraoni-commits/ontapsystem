import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import {
  isPortfolioLeadStatus,
  PORTFOLIO_LEAD_STATUS_LABELS,
  sanitizePortfolioLeadOwnerNotes,
  type PortfolioLeadStatus,
} from "@/app/lib/portfolioLeadConstants";

export {
  isPortfolioLeadStatus,
  PORTFOLIO_LEAD_STATUSES,
  PORTFOLIO_LEAD_STATUS_LABELS,
  type PortfolioLeadStatus,
} from "@/app/lib/portfolioLeadConstants";

export function normalizeLeadEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildLeadVisitorKey(email: string): string {
  return normalizeLeadEmail(email);
}

export type PortfolioLeadCreateInput = {
  userId: bigint;
  bizcardId: bigint;
  name: string;
  email: string;
  phone: string;
  note?: string | null;
  interest?: string | null;
  visitorId?: string | null;
};

export type PortfolioLeadListFilters = {
  userId: bigint;
  status?: PortfolioLeadStatus | "all";
  search?: string;
  page?: number;
  limit?: number;
  bizcardId?: bigint | null;
};

function serializeLead(row: {
  lead_id: bigint;
  user_id: bigint;
  bizcard_id: bigint;
  visitor_name: string;
  visitor_email: string;
  visitor_phone: string;
  note: string | null;
  interest: string | null;
  status: string;
  contacted_at: Date | null;
  last_contact_channel: string | null;
  owner_notes: string | null;
  created_at: Date;
  updated_at: Date;
  bizcard?: { url_alias: string | null; bizcard_name: string | null } | null;
}) {
  return {
    id: row.lead_id.toString(),
    userId: row.user_id.toString(),
    bizcardId: row.bizcard_id.toString(),
    name: row.visitor_name,
    email: row.visitor_email,
    phone: row.visitor_phone,
    note: row.note,
    interest: row.interest,
    status: row.status,
    contactedAt: row.contacted_at?.toISOString() ?? null,
    lastContactChannel: row.last_contact_channel,
    ownerNotes: row.owner_notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    portfolioAlias: row.bizcard?.url_alias ?? null,
    portfolioName: row.bizcard?.bizcard_name ?? null,
  };
}

export async function findExistingPortfolioLead(opts: {
  bizcardId: bigint;
  email: string;
  visitorId?: string | null;
}) {
  const visitorKey = buildLeadVisitorKey(opts.email);
  const byEmail = await prisma.portfolioLead.findUnique({
    where: {
      bizcard_id_visitor_key: {
        bizcard_id: opts.bizcardId,
        visitor_key: visitorKey,
      },
    },
  });
  if (byEmail) return byEmail;

  const visitorId = opts.visitorId?.trim();
  if (!visitorId) return null;

  return prisma.portfolioLead.findFirst({
    where: {
      bizcard_id: opts.bizcardId,
      visitor_id: visitorId,
    },
  });
}

export async function createPortfolioLead(input: PortfolioLeadCreateInput) {
  const visitorKey = buildLeadVisitorKey(input.email);
  const visitorId = input.visitorId?.trim() || null;

  const existing = await findExistingPortfolioLead({
    bizcardId: input.bizcardId,
    email: input.email,
    visitorId,
  });
  if (existing) {
    return { ok: false as const, reason: "duplicate" as const, lead: existing };
  }

  try {
    const lead = await prisma.portfolioLead.create({
      data: {
        user_id: input.userId,
        bizcard_id: input.bizcardId,
        visitor_name: input.name.trim(),
        visitor_email: normalizeLeadEmail(input.email),
        visitor_phone: input.phone.trim(),
        visitor_key: visitorKey,
        visitor_id: visitorId,
        note: input.note?.trim() || null,
        interest: input.interest?.trim() || null,
        status: "new",
      },
    });
    return { ok: true as const, lead };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const again = await findExistingPortfolioLead({
        bizcardId: input.bizcardId,
        email: input.email,
        visitorId,
      });
      return { ok: false as const, reason: "duplicate" as const, lead: again };
    }
    throw err;
  }
}

export async function listPortfolioLeads(filters: PortfolioLeadListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(Math.max(1, filters.limit ?? 20), 100);
  const skip = (page - 1) * limit;
  const search = filters.search?.trim().slice(0, 100) ?? "";

  const where: Prisma.PortfolioLeadWhereInput = {
    user_id: filters.userId,
    ...(filters.bizcardId ? { bizcard_id: filters.bizcardId } : {}),
    ...(filters.status && filters.status !== "all"
      ? { status: filters.status }
      : {}),
    ...(search
      ? {
          OR: [
            { visitor_name: { contains: search } },
            { visitor_email: { contains: search } },
            { visitor_phone: { contains: search } },
            { note: { contains: search } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.portfolioLead.count({ where }),
    prisma.portfolioLead.findMany({
      where,
      include: {
        bizcard: { select: { url_alias: true, bizcard_name: true } },
      },
      orderBy: [{ created_at: "desc" }, { lead_id: "desc" }],
      skip,
      take: limit,
    }),
  ]);

  return {
    leads: rows.map(serializeLead),
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getPortfolioLeadStats(userId: bigint) {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalLeads,
    newLeads,
    contactedLeads,
    followUpLeads,
    qualifiedLeads,
    leadsToday,
    leadsThisWeek,
    leadsThisMonth,
    recentViews,
  ] = await Promise.all([
    prisma.portfolioLead.count({ where: { user_id: userId } }),
    prisma.portfolioLead.count({ where: { user_id: userId, status: "new" } }),
    prisma.portfolioLead.count({ where: { user_id: userId, status: "contacted" } }),
    prisma.portfolioLead.count({ where: { user_id: userId, status: "follow_up" } }),
    prisma.portfolioLead.count({ where: { user_id: userId, status: "qualified" } }),
    prisma.portfolioLead.count({
      where: { user_id: userId, created_at: { gte: startOfToday } },
    }),
    prisma.portfolioLead.count({
      where: { user_id: userId, created_at: { gte: startOfWeek } },
    }),
    prisma.portfolioLead.count({
      where: { user_id: userId, created_at: { gte: startOfMonth } },
    }),
    prismaAnalytics.portfolioView.count({
      where: {
        portfolio_owner_id: userId,
        created_at: { gte: startOfMonth },
      },
    }),
  ]);

  const conversionRate =
    recentViews > 0 ? Math.round((leadsThisMonth / recentViews) * 1000) / 10 : 0;

  return {
    totalLeads,
    newLeads,
    contactedLeads,
    followUpLeads,
    qualifiedLeads,
    leadsToday,
    leadsThisWeek,
    leadsThisMonth,
    viewsThisMonth: recentViews,
    /** % of portfolio views this month that became leads */
    conversionRate,
    pendingOutreach: newLeads + followUpLeads,
  };
}

export async function updatePortfolioLeadStatus(opts: {
  userId: bigint;
  leadId: bigint;
  status: PortfolioLeadStatus;
  ownerNotes?: string | null;
  contactChannel?: "call" | "email" | "other" | null;
}) {
  const existing = await prisma.portfolioLead.findFirst({
    where: { lead_id: opts.leadId, user_id: opts.userId },
  });
  if (!existing) return null;

  const markingContacted =
    opts.status === "contacted" ||
    opts.status === "follow_up" ||
    opts.status === "qualified" ||
    opts.status === "closed";

  return prisma.portfolioLead.update({
    where: { lead_id: opts.leadId },
    data: {
      status: opts.status,
      owner_notes:
        opts.ownerNotes === undefined
          ? undefined
          : sanitizePortfolioLeadOwnerNotes(opts.ownerNotes),
      contacted_at: markingContacted
        ? existing.contacted_at ?? new Date()
        : opts.status === "new"
          ? null
          : undefined,
      last_contact_channel:
        opts.contactChannel === undefined
          ? undefined
          : opts.contactChannel,
    },
    include: {
      bizcard: { select: { url_alias: true, bizcard_name: true } },
    },
  });
}

export async function buildPortfolioLeadsExcelBuffer(userId: bigint) {
  const rows = await prisma.portfolioLead.findMany({
    where: { user_id: userId },
    include: { bizcard: { select: { url_alias: true, bizcard_name: true } } },
    orderBy: { created_at: "desc" },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OnTap";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Portfolio Leads");

  sheet.columns = [
    { header: "Lead ID", key: "id", width: 12 },
    { header: "Name", key: "name", width: 24 },
    { header: "Email", key: "email", width: 28 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Status", key: "status", width: 14 },
    { header: "Interest", key: "interest", width: 14 },
    { header: "Note", key: "note", width: 36 },
    { header: "Owner notes", key: "ownerNotes", width: 36 },
    { header: "Portfolio", key: "portfolio", width: 22 },
    { header: "Alias", key: "alias", width: 18 },
    { header: "Contacted at", key: "contactedAt", width: 22 },
    { header: "Created at", key: "createdAt", width: 22 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow({
      id: row.lead_id.toString(),
      name: row.visitor_name,
      email: row.visitor_email,
      phone: row.visitor_phone,
      status: PORTFOLIO_LEAD_STATUS_LABELS[row.status as PortfolioLeadStatus] ?? row.status,
      interest: row.interest ?? "",
      note: row.note ?? "",
      ownerNotes: row.owner_notes ?? "",
      portfolio: row.bizcard?.bizcard_name ?? "",
      alias: row.bizcard?.url_alias ?? "",
      contactedAt: row.contacted_at?.toISOString() ?? "",
      createdAt: row.created_at.toISOString(),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export { serializeLead };
