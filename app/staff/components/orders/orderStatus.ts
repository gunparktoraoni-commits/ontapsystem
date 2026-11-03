export type StaffOrderColumn =
  | "pending"
  | "processed"
  | "ready_for_pickup"
  | "completed"
  | "cancelled";

export const KANBAN_COLUMNS: Array<{
  key: StaffOrderColumn;
  label: string;
}> = [
  { key: "pending", label: "New Orders" },
  { key: "processed", label: "Processed Orders" },
  { key: "ready_for_pickup", label: "Ready for Pickup" },
  { key: "completed", label: "Completed Orders" },
];

export const STATUS_FILTER_CARDS: Array<{
  key: StaffOrderColumn;
  label: string;
}> = [
  { key: "pending", label: "New Orders" },
  { key: "processed", label: "Processed Orders" },
  { key: "ready_for_pickup", label: "Ready for Pickup" },
  { key: "completed", label: "Completed Orders" },
  { key: "cancelled", label: "Cancelled Orders" },
];

const STATUS_COLUMN_MAP: Record<StaffOrderColumn, string[]> = {
  // "paid" ("Payment Completed") orders are awaiting fulfillment, so they surface
  // to staff as actionable New Orders alongside unpaid pending ones.
  pending: ["pending", "pending_payment", "paid"],
  processed: ["processed", "processing", "shipped"],
  ready_for_pickup: ["ready_for_pickup"],
  completed: ["completed", "delivered", "refunded"],
  cancelled: ["cancelled", "payment_failed", "canceled"],
};

export function normalizeOrderToColumn(status: string): StaffOrderColumn {
  for (const [column, statuses] of Object.entries(STATUS_COLUMN_MAP) as Array<
    [StaffOrderColumn, string[]]
  >) {
    if (statuses.includes(status)) return column;
  }
  return "pending";
}

export function formatStatusLabel(status: string): string {
  return normalizeOrderToColumn(status)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const COLUMN_SCROLLBAR_CLASS =
  "overflow-y-auto [scrollbar-color:rgba(71,133,184,0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#4785B8]";

export const BOARD_SCROLLBAR_CLASS =
  "overflow-x-auto [scrollbar-color:rgba(71,133,184,0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#4785B8]";
