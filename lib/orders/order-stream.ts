type OrderStreamListener = (payload: unknown) => void;

const globalListeners = new Set<OrderStreamListener>();
const listenersByOrderKey = new Map<string, Set<OrderStreamListener>>();

function normalizeOrderKey(value: string): string {
  return value.trim().toLowerCase();
}

function subscribeOrderKey(orderKey: string, listener: OrderStreamListener): () => void {
  const normalized = normalizeOrderKey(orderKey);
  const listeners = listenersByOrderKey.get(normalized) ?? new Set<OrderStreamListener>();
  listeners.add(listener);
  listenersByOrderKey.set(normalized, listeners);

  return () => {
    const current = listenersByOrderKey.get(normalized);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listenersByOrderKey.delete(normalized);
    }
  };
}

export function subscribeOrderStream(
  listener: OrderStreamListener,
  options?: { orderId?: string; orderNumber?: string }
): () => void {
  const unsubscribers: Array<() => void> = [];

  globalListeners.add(listener);
  unsubscribers.push(() => {
    globalListeners.delete(listener);
  });

  if (options?.orderId) {
    unsubscribers.push(subscribeOrderKey(`id:${options.orderId}`, listener));
  }

  if (options?.orderNumber) {
    unsubscribers.push(subscribeOrderKey(`no:${options.orderNumber}`, listener));
  }

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

export function publishOrderStreamEvent(payload: {
  orderId: string;
  orderNumber: string;
  status: string;
  previousStatus?: string | null;
  changedBy?: string | null;
  changedAt: string;
  metadata?: Record<string, unknown>;
}): void {
  for (const listener of globalListeners) {
    listener(payload);
  }

  const directKeys = [
    normalizeOrderKey(`id:${payload.orderId}`),
    normalizeOrderKey(`no:${payload.orderNumber}`),
  ];

  for (const key of directKeys) {
    const listeners = listenersByOrderKey.get(key);
    if (!listeners) continue;

    for (const listener of listeners) {
      listener(payload);
    }
  }
}
