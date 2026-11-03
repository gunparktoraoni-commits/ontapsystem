type AsyncQueryMap = Record<string, () => Promise<unknown>>;

type AwaitedQueryResults<T extends AsyncQueryMap> = {
  [K in keyof T]: Awaited<ReturnType<T[K]>>;
};

export async function parallelFetch<T extends AsyncQueryMap>(
  queries: T
): Promise<AwaitedQueryResults<T>> {
  const entries = Object.entries(queries) as Array<[keyof T, T[keyof T]]>;
  const values = await Promise.all(entries.map(([, query]) => query()));

  return entries.reduce((acc, [key], index) => {
    acc[key] = values[index] as Awaited<ReturnType<T[typeof key]>>;
    return acc;
  }, {} as AwaitedQueryResults<T>);
}

export async function parallelFetchSettled<T extends AsyncQueryMap>(
  queries: T
): Promise<{ [K in keyof T]: PromiseSettledResult<Awaited<ReturnType<T[K]>>> }> {
  const entries = Object.entries(queries) as Array<[keyof T, T[keyof T]]>;
  const values = await Promise.allSettled(entries.map(([, query]) => query()));

  return entries.reduce((acc, [key], index) => {
    acc[key] = values[index] as PromiseSettledResult<Awaited<ReturnType<T[typeof key]>>>;
    return acc;
  }, {} as { [K in keyof T]: PromiseSettledResult<Awaited<ReturnType<T[K]>>> });
}
