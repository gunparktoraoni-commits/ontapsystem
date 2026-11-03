"use client";

import { use } from "react";
import ClientConversation from "../../components/messages/ClientConversation";

export default function StaffConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = use(params);
  return <ClientConversation conversationId={conversationId} />;
}
