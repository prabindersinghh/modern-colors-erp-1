// Shared chart color language. Reads the CSS variables defined in index.css so charts
// stay consistent with the rest of the UI (and any future theme change). Recharts wants
// concrete color strings, so we wrap each token in hsl().
const hsl = (v: string) => `hsl(${v})`;

export const CHART = {
  add: hsl('var(--chart-add)'),
  deduct: hsl('var(--chart-deduct)'),
  discard: hsl('var(--chart-discard)'),
  grid: 'hsl(var(--border))',
  axis: 'hsl(var(--muted-foreground))',
  categorical: [
    hsl('var(--chart-1)'),
    hsl('var(--chart-2)'),
    hsl('var(--chart-3)'),
    hsl('var(--chart-4)'),
    hsl('var(--chart-5)'),
    hsl('var(--chart-6)'),
  ],
} as const;

// Semantic colors for the request statuses (matches the StatusBadge palette intent).
export const STATUS_COLOR: Record<string, string> = {
  PENDING: hsl('var(--chart-3)'), // amber
  IN_PROGRESS: hsl('var(--chart-4)'), // violet
  APPROVED: hsl('var(--chart-2)'), // green
  PARTIAL: hsl('var(--chart-1)'), // blue
  REJECTED: hsl('var(--chart-discard)'), // red
};

export const DEPT_COLOR: Record<string, string> = {
  PU: hsl('var(--chart-1)'),
  ENAMEL: hsl('var(--chart-4)'),
  POWDER: hsl('var(--chart-5)'),
};
