"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Phone } from "lucide-react";
import {
SupportEscalationNotice, SupportResolutionNotice,
} from "@/app/components/support/SupportEscalationNotice";
import { SectionLoader, InlineLoader } from "@/app/components/Loader";
import { ModalPortal } from "@/app/components/ModalPortal";
import { useSupportMessaging } from "@/app/hooks/useSupportMessaging";
import type { SupportConversation } from "@/app/lib/supportMessaging";
import ClientAvatar from "./ClientAvatar";
import ClientInfoPanel from "./ClientInfoPanel";
import StaffMessageComposer from "./StaffMessageComposer";
import StaffMessageThread from "./StaffMessageThread";
import { isClientOnline } from "./messagesUtils";

export default function ClientConversation({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [conversationMeta, setConversationMeta] = useState<SupportConversation | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [escalateTarget, setEscalateTarget] = useState<"dev" | "super_admin" | null>(null);
  const [escalating, setEscalating] = useState(false);

  const {
    conversation,
    setConversation,
    messages,
    loading,
    sending,
    error,
    sendMessage,
    escalate,
  } = useSupportMessaging({
    mode: "staff",
    conversationId,
    enabled: !!conversationId,
    pollMs: 5000,
  });

  const loadConversationMeta = useCallback(async () => {
    setMetaError(null);
    try {
      const res = await fetch(`/api/staff/support/conversations/${conversationId}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 404) throw new Error("Conversation not found.");
        throw new Error("Failed to load conversation.");
      }
      const payload = await res.json();
      const data = payload.data as SupportConversation;
      setConversationMeta(data);
      setConversation(data);
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : "Failed to load conversation.");
    } finally {
      setMetaLoading(false);
    }
  }, [conversationId, setConversation]);

  useEffect(() => {
    void loadConversationMeta();
  }, [loadConversationMeta]);

  const activeConversation = conversation ?? conversationMeta;
  const client = activeConversation?.client;
  const clientName = client?.name ?? "Client";
  const online = isClientOnline(client);
  const isClosed =
    activeConversation?.status === "resolved" ||
    activeConversation?.status === "closed";
  const isEscalated = activeConversation?.escalationLevel !== "none";
  const isUnassigned = activeConversation?.isPooled ?? false;

  const handleEscalateRequest = (_messageId: string, target: "dev" | "super_admin") => {
    setEscalateTarget(target);
  };

  const confirmEscalate = async () => {
    if (!escalateTarget) return;
    setEscalating(true);
    try {
      await escalate(escalateTarget);
      await loadConversationMeta();
      setEscalateTarget(null);
    } catch {
      // error shown via hook
    } finally {
      setEscalating(false);
    }
  };

  const handleCall = () => {
    console.log("Call placeholder", client?.id ?? conversationId);
  };

  if (metaLoading) {
    return <SectionLoader text="Loading conversation..." />;
  }

  if (metaError && !activeConversation) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => router.push("/staff/messages")}
          className="inline-flex items-center gap-1 text-sm text-[#2A4792] hover:underline"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to messages
        </button>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {metaError}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[32rem]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.push("/staff/messages")}
            className="shrink-0 rounded-lg p-1.5 text-[#2A4792] hover:bg-white"
            aria-label="Back to messages"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <ClientAvatar name={clientName} profileUrl={client?.profileUrl} size="md" />
          <div className="min-w-0">
            <p className="font-bold text-gray-900 truncate">{clientName}</p>
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  online ? "bg-green-500" : "bg-gray-400"
                }`}
              />
              {online ? "Active Now" : "Offline"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleCall}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-[#2A4792] hover:bg-gray-50"
          >
            <Phone className="h-4 w-4" />
            Call
          </button>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="text-sm font-semibold text-[#2A4792] hover:underline"
          >
            Info
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col min-h-0 rounded-3xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <SupportEscalationNotice conversation={activeConversation} />
        <SupportResolutionNotice conversation={activeConversation} />
        {(error || metaError) && (
          <div className="mx-4 mt-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
            {error ?? metaError}
          </div>
        )}
        {loading && messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
            <InlineLoader />
            <span className="ml-2">Loading messages...</span>
          </div>
        ) : (
          <StaffMessageThread
            messages={messages}
            showEscalateMenu={!isClosed && activeConversation?.escalationLevel === "none"}
            onEscalateUserMessage={handleEscalateRequest}
          />
        )}
        <StaffMessageComposer
          disabled={isClosed || isEscalated || isUnassigned}
          sending={sending}
          onSend={async (body, attachments) => {
            await sendMessage(body, attachments);
            await loadConversationMeta();
          }}
        />
        {isUnassigned && (
          <div className="mx-4 mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
            ⓘ You must click "Assign to Me" in the Messages list before you can reply to this conversation.
          </div>
        )}
      </div>

      <ClientInfoPanel
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        client={client}
        messages={messages}
      />

      {escalateTarget && (
        <ModalPortal isOpen={!!escalateTarget} onClose={() => setEscalateTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h4 className="text-base font-semibold text-gray-900">Confirm escalation</h4>
            <p className="mt-2 text-sm text-gray-600">
              Escalate this conversation to{" "}
              <strong>{escalateTarget === "dev" ? "Dev" : "Super Admin"}</strong>?
              The client will be notified.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEscalateTarget(null)}
                disabled={escalating}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmEscalate()}
                disabled={escalating}
                className="px-4 py-2 text-sm rounded-lg bg-[#2A4792] text-white hover:bg-[#1e3568] disabled:opacity-50"
              >
                {escalating ? "Escalating..." : "Escalate"}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
