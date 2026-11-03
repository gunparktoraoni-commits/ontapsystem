"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  addMonths,
  subMonths,
  parseISO,
  startOfDay,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Lock,
  MapPin,
  Plus,
  Trash2,
  Users,
  Building2,
  Pencil,
  CheckCircle2,
  UserCheck,
  CalendarPlus,
} from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { getFrontendApiBaseUrl } from "./apiBase";
import { hasActivePremiumPlan } from "./subscriptionAccess";
import { withImpersonationHeaders } from "../lib/superadminImpersonationHandoff";
import CalendarPremiumGate from "./calendar/CalendarPremiumGate";
import { CalendarDayIndicators } from "./calendar/CalendarDayIndicators";
import { CalendarAppointmentCard } from "./calendar/CalendarAppointmentCard";
import {
  filterEndTimeOptions,
  filterStartTimeOptions,
  formatTimeLabel,
  generateTimeOptions,
  isPastCalendarDay,
  minSelectableDate,
} from "@/lib/calendar/calendar-utils";
import { PortalPageHeader } from "@/app/superadmin/components/ui/PortalPageHeader";
import { PortalPanel } from "@/app/superadmin/components/ui/PortalPanel";
import { PortalModal } from "@/app/superadmin/components/ui/PortalModal";
import { SectionLoader } from "./Loader";
import { showToast } from "./Toast";
import { showConfirmDialog } from "./ConfirmDialog";

type Publicity = "private" | "public" | "custom" | "company";

type CalendarEventItem = {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  description: string | null;
  place: string | null;
  company: string | null;
  startsAt: string;
  endsAt: string | null;
  publicity: Publicity;
  isOwner: boolean;
  viewerIsGoing: boolean;
  goingCount: number;
  invitees: { id: string; name: string }[];
  attendees: { id: string; name: string; goingAt: string }[];
};

type AssociateOption = {
  id: string;
  name: string;
  company: string;
};

type EventFormState = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  place: string;
  description: string;
  publicity: Publicity;
  inviteeIds: string[];
};

const EMPTY_FORM: EventFormState = {
  title: "",
  date: format(new Date(), "yyyy-MM-dd"),
  startTime: "09:00",
  endTime: "",
  place: "",
  description: "",
  publicity: "public",
  inviteeIds: [],
};

const BASE_PUBLICITY_OPTIONS: {
  value: Publicity;
  label: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "private",
    label: "Private",
    hint: "Only you can see this appointment. Associates are not notified.",
    icon: <Lock className="h-4 w-4" />,
  },
  {
    value: "public",
    label: "Associates",
    hint: "Accepted associates are notified and can attend from their portal.",
    icon: <Globe className="h-4 w-4" />,
  },
  {
    value: "custom",
    label: "Custom",
    hint: "Only the associates you pick below are notified and can attend.",
    icon: <Users className="h-4 w-4" />,
  },
];

const COMPANY_PUBLICITY_OPTION = {
  value: "company" as const,
  label: "Company",
  hint: "Everyone in your company can see this on their calendar.",
  icon: <Building2 className="h-4 w-4" />,
};

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.2, 0, 0, 1] as const } },
};

function combineDateTime(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  return local.toISOString();
}

