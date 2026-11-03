import { prisma } from "@/server/lib/prisma";

export async function resolveInquiryAssignee(
  senderUserId: bigint | null
): Promise<bigint | null> {
  try {
    // For existing client-staff relationship
    if (senderUserId) {
      const assignment = await prisma.staffClientAssignment.findFirst({
        where: {
          client_user_id: senderUserId,
          is_active: true,
        },
        select: { staff_id: true },
      });
      if (assignment) return assignment.staff_id;
    }

    // Option 1: Try with include (more reliable than nested select)
    const staffWithAssignments = await prisma.user.findMany({
      where: {
        role: "staff",
        is_active: true,
        is_restricted: false,
        staffProfile: { is_active: true },
      },
      include: {
        staffClientAssignmentsStaff: {
          where: { is_active: true },
        },
      },
    });

    if (staffWithAssignments.length === 0) return null;

    // Calculate loads safely (handle potentially empty arrays)
    let minLoad = Number.MAX_SAFE_INTEGER;
    let bestStaffId: bigint | null = null;

    for (const staffMember of staffWithAssignments) {
      // Safely access assignments array (default to empty array if undefined)
      const assignments = staffMember.staffClientAssignmentsStaff || [];
      const load = assignments.length;
      
      if (load < minLoad) {
        minLoad = load;
        bestStaffId = staffMember.user_id;
      }
    }

    return bestStaffId;
  } catch (error) {
    console.error("[StaffAssignment] Error:", error);
    
    // Ultimate fallback - simple query without relation
    try {
      const fallbackStaff = await prisma.user.findFirst({
        where: {
          role: "staff",
          is_active: true,
          is_restricted: false,
        },
        select: { user_id: true },
        orderBy: { user_id: "asc" },
      });
      return fallbackStaff?.user_id ?? null;
    } catch {
      return null;
    }
  }
}