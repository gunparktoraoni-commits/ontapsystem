"use client";

type CalendarDayEvent = {
  id: string;
  isOwner?: boolean;
  viewerIsGoing?: boolean;
};

type CalendarDayIndicatorsProps = {
  events: CalendarDayEvent[];
  selected?: boolean;
  maxVisible?: number;
};

function eventIndicatorColor(event: CalendarDayEvent, selected: boolean): string {
  if (selected) {
    if (event.isOwner) return "bg-white";
    if (event.viewerIsGoing) return "bg-emerald-200";
    return "bg-white/80";
  }
  if (event.isOwner) return "bg-[#2A4792]";
  if (event.viewerIsGoing) return "bg-emerald-500";
  return "bg-[#4785B8]";
}

export function CalendarDayIndicators({
  events,
  selected = false,
  maxVisible = 3,
}: CalendarDayIndicatorsProps) {
  if (events.length === 0) return null;

  const visible = events.slice(0, maxVisible);
  const overflow = events.length - visible.length;

  return (
    <span
      className="absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-0.5"
      aria-label={`${events.length} appointment${events.length === 1 ? "" : "s"}`}
    >
      {visible.map((event) => (
        <span
          key={event.id}
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${eventIndicatorColor(event, selected)}`}
        />
      ))}
      {overflow > 0 && (
        <span
          className={`ml-0.5 text-[9px] font-bold leading-none ${
            selected ? "text-white/90" : "text-[#2A4792]"
          }`}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
