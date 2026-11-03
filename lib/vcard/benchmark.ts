export type BenchmarkSample = {
  endpoint: string;
  durationMs: number;
  payloadBytes: number;
};

export type BenchmarkSummary = {
  totalMs: number;
  avgMs: number;
  totalPayloadBytes: number;
};

export function summarizeBenchmark(samples: BenchmarkSample[]): BenchmarkSummary {
  if (samples.length === 0) {
    return { totalMs: 0, avgMs: 0, totalPayloadBytes: 0 };
  }

  const totalMs = samples.reduce((acc, item) => acc + item.durationMs, 0);
  const totalPayloadBytes = samples.reduce((acc, item) => acc + item.payloadBytes, 0);
  return {
    totalMs,
    avgMs: totalMs / samples.length,
    totalPayloadBytes,
  };
}
