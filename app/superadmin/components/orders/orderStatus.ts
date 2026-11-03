export type OrderStatusLabel =
  | "Pending"
  | "Payment Completed"
  | "Processing"
  | "Completed"
  | "Cancelled";
export type ManagedOrderApiStatus =
  | "pending"
  | "paid"
  | "processed"
  | "completed"
  | "cancelled";
export type SuperAdminOrderColumn = ManagedOrderApiStatus;

export const KANBAN_COLUMNS: Array<{
  key: SuperAdminOrderColumn;
  label: OrderStatusLabel;
}> = [
  { key: "pending", label: "Pending" },
  { key: "paid", label: "Payment Completed" },
  { key: "processed", label: "Processing" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export const STATUS_SUMMARY_CARDS: Array<{
  key: SuperAdminOrderColumn;
  label: string;
  uiStatus: OrderStatusLabel;
}> = [
  { key: "pending", label: "Pending Orders", uiStatus: "Pending" },
  { key: "paid", label: "Payment Completed", uiStatus: "Payment Completed" },
  { key: "processed", label: "Processing", uiStatus: "Processing" },
  { key: "completed", label: "Completed", uiStatus: "Completed" },
  { key: "cancelled", label: "Cancelled", uiStatus: "Cancelled" },
];

export const STATUS_TRANSITIONS: Record<SuperAdminOrderColumn, SuperAdminOrderColumn[]> = {
  pending: ["paid", "processed", "completed", "cancelled"],
  paid: ["processed", "completed", "cancelled"],
  processed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const STATUS_COLUMN_MAP: Record<SuperAdminOrderColumn, string[]> = {
  pending: ["pending", "pending_payment"],
  paid: ["paid"],
  processed: ["processed", "processing", "shipped", "delivered", "in_progress", "in progress"],
  completed: ["completed", "refunded", "done"],
  cancelled: ["cancelled", "canceled", "payment_failed"],
};

export function normalizeOrderToColumn(status: string | null | undefined): SuperAdminOrderColumn {
  const raw = String(status ?? "")
    .trim()
    .toLowerCase();
  for (const [column, statuses] of Object.entries(STATUS_COLUMN_MAP) as Array<
    [SuperAdminOrderColumn, string[]]
  >) {
    if (statuses.includes(raw)) return column;
  }
  return "pending";
}

export function normalizeOrderStatusLabel(value: unknown): OrderStatusLabel {
  const column = normalizeOrderToColumn(String(value ?? ""));
  if (column === "paid") return "Payment Completed";
  if (column === "processed") return "Processing";
  if (column === "completed") return "Completed";
  if (column === "cancelled") return "Cancelled";
  return "Pending";
}

export function labelToApiStatus(label: OrderStatusLabel): ManagedOrderApiStatus {
  if (label === "Payment Completed") return "paid";
  if (label === "Processing") return "processed";
  if (label === "Completed") return "completed";
  if (label === "Cancelled") return "cancelled";
  return "pending";
}

export function apiStatusToLabel(status: ManagedOrderApiStatus): OrderStatusLabel {
  if (status === "paid") return "Payment Completed";
  if (status === "processed") return "Processing";
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

export function canTransitionStatus(
  from: SuperAdminOrderColumn,
  to: SuperAdminOrderColumn,
): boolean {
  if (from === to) return false;
  return STATUS_TRANSITIONS[from].includes(to);
}

export function statusBadgeClass(status: OrderStatusLabel): string {
  if (status === "Pending") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "Payment Completed") return "border-teal-200 bg-teal-50 text-teal-700";
  if (status === "Processing") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "Completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

export const COLUMN_SCROLLBAR_CLASS =
  "overflow-y-auto [scrollbar-color:rgba(71,133,184,0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#4785B8]";

export const BOARD_SCROLLBAR_CLASS =
  "overflow-x-auto [scrollbar-color:rgba(71,133,184,0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#4785B8]";
