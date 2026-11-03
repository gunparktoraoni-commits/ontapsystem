import { createApiHandler } from "@/lib/api-handler";
import { getMetricsSummary } from "@/middleware/performance";

export const GET = createApiHandler({
  requireAuth: true,
  requireRole: ["admin", "super_admin"],
  handler: async () => {
    const metrics = await getMetricsSummary();
    return {
      success: true,
      data: metrics,
    };
  },
});
