"use client";

import type { SupportConversation } from "@/app/lib/supportMessaging";
import { SectionLoader } from "../Loader"; // <-- added import

export function SupportEscalationNotice({ 
  conversation, 
  loading = false 
}: { 
  conversation: SupportConversation | null; 
  loading?: boolean; 
}) {
  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/80 backdrop-blur-sm">
        <SectionLoader text="Loading conversation..." />
      </div>
    );
  }

  if (!conversation || conversation.escalationLevel === "none") return null;
  const label =
    conversation.escalationLevel === "super_admin"
      ? "Super Admin"
      : "Development";
  return (
    <div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      Your concern has been escalated to our <strong>{label}</strong> team. We will update you here once there is progress.
    </div>
  );
}

export function SupportResolutionNotice({ 
  conversation, 
  loading = false 
}: { 
  conversation: SupportConversation | null; 
  loading?: boolean; 
}) {
  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/80 backdrop-blur-sm">
        <SectionLoader text="Loading conversation..." />
      </div>
    );
  }

  if (!conversation || conversation.status !== "resolved") return null;
  return (
    <div className="mx-3 mt-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
      This issue has been marked as fixed{conversation.resolutionNote ? `: ${conversation.resolutionNote}` : "."}
    </div>
  );
}