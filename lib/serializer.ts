type OptimizeOptions = {
  excludeFields?: string[];
  includeFields?: string[];
  selectFields?: string[];
  maxDepth?: number;
  maxArrayItems?: number;
  excludeNulls?: boolean;
};

export function optimizeResponse<T>(data: T, options: OptimizeOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 5;
  const maxArrayItems = options.maxArrayItems ?? 200;
  const normalized: Required<OptimizeOptions> = {
    excludeFields: options.excludeFields ?? [],
    includeFields: options.includeFields ?? [],
    selectFields: options.selectFields ?? [],
    maxDepth,
    maxArrayItems,
    excludeNulls: options.excludeNulls ?? false,
  };
  return optimizeValue(data, normalized, 0);
}

function optimizeValue(value: unknown, options: Required<OptimizeOptions>, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();

  if (depth >= options.maxDepth) {
    return Array.isArray(value) ? [] : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, options.maxArrayItems).map((item) => optimizeValue(item, options, depth + 1));
  }

  if (typeof value !== "object") {
    return value;
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(obj)) {
    if (options.excludeFields.includes(key)) continue;
    if (options.includeFields.length > 0 && !options.includeFields.includes(key)) continue;
    if (options.selectFields.length > 0 && !options.selectFields.includes(key)) continue;
    if (options.excludeNulls && (fieldValue === null || fieldValue === undefined)) continue;

    result[key] = optimizeValue(fieldValue, options, depth + 1);
  }

  return result;
}

type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  pages: number;
  has_next?: boolean;
  has_previous?: boolean;
};

export function paginatedResponse<T>(
  data: T,
  pagination: PaginationMeta,
  options: { optimize?: boolean; optimizeOptions?: OptimizeOptions } = {}
) {
  const payload = options.optimize
    ? optimizeResponse(data, options.optimizeOptions)
    : data;

  return {
    success: true,
    data: payload,
    meta: {
      pagination,
      timestamp: new Date().toISOString(),
    },
  };
}
