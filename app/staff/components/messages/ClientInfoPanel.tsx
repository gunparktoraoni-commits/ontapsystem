"use client";

import { useState } from "react";
import { File, Image, X } from "lucide-react";
import { ModalPortal } from "@/app/components/ModalPortal";
import type { SupportClientInfo, SupportMessage } from "@/app/lib/supportMessaging";
import ClientAvatar from "./ClientAvatar";
import { collectAttachments } from "./messagesUtils";

type InfoTab = "media" | "files";

export default function ClientInfoPanel({
  open,
  onClose,
  client,
  messages,
}: {
  open: boolean;
  onClose: () => void;
  client?: SupportClientInfo;
  messages: SupportMessage[];
}) {
  const [tab, setTab] = useState<InfoTab>("media");
  const name = client?.name ?? "Client";
  const attachments = collectAttachments(messages);
  const mediaItems = attachments.filter((a) => a.mediaKind === "image");
  const fileItems = attachments.filter((a) => a.mediaKind === "video" || a.fileName);

  return (
    <ModalPortal isOpen={open} onClose={onClose}>
      <aside
        className="h-screen w-full max-w-sm bg-white shadow-2xl rounded-l-3xl overflow-hidden flex flex-col"
        aria-label="Client info panel"
      >
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex items-center justify-end p-4 border-b border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
              aria-label="Close info panel"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-8">
            <div className="flex flex-col items-center text-center">
              <ClientAvatar name={name} profileUrl={client?.profileUrl} size="xl" />
              <h3 className="mt-4 text-lg font-bold text-gray-900">{name}</h3>
              {client?.companyName && (
                <p className="mt-1 text-sm text-gray-500">{client.companyName}</p>
              )}
              {client?.jobPosition && (
                <p className="text-sm text-gray-400">{client.jobPosition}</p>
              )}
            </div>

            <div className="mt-8 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-semibold text-gray-900">Phone</p>
                <p className="mt-1 text-gray-500 break-all">
                  {client?.phone || "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-900">Email</p>
                <p className="mt-1 text-gray-500 break-all">
                  {client?.email || "—"}
                </p>
              </div>
            </div>

            <div className="mt-8 flex items-center justify-center gap-4 border-b border-gray-200 pb-3">
              <button
                type="button"
                onClick={() => setTab("media")}
                className={`p-2 rounded-lg pb-1 ${
                  tab === "media"
                    ? "text-[#2A4792] border-b-2 border-[#2A4792]"
                    : "text-gray-500 hover:text-gray-700"
                }`}
                aria-label="Media"
              >
                <Image className="h-5 w-5" />
              </button>
              <span className="text-gray-300">|</span>
              <button
                type="button"
                onClick={() => setTab("files")}
                className={`p-2 rounded-lg pb-1 ${
                  tab === "files"
                    ? "text-[#2A4792] border-b-2 border-[#2A4792]"
                    : "text-gray-500 hover:text-gray-700"
                }`}
                aria-label="Files"
              >
                <File className="h-5 w-5" />
              </button>
            </div>

            {tab === "media" ? (
              mediaItems.length === 0 ? (
                <p className="mt-6 text-center text-sm text-gray-400">No shared media yet.</p>
              ) : (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {mediaItems.map((item) => (
                    <a
                      key={item.id}
                      href={item.mediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="aspect-square rounded-xl overflow-hidden bg-[#C5D4F5]"
                    >
                      <img
                        src={item.mediaUrl}
                        alt={item.fileName ?? "media"}
                        className="h-full w-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              )
            ) : fileItems.length === 0 ? (
              <p className="mt-6 text-center text-sm text-gray-400">No shared files yet.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {fileItems.map((item) => (
                  <li key={item.id}>
                    <a
                      href={item.mediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={item.fileName ?? undefined}
                      className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm text-[#2A4792] hover:bg-gray-100"
                    >
                      <span className="truncate flex-1">
                        {item.fileName ?? (item.mediaKind === "video" ? "Video" : "File")}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </ModalPortal>
  );
}
