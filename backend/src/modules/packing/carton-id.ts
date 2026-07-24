/** Carton (packed-goods) identity — a leaf module so any service can share it without DI. */
export const CARTON_SEQ = 'carton_unique_seq';
export const PG_PREFIX = 'PG-';

/** A carton's PG id, zero-padded — PG-000001. */
export function formatCartonId(n: number | bigint): string {
  return `${PG_PREFIX}${String(n).padStart(6, '0')}`;
}
export function isCartonId(id: string): boolean {
  return id.trim().toUpperCase().startsWith(PG_PREFIX);
}
