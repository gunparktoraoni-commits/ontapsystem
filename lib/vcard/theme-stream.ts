type StreamListener = (payload: unknown) => void;

const listenersByUsername = new Map<string, Set<StreamListener>>();

export function subscribeTheme(username: string, listener: StreamListener): () => void {
  const key = username.trim().toLowerCase();
  const listeners = listenersByUsername.get(key) ?? new Set<StreamListener>();
  listeners.add(listener);
  listenersByUsername.set(key, listeners);

  return () => {
    const current = listenersByUsername.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listenersByUsername.delete(key);
    }
  };
}

export function publishTheme(username: string, payload: unknown): void {
  const key = username.trim().toLowerCase();
  const listeners = listenersByUsername.get(key);
  if (!listeners) return;

  for (const listener of listeners) {
    listener(payload);
  }
}
