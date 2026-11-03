import type { NextRequest } from 'next/server';

export async function getMetricsSummary() {
  return {
    totalRequests: 0,
    averageResponseTime: 0,
    slowRequests: 0,
    averageLatencyMs: 0,
    uptimeSeconds: 0,
  };
}

export async function withPerformanceTracking<T>(
  _request: NextRequest,
  handler: (requestId: string) => Promise<T>
): Promise<T> {
  const requestId = Date.now().toString();
  return handler(requestId);
}
