"use client";

import { Clock, MapPin, CheckCircle2, UserCheck } from "lucide-react";
import { format, parseISO } from "date-fns";

export type CalendarAppointmentCardEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  place: string | null;
  publicity: string;
  isOwner: boolean;
  viewerIsGoing: boolean;
  goingCount: number;
  ownerName: string;
};

type CalendarAppointmentCardProps = {
  event: CalendarAppointmentCardEvent;
  publicityLabel: string;
  onClick: () => void;
};

function accentColor(event: CalendarAppointmentCardEvent): string {
  if (event.isOwner) return "bg-[#2A4792]";
  if (event.viewerIsGoing) return "bg-emerald-500";
  return "bg-[#4785B8]";
}

export function CalendarAppointmentCard({
  event,
  publicityLabel,
  onClick,
}: CalendarAppointmentCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-xl border border-gray-100 bg-white p-4 pl-5 text-left shadow-[0_4px_14px_rgba(15,23,42,0.04)] transition-all hover:border-[#A8B8D9] hover:shadow-[0_8px_20px_rgba(42,71,146,0.08)]"
    >
      <span
        className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${accentColor(event)}`}
        aria-hidden
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-gray-900 group-hover:text-[#2A4792]">
            {event.title}
          </p>
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-[#F7F9FD] px-2 py-1 text-xs font-medium text-[#2A4792]">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {format(parseISO(event.startsAt), "h:mm a")}
            {event.endsAt && ` – ${format(parseISO(event.endsAt), "h:mm a")}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-full bg-[#EEF2FA] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#2A4792]">
            {publicityLabel}
          </span>
          {event.viewerIsGoing && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              Going
            </span>
          )}
          {event.isOwner && event.goingCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500">
              <UserCheck className="h-3 w-3" />
              {event.goingCount} going
            </span>
          )}
        </div>
      </div>

      {event.place && (
        <p className="mt-2 flex items-center gap-1 text-xs text-gray-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{event.place}</span>
        </p>
      )}

      {!event.isOwner && (
        <p className="mt-2 text-[11px] text-gray-400">Hosted by {event.ownerName}</p>
      )}
    </button>
  );
}
