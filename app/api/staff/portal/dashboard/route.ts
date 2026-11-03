import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { withStaffPortal, checkStaffPortalRateLimit } from "@/lib/auth/staff-portal-middleware";
import { StaffMarketingService } from "@/lib/services/staff-marketing.service";

export async function GET(req: NextRequest) {
  return withStaffPortal(async (context, request) => {
    const startTime = Date.now();

    await checkStaffPortalRateLimit("staff-portal-dashboard", request, context.requestId);

    const service = new StaffMarketingService(context.staffId, context.requestId);
    const [summary, inquiries, orders, messages, companyGroups] = await Promise.all([
      service.getDashboardSummary(),
      service.getClientInquiries({ page: 1, limit: 5 }),
      service.getClientOrders({ page: 1, limit: 5 }),
      service.getMessagingClients({ page: 1, limit: 8 }),
      prisma.staffClientAssignment.groupBy({
        by: ["company_id"],
        where: {
          staff_id: context.staffId,
          is_active: true,
          company_id: { not: null },
        },
      }),
    ]);

    const responseTime = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      requestId: context.requestId,
      data: {
        stats: {
          clients: summary.total_assigned_clients,
          companies: companyGroups.length,
          unread_messages: summary.unread_messages,
          inquiries: summary.unread_inquiries,
        },
        summary,
        recent_inquiries: inquiries.inquiries,
        recent_orders: orders.orders,
        messages: messages.clients,
      },
      meta: {
        requestId: context.requestId,
        responseTime,
        timestamp: new Date().toISOString(),
      },
    });
  })(req);
}
