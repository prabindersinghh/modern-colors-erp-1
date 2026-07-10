import { Department } from '@prisma/client';

// Low-stock tiers (fixed KG, Phase 2 default). A material's TOTAL on-hand KG below
// CRITICAL is red; below LOW is amber. Chosen as sensible factory defaults; can be
// moved to Settings later without changing the alert shape.
export const LOW_STOCK = {
  CRITICAL_KG: 5,
  LOW_KG: 20,
} as const;

export type StockAlertLevel = 'CRITICAL' | 'LOW';

export const DEPARTMENTS: Department[] = [
  Department.PU,
  Department.ENAMEL,
  Department.POWDER,
];

// Default analytics window (days) and allowed windows for the FE toggle.
export const DEFAULT_WINDOW_DAYS = 30;
export const ALLOWED_WINDOW_DAYS = [7, 30, 90];

/** Clamp an arbitrary ?days= to an allowed window (defaults to 30). */
export function normalizeWindow(days?: number): number {
  if (!days || !ALLOWED_WINDOW_DAYS.includes(days)) return DEFAULT_WINDOW_DAYS;
  return days;
}
