/**
 * Roulette Prize Probability Configuration
 * 
 * Prize Distribution:
 * - Try Again: 4 slots, 40% total probability (10% each)
 * - 5% OFF: 4 slots, 40% total probability (10% each)
 * - 10% OFF: 3 slots, 15% total probability (5% each)
 * - 15% OFF: 2 slots, 4% total probability (2% each)
 * - 20% OFF: 1 slot, 1% total probability (1% each)
 */

export interface PrizeOption {
  type: 'try_again' | 'discount';
  label: string;
  discountPercentage?: number;
  probability: number; // 0-1 range
  weight: number; // for weighted random selection
}

export const PRIZE_CONFIG: PrizeOption[] = [
  // "Try Again" prizes (4 options, total probability 40%)
  { type: 'try_again', label: 'Try Again', probability: 0.10, weight: 10 },
  { type: 'try_again', label: 'Try Again', probability: 0.10, weight: 10 },
  { type: 'try_again', label: 'Try Again', probability: 0.10, weight: 10 },
  { type: 'try_again', label: 'Try Again', probability: 0.10, weight: 10 },
  
  // 5% off prizes (4 options, total probability 40%)
  { type: 'discount', label: '5% OFF', discountPercentage: 5, probability: 0.10, weight: 10 },
  { type: 'discount', label: '5% OFF', discountPercentage: 5, probability: 0.10, weight: 10 },
  { type: 'discount', label: '5% OFF', discountPercentage: 5, probability: 0.10, weight: 10 },
  { type: 'discount', label: '5% OFF', discountPercentage: 5, probability: 0.10, weight: 10 },
  
  // 10% off prizes (3 options, total probability 15%)
  { type: 'discount', label: '10% OFF', discountPercentage: 10, probability: 0.05, weight: 5 },
  { type: 'discount', label: '10% OFF', discountPercentage: 10, probability: 0.05, weight: 5 },
  { type: 'discount', label: '10% OFF', discountPercentage: 10, probability: 0.05, weight: 5 },
  
  // 15% off prizes (2 options, total probability 4%)
  { type: 'discount', label: '15% OFF', discountPercentage: 15, probability: 0.02, weight: 2 },
  { type: 'discount', label: '15% OFF', discountPercentage: 15, probability: 0.02, weight: 2 },
  
  // 20% off jackpot (1 option, total probability 1%)
  { type: 'discount', label: '20% OFF', discountPercentage: 20, probability: 0.01, weight: 1 },
];

// Total weight for weighted random selection
export const TOTAL_WEIGHT = PRIZE_CONFIG.reduce((sum, prize) => sum + prize.weight, 0);

/**
 * Get a random prize using weighted random selection
 * This ensures the probability distribution matches the configuration
 */
export function getRandomPrize(): PrizeOption {
  let random = Math.random() * TOTAL_WEIGHT;
  
  for (const prize of PRIZE_CONFIG) {
    if (random < prize.weight) {
      return prize;
    }
    random -= prize.weight;
  }
  
  // Fallback to first prize (should never happen with proper weights)
  return PRIZE_CONFIG[0];
}

/**
 * Get prize statistics for verification/testing
 */
export function getPrizeStatistics(): {
  totalPrizes: number;
  totalWeight: number;
  byType: Record<string, { count: number; totalProbability: number; totalWeight: number }>;
} {
  const byType: Record<string, { count: number; totalProbability: number; totalWeight: number }> = {};
  
  for (const prize of PRIZE_CONFIG) {
    const key = prize.type === 'discount' ? `${prize.discountPercentage}% OFF` : prize.label;
    if (!byType[key]) {
      byType[key] = { count: 0, totalProbability: 0, totalWeight: 0 };
    }
    byType[key].count++;
    byType[key].totalProbability += prize.probability;
    byType[key].totalWeight += prize.weight;
  }
  
  return {
    totalPrizes: PRIZE_CONFIG.length,
    totalWeight: TOTAL_WEIGHT,
    byType,
  };
}

/**
 * Validate probability distribution sums to 100%
 */
export function validateProbabilityDistribution(): { valid: boolean; totalProbability: number; error?: string } {
  const totalProbability = PRIZE_CONFIG.reduce((sum, prize) => sum + prize.probability, 0);
  const tolerance = 0.001; // Allow 0.1% variance
  
  if (Math.abs(totalProbability - 1.0) > tolerance) {
    return {
      valid: false,
      totalProbability,
      error: `Total probability ${(totalProbability * 100).toFixed(2)}% does not equal 100%`,
    };
  }
  
  return { valid: true, totalProbability };
}