function publicityLabel(value: Publicity): string {
  if (value === "company") return COMPANY_PUBLICITY_OPTION.label;
  return BASE_PUBLICITY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

const TIME_OPTIONS = generateTimeOptions(15);

function getInitials(name: string): string {
  const safe = name.trim();
  if (!safe) return "?";
  return safe
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function CalendarUser() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isUserPortal = pathname?.startsWith("/user/calendar") ?? false;
  const [premiumReady, setPremiumReady] = useState(!isUserPortal);
  const [isPremium, setIsPremium] = useState(!isUserPortal);
  const [isFreeTrial, setIsFreeTrial] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [associates, setAssociates] = useState<AssociateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attendingId, setAttendingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EventFormState>(EMPTY_FORM);
  const [detailEvent, setDetailEvent] = useState<CalendarEventItem | null>(null);
  const [isCompanyAdmin, setIsCompanyAdmin] = useState(false);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const publicityOptions = useMemo(
    () =>
      isCompanyAdmin
        ? [...BASE_PUBLICITY_OPTIONS, COMPANY_PUBLICITY_OPTION]
        : BASE_PUBLICITY_OPTIONS,
    [isCompanyAdmin],
  );

  const today = useMemo(() => new Date(), []);
  const isSelectedDayPast = isPastCalendarDay(selectedDay, today);
  const startTimeOptions = useMemo(
    () => filterStartTimeOptions(form.date, TIME_OPTIONS, today),
    [form.date, today],
  );
  const endTimeOptions = useMemo(
    () => filterEndTimeOptions(form.date, form.startTime, TIME_OPTIONS, today),
    [form.date, form.startTime, today],
  );

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = (monthStart.getDay() + 6) % 7;

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const event of events) {
      const key = format(parseISO(event.startsAt), "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const selectedDayEvents = useMemo(() => {
    const key = format(selectedDay, "yyyy-MM-dd");
    return eventsByDay.get(key) ?? [];
  }, [eventsByDay, selectedDay]);

  useEffect(() => {
    if (!isUserPortal) {
      setPremiumReady(true);
      setIsPremium(true);
      return;
    }

    let cancelled = false;
    const loadPremium = async () => {
      try {
        const res = await fetch(`${getFrontendApiBaseUrl()}/api/user/subscription`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: withImpersonationHeaders(),
        });
        if (!res.ok) {
          if (!cancelled) {
            setIsPremium(false);
            setIsFreeTrial(false);
          }
          return;
        }
        const payload = await res.json().catch(() => null);
        const sub =
          payload?.data && typeof payload.data === "object"
            ? (payload.data as Record<string, unknown>)
            : null;
        if (!cancelled) {
          const accessReason =
            sub?.access_reason != null ? String(sub.access_reason) : null;
          setIsFreeTrial(
            accessReason === "free_trial" || Boolean(sub?.is_trial),
          );
          setIsPremium(
            hasActivePremiumPlan({
              tier: sub?.tier != null ? String(sub.tier) : null,
              accessReason,
              isTrial: Boolean(sub?.is_trial),
              status: sub?.status != null ? String(sub.status) : null,
              isExpired: Boolean(sub?.is_expired),
            }),
          );
        }
      } catch {
        if (!cancelled) {
          setIsPremium(false);
          setIsFreeTrial(false);
        }
      } finally {
        if (!cancelled) setPremiumReady(true);
      }
    };

    void loadPremium();
    const onSync = () => void loadPremium();
    window.addEventListener("ontap:user-sync", onSync);
    return () => {
      cancelled = true;
      window.removeEventListener("ontap:user-sync", onSync);
    };
  }, [isUserPortal]);

  useEffect(() => {
    if (!premiumReady || !isPremium) {
      setIsCompanyAdmin(false);
      return;
    }

    let cancelled = false;
    const loadCompanyAccess = async () => {
      try {
        const res = await apiFetch("/api/company/my-company");
        const payload = await res.json().catch(() => null);
        const data =
          payload?.data && typeof payload.data === "object"
            ? (payload.data as Record<string, unknown>)
            : payload;
        const role = String(data?.my_role ?? "").trim().toLowerCase();
        if (!cancelled) {
          setIsCompanyAdmin(role === "admin" || role === "manager");
        }
      } catch {
        if (!cancelled) setIsCompanyAdmin(false);
      }
    };

    void loadCompanyAccess();
    return () => {
      cancelled = true;
    };
  }, [premiumReady, isPremium]);

  useEffect(() => {
    if (!isCompanyAdmin && form.publicity === "company") {
      setForm((current) => ({ ...current, publicity: "public" }));
    }
  }, [isCompanyAdmin, form.publicity]);

  const loadAssociates = useCallback(async () => {
    try {
      const res = await apiFetch("/api/connections/list?limit=100&sort_by=name");
      const data = await res.json();
      if (!data?.success) return;
      const connections = (data.connections ?? []) as Array<{
        id: string;
        name: string;
        business_name?: string | null;
      }>;
      setAssociates(
        connections.map((c) => ({
          id: String(c.id),
          name: c.name,
          company: c.business_name ?? "",
        })),
      );
    } catch {
      /* non-blocking */
    }
  }, []);

  const loadEvents = useCallback(async () => {
    if (isUserPortal && !isPremium) return;
    setLoading(true);
    try {
      const rangeStart = startOfMonth(month);
      const rangeEnd = endOfMonth(month);
      const params = new URLSearchParams({
        start: rangeStart.toISOString(),
        end: rangeEnd.toISOString(),
      });
      const res = await apiFetch(`/api/calendar/events?${params}`);
      const data = await res.json();
      if (data?.success) {
        setEvents(data.data.events ?? []);
      } else {
        showToast(data?.error ?? "Could not load calendar.", "error");
      }
    } catch {
      showToast("Could not load calendar.", "error");
    } finally {
      setLoading(false);
    }
  }, [month, isUserPortal, isPremium]);

  useEffect(() => {
    if (!premiumReady) return;
    if (isUserPortal && !isPremium) return;
    void loadEvents();
  }, [loadEvents, premiumReady, isUserPortal, isPremium]);

  useEffect(() => {
    if (!premiumReady) return;
    if (isUserPortal && !isPremium) return;
    void loadAssociates();
  }, [loadAssociates, premiumReady, isUserPortal, isPremium]);

  const openEventById = useCallback(async (eventId: string) => {
    const existing = eventsRef.current.find((event) => event.id === eventId);
    if (existing) {
      setSelectedDay(startOfDay(parseISO(existing.startsAt)));
      setDetailEvent(existing);
      return;
    }

    try {
      const res = await apiFetch(`/api/calendar/events/${eventId}`);
      const data = await res.json();
      if (data?.success && data.data?.event) {
        const event = data.data.event as CalendarEventItem;
        setSelectedDay(startOfDay(parseISO(event.startsAt)));
        setMonth(startOfMonth(parseISO(event.startsAt)));
        setDetailEvent(event);
        setEvents((prev) => {
          if (prev.some((item) => item.id === event.id)) {
            return prev.map((item) => (item.id === event.id ? event : item));
          }
          return [...prev, event];
        });
      } else {
        showToast("Could not open that appointment.", "error");
      }
    } catch {
      showToast("Could not open that appointment.", "error");
    }
  }, []);

  useEffect(() => {
    const eventId = searchParams.get("event");
    if (!eventId || loading) return;
    void openEventById(eventId);
  }, [searchParams, openEventById, loading]);

  function openCreateModal() {
    if (isSelectedDayPast) {
      showToast("You can only schedule appointments on today or future dates.", "error");
      return;
    }
    const defaultStart = startTimeOptions[0];
    if (!defaultStart) {
      showToast("No available times left today. Pick a future date.", "error");
      return;
    }
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      date: format(selectedDay, "yyyy-MM-dd"),
      startTime: defaultStart,
      endTime: "",
    });
    setModalOpen(true);
  }

  function openEditModal(event: CalendarEventItem) {
    if (!event.isOwner) return;
    const start = parseISO(event.startsAt);
    setEditingId(event.id);
    setForm({
      title: event.title,
      date: format(start, "yyyy-MM-dd"),
      startTime: format(start, "HH:mm"),
      endTime: event.endsAt ? format(parseISO(event.endsAt), "HH:mm") : "",
      place: event.place ?? "",
      description: event.description ?? "",
      publicity: event.publicity,
      inviteeIds: event.invitees.map((i) => i.id),
    });
    setModalOpen(true);
    setDetailEvent(null);
  }

  async function handleSave() {
    if (!form.title.trim()) {
      showToast("Please enter a title for your appointment.", "error");
      return;
    }
    if (isPastCalendarDay(parseISO(`${form.date}T12:00:00`))) {
      showToast("You cannot schedule appointments on past dates.", "error");
      return;
    }
    if (!startTimeOptions.includes(form.startTime)) {
      showToast("Pick a start time that has not already passed.", "error");
      return;
    }
    if (form.endTime && !endTimeOptions.includes(form.endTime)) {
      showToast("End time must be after the start time and still in the future.", "error");
      return;
    }
    if (form.publicity === "custom" && form.inviteeIds.length === 0) {
      showToast("Pick at least one associate for a custom event.", "error");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        startsAt: combineDateTime(form.date, form.startTime),
        endsAt: form.endTime ? combineDateTime(form.date, form.endTime) : null,
        place: form.place.trim() || null,
        description: form.description.trim() || null,
        publicity: form.publicity,
        inviteeUserIds: form.publicity === "custom" ? form.inviteeIds : [],
      };

      const res = await apiFetch(
        editingId ? `/api/calendar/events/${editingId}` : "/api/calendar/events",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!data?.success) {
        showToast(data?.error ?? "Could not save appointment.", "error");
        return;
      }

      showToast(
        editingId
          ? "Appointment updated."
          : form.publicity === "private"
            ? "Appointment created."
            : "Appointment created. Associates have been notified.",
        "success",
      );
      setModalOpen(false);
      setEditingId(null);
      await loadEvents();
    } catch {
      showToast("Could not save appointment.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleAttend(event: CalendarEventItem) {
    if (event.isOwner || event.viewerIsGoing) return;
    setAttendingId(event.id);
    try {
      const res = await apiFetch(`/api/calendar/events/${event.id}/attend`, { method: "POST" });
      const data = await res.json();
      if (!data?.success) {
        showToast(data?.error ?? "Could not add this event to your calendar.", "error");
        return;
      }
      const updated = data.data.event as CalendarEventItem;
      setEvents((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setDetailEvent(updated);
      showToast("You're attending. The host has been notified.", "success");
    } catch {
      showToast("Could not add this event to your calendar.", "error");
    } finally {
      setAttendingId(null);
    }
  }

  function clearEventQuery() {
    const params = new URLSearchParams(searchParams.toString());
    if (!params.has("event")) return;
    params.delete("event");
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  async function handleDelete(event: CalendarEventItem) {
    if (!event.isOwner) return;
    const confirmed = await showConfirmDialog({
      title: "Delete appointment?",
      message: `"${event.title}" will be removed from your calendar. This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    try {
      const res = await apiFetch(`/api/calendar/events/${event.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data?.success) {
        showToast(data?.error ?? "Could not delete appointment.", "error");
        return;
      }
      showToast("Appointment deleted.", "success");
      setDetailEvent(null);
      await loadEvents();
    } catch {
      showToast("Could not delete appointment.", "error");
    }
  }

  function toggleInvitee(id: string) {
    setForm((prev) => ({
      ...prev,
      inviteeIds: prev.inviteeIds.includes(id)
        ? prev.inviteeIds.filter((x) => x !== id)
        : [...prev.inviteeIds, id],
    }));
  }

  if (isUserPortal && !premiumReady) {
    return (
      <div className="w-full min-h-full rounded-2xl border border-[#d8deee] bg-white p-4 sm:p-6 lg:p-7 shadow-sm">
        <SectionLoader text="Loading calendar..." />
      </div>
    );
  }

  if (isUserPortal && !isPremium) {
    return <CalendarPremiumGate isFreeTrial={isFreeTrial} />;
  }

  return (
    <motion.div
      className="w-full space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={itemVariants}>
        <PortalPageHeader
          title="Calendar"
          subtitle="Plan meetings, visits, and reminders. Associates get notified when you share an event — they can add it to their own calendar with one tap."
          actions={
            <button
              type="button"
              onClick={openCreateModal}
              disabled={isSelectedDayPast}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2A4792] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_6px_16px_rgba(42,71,146,0.28)] transition-all hover:bg-[#3B569F] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {isSelectedDayPast ? "Past date" : "New appointment"}
            </button>
          }
        />
      </motion.div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <motion.div variants={itemVariants}>
          <PortalPanel className="p-5 sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#4785B8]">
                  Month view
                </p>
                <h2 className="mt-1 text-lg font-bold text-gray-950">
                  {format(month, "MMMM yyyy")}
                </h2>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setMonth((m) => subMonths(m, 1))}
                  className="rounded-lg border border-gray-200 p-1.5 text-gray-500 transition-all hover:border-[#A8B8D9] hover:bg-[#EEF2FA] hover:text-[#2A4792] active:scale-95"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setMonth((m) => addMonths(m, 1))}
                  className="rounded-lg border border-gray-200 p-1.5 text-gray-500 transition-all hover:border-[#A8B8D9] hover:bg-[#EEF2FA] hover:text-[#2A4792] active:scale-95"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wide text-gray-400">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>

            {loading ? (
              <SectionLoader text="Loading calendar…" />
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: startPad }).map((_, i) => (
                  <div key={`pad-${i}`} className="aspect-square" />
                ))}
                {calendarDays.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const dayEvents = eventsByDay.get(key) ?? [];
                  const selected = isSameDay(day, selectedDay);
                  const inMonth = isSameMonth(day, month);
                  const isPast = isPastCalendarDay(day, today);
                  const hasEvents = dayEvents.length > 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      className={`relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition-all ${
                        selected
                          ? "bg-[#2A4792] font-bold text-white shadow-[0_6px_14px_rgba(42,71,146,0.28)] scale-105"
                          : isPast
                            ? hasEvents
                              ? "font-medium text-gray-400 bg-gray-50/80 hover:bg-gray-50"
                              : "font-medium text-gray-300 hover:bg-gray-50"
                            : inMonth
                              ? hasEvents
                                ? "font-semibold text-[#2A4792] bg-[#EEF2FA]/70 hover:bg-[#EEF2FA]"
                                : "font-medium text-gray-700 hover:bg-[#EEF2FA] hover:text-[#2A4792]"
                              : hasEvents
                                ? "text-gray-400 bg-gray-50/50"
                                : "text-gray-300"
                      }`}
                    >
                      {format(day, "d")}
                      <CalendarDayIndicators
                        events={dayEvents}
                        selected={selected}
                      />
                    </button>
                  );
                })}
              </div>
            )}

            <p className="mt-4 text-xs text-gray-500">
              Colored dots mark days with appointments — blue for yours, green when you&apos;re going, light blue for shared events. Past dates are view-only.
            </p>
          </PortalPanel>
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-4">
          <PortalPanel className="p-5 sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#4785B8]">
                  Selected day
                </p>
                <h2 className="mt-1 text-lg font-bold text-gray-950">
                  {format(selectedDay, "EEEE, MMM d")}
                </h2>
                {selectedDayEvents.length > 0 && (
                  <p className="mt-1 text-xs font-medium text-[#2A4792]">
                    {selectedDayEvents.length} appointment
                    {selectedDayEvents.length === 1 ? "" : "s"} scheduled
                  </p>
                )}
              </div>
              <CalendarDays className="h-5 w-5 shrink-0 text-[#4785B8]" />
            </div>

            <AnimatePresence mode="popLayout">
              {selectedDayEvents.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-4 py-8 text-center"
                >
                  <p className="text-sm font-semibold text-gray-800">No appointments yet</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {isSelectedDayPast
                      ? "This day has passed. Pick a future date to schedule something new."
                      : 'Tap "New appointment" to schedule something for this day.'}
                  </p>
                  {!isSelectedDayPast && (
                    <button
                      type="button"
                      onClick={openCreateModal}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[#2A4792]/20 bg-white px-3 py-2 text-xs font-semibold text-[#2A4792] transition-colors hover:bg-[#EEF2FA]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add for this day
                    </button>
                  )}
                </motion.div>
              ) : (
                <ul className="space-y-3">
                  {selectedDayEvents.map((event) => (
                    <motion.li
                      key={event.id}
                      layout
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                    >
                      <CalendarAppointmentCard
                        event={event}
                        publicityLabel={publicityLabel(event.publicity)}
                        onClick={() => setDetailEvent(event)}
                      />
                    </motion.li>
                  ))}
                </ul>
              )}
            </AnimatePresence>
          </PortalPanel>

        </motion.div>
      </div>

      <PortalModal
        open={Boolean(detailEvent)}
        onClose={() => {
          if (attendingId) return;
          setDetailEvent(null);
          clearEventQuery();
        }}
        title={detailEvent?.title ?? "Event"}
        description={
          detailEvent
            ? `${publicityLabel(detailEvent.publicity)} · ${
                detailEvent.isOwner ? "You created this" : `By ${detailEvent.ownerName}`
              }`
            : undefined
        }
        size="md"
        preventClose={Boolean(attendingId)}
        footer={
          detailEvent ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {detailEvent.isOwner && (
                <>
                  <button
                    type="button"
                    onClick={() => openEditModal(detailEvent)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(detailEvent)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={Boolean(attendingId)}
                onClick={() => {
                  setDetailEvent(null);
                  clearEventQuery();
                }}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Close
              </button>
              {!detailEvent.isOwner &&
                (detailEvent.viewerIsGoing ? (
                  <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    Attending
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={
                      attendingId === detailEvent.id ||
                      parseISO(detailEvent.startsAt).getTime() < Date.now()
                    }
                    onClick={() => void handleAttend(detailEvent)}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#2A4792] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3B569F] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CalendarPlus className="h-4 w-4" />
                    {attendingId === detailEvent.id ? "Saving…" : "Attending"}
                  </button>
                ))}
            </div>
          ) : null
        }
      >
        {detailEvent && (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">When</dt>
              <dd className="mt-0.5 text-gray-800">
                {format(parseISO(detailEvent.startsAt), "PPP 'at' h:mm a")}
                {detailEvent.endsAt && ` – ${format(parseISO(detailEvent.endsAt), "h:mm a")}`}
              </dd>
            </div>
            {detailEvent.place && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Place</dt>
                <dd className="mt-0.5 text-gray-800">{detailEvent.place}</dd>
              </div>
            )}
            {detailEvent.description && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Description
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-gray-700">{detailEvent.description}</dd>
              </div>
            )}
            {detailEvent.publicity === "company" && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Visibility
                </dt>
                <dd className="mt-0.5 text-gray-800">Shared with your company</dd>
              </div>
            )}
            {detailEvent.publicity === "custom" && detailEvent.invitees.length > 0 && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Invited associates
                </dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {detailEvent.invitees.map((inv) => (
                    <span
                      key={inv.id}
                      className="rounded-full bg-[#EEF2FA] px-2.5 py-1 text-xs font-medium text-[#2A4792]"
                    >
                      {inv.name}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {detailEvent.isOwner && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Who&apos;s going ({detailEvent.goingCount})
                </dt>
                <dd className="mt-2">
                  {detailEvent.attendees.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No one has joined yet. Associates will appear here once they tap
                      &quot;Attending&quot;.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {detailEvent.attendees.map((attendee) => (
                        <li
                          key={attendee.id}
                          className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2"
                        >
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2A4792] text-xs font-bold text-white">
                            {getInitials(attendee.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-gray-900">
                              {attendee.name}
                            </p>
                            <p className="text-[11px] text-gray-500">
                              Confirmed {format(parseISO(attendee.goingAt), "MMM d, h:mm a")}
                            </p>
                          </div>
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            )}
            {!detailEvent.isOwner && detailEvent.viewerIsGoing && (
              <p className="rounded-lg border border-emerald-100 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-800">
                This event is saved on your calendar. The host was notified that you are attending.
              </p>
            )}
          </dl>
        )}
      </PortalModal>

      <PortalModal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editingId ? "Edit appointment" : "New appointment"}
        description="Fill in the details below. You can change who sees this event at any time."
        size="lg"
        preventClose={saving}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setModalOpen(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="rounded-lg bg-[#2A4792] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3B569F] disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Create appointment"}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          <label className="block">
            <span className="text-sm font-semibold text-gray-800">Title *</span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Client visit, team check-in"
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-[#4785B8] focus:ring-2 focus:ring-[#4785B8]/20"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block sm:col-span-1">
              <span className="text-sm font-semibold text-gray-800">Date *</span>
              <input
                type="date"
                value={form.date}
                min={minSelectableDate(today)}
                onChange={(e) => {
                  const nextDate = e.target.value;
                  const nextStartOptions = filterStartTimeOptions(nextDate, TIME_OPTIONS, today);
                  setForm((f) => ({
                    ...f,
                    date: nextDate,
                    startTime: nextStartOptions.includes(f.startTime)
                      ? f.startTime
                      : nextStartOptions[0] ?? f.startTime,
                    endTime: "",
                  }));
                }}
                className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#4785B8] focus:ring-2 focus:ring-[#4785B8]/20"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-gray-800">Start time *</span>
              <select
                value={form.startTime}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    startTime: e.target.value,
                    endTime:
                      f.endTime &&
                      filterEndTimeOptions(f.date, e.target.value, TIME_OPTIONS, today).includes(
                        f.endTime,
                      )
                        ? f.endTime
                        : "",
                  }))
                }
                className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#4785B8] focus:ring-2 focus:ring-[#4785B8]/20"
              >
                {startTimeOptions.map((time) => (
                  <option key={time} value={time}>
                    {formatTimeLabel(time)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-gray-800">End time</span>
              <select
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#4785B8] focus:ring-2 focus:ring-[#4785B8]/20"
              >
                <option value="">No end time</option>
                {endTimeOptions.map((time) => (
                  <option key={time} value={time}>
                    {formatTimeLabel(time)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-gray-800">Place</span>
            <input
              type="text"
              value={form.place}
              onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))}
              placeholder="Address, room, or online meeting link"
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#4785B8] focus:ring-2 focus:ring-[#4785B8]/20"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-gray-800">Description</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="Agenda, notes, or anything attendees should know"
              className="mt-1.5 w-full resize-y rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#4785B8] focus:ring-2 focus:ring-[#4785B8]/20"
            />
          </label>

          <div>
            <span className="text-sm font-semibold text-gray-800">Who can see this?</span>
            <p className="mt-1 text-xs text-gray-500">
              Private is selected by default. Only you see it until you change this.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {publicityOptions.map((option) => {
                const active = form.publicity === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, publicity: option.value }))}
                    className={`rounded-xl border p-3 text-left transition-all ${
                      active
                        ? "border-[#2A4792] bg-[#EEF2FA] shadow-sm"
                        : "border-gray-200 hover:border-[#A8B8D9] hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                      <span className={active ? "text-[#2A4792]" : "text-gray-500"}>
                        {option.icon}
                      </span>
                      {option.label}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-gray-500">{option.hint}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {form.publicity === "custom" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-[#2A4792]" />
                  <span className="text-sm font-semibold text-gray-800">Invite associates</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Only checked associates will see this event on their calendar.
                </p>
                {associates.length === 0 ? (
                  <p className="mt-3 text-xs text-gray-500">
                    You have no accepted associates yet. Add connections on the Associate page first.
                  </p>
                ) : (
                  <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                    {associates.map((assoc) => (
                      <li key={assoc.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 hover:border-gray-200 hover:bg-white">
                          <input
                            type="checkbox"
                            checked={form.inviteeIds.includes(assoc.id)}
                            onChange={() => toggleInvitee(assoc.id)}
                            className="h-4 w-4 rounded border-gray-300 text-[#2A4792]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-gray-900">
                              {assoc.name}
                            </span>
                            {assoc.company && (
                              <span className="flex items-center gap-1 text-[11px] text-gray-500">
                                <Building2 className="h-3 w-3" />
                                {assoc.company}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </PortalModal>
    </motion.div>
  );
}
