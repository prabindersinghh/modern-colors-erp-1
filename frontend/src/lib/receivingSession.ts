import { sumByUnit, formatUnitTotals, type UnitTotal } from '@/lib/units'

/**
 * Receiving sessions — an explicit Start/Done around a truckload of scans.
 *
 * Deliberately CLIENT-SIDE ONLY. Every individual scan is already recorded and audited
 * server-side; a session is the operator's own grouping of them — a label, a start and
 * an end — from which a summary and a receiving report are produced. Nothing here
 * touches guards, stock logic or the backend at all.
 *
 * State lives in localStorage so an accidental reload mid-truckload (2,500 sacks!)
 * resumes instead of losing the session.
 */

export interface SessionEntry {
  uniqueId: string
  materialName: string | null
  /** Opening balance received, in `unit` — null when the unit has no pack weight. */
  qty: number | null
  unit: string
  needsWeight: boolean
  /** True when the scan was queued offline; it syncs itself, the report just notes it. */
  queued: boolean
  at: string // ISO
}

export interface ReceivingSession {
  label: string
  startedAt: string // ISO
  entries: SessionEntry[]
  /** Scans of units that were already received (not counted as received again). */
  alreadyCount: number
  /** Failed scans (unknown unit, wrong prefix…) — counted so the recap is honest. */
  errorCount: number
}

export interface SessionMaterialLine {
  materialName: string
  unitCount: number
  totals: UnitTotal[]
}

export interface SessionSummary {
  label: string
  startedAt: string
  endedAt: string
  durationMinutes: number
  receivedCount: number
  /** Per-material breakdown; kg and L are kept apart (never summed together). */
  byMaterial: SessionMaterialLine[]
  /** Factory-total for the session, split by unit. */
  totals: UnitTotal[]
  blockedCount: number
  queuedCount: number
  alreadyCount: number
  errorCount: number
}

const STORAGE_KEY = 'mc.receivingSession.v1'

// ── persistence ──────────────────────────────────────────────────────────────

export function loadSession(): ReceivingSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as ReceivingSession
    // Minimal shape check — a corrupt value must never break the receiving screen.
    if (!s || typeof s.startedAt !== 'string' || !Array.isArray(s.entries)) return null
    return s
  } catch {
    return null
  }
}

export function saveSession(s: ReceivingSession | null): void {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage full/blocked — the session simply won't survive a reload */
  }
}

// ── session lifecycle (pure) ────────────────────────────────────────────────

export function startSession(label: string): ReceivingSession {
  return {
    label: label.trim(),
    startedAt: new Date().toISOString(),
    entries: [],
    alreadyCount: 0,
    errorCount: 0,
  }
}

/** A successful receive (or an offline-queued one). Same unit twice = no double count. */
export function recordReceived(s: ReceivingSession, e: Omit<SessionEntry, 'at'>): ReceivingSession {
  if (s.entries.some((x) => x.uniqueId === e.uniqueId)) {
    return { ...s, alreadyCount: s.alreadyCount + 1 }
  }
  return { ...s, entries: [...s.entries, { ...e, at: new Date().toISOString() }] }
}

export function recordAlready(s: ReceivingSession): ReceivingSession {
  return { ...s, alreadyCount: s.alreadyCount + 1 }
}

export function recordError(s: ReceivingSession): ReceivingSession {
  return { ...s, errorCount: s.errorCount + 1 }
}

export function closeSession(s: ReceivingSession, endedAt = new Date()): SessionSummary {
  const started = new Date(s.startedAt)
  const byName = new Map<string, SessionEntry[]>()
  for (const e of s.entries) {
    const key = e.materialName ?? '(queued offline — material pending sync)'
    byName.set(key, [...(byName.get(key) ?? []), e])
  }
  const byMaterial: SessionMaterialLine[] = [...byName.entries()]
    .map(([materialName, entries]) => ({
      materialName,
      unitCount: entries.length,
      // qty=null (blocked / queued) contributes 0 — the count still shows the unit.
      totals: sumByUnit(entries.map((e) => ({ unit: e.unit, qty: e.qty ?? 0 }))),
    }))
    .sort((a, b) => b.unitCount - a.unitCount || a.materialName.localeCompare(b.materialName))

  return {
    label: s.label,
    startedAt: s.startedAt,
    endedAt: endedAt.toISOString(),
    durationMinutes: Math.max(0, Math.round((endedAt.getTime() - started.getTime()) / 60000)),
    receivedCount: s.entries.length,
    byMaterial,
    totals: sumByUnit(s.entries.map((e) => ({ unit: e.unit, qty: e.qty ?? 0 }))),
    blockedCount: s.entries.filter((e) => e.needsWeight).length,
    queuedCount: s.entries.filter((e) => e.queued).length,
    alreadyCount: s.alreadyCount,
    errorCount: s.errorCount,
  }
}

// ── report outputs ──────────────────────────────────────────────────────────

const csvField = (v: string | number | null) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per received unit — for Excel / records. */
export function buildCsv(s: ReceivingSession): string {
  const header = 'Unique ID,Material,Quantity,Unit,Blocked (no pack weight),Queued offline,Scanned at'
  const rows = s.entries.map((e) =>
    [
      csvField(e.uniqueId),
      csvField(e.materialName),
      csvField(e.qty),
      csvField(e.unit),
      e.needsWeight ? 'yes' : '',
      e.queued ? 'yes' : '',
      csvField(e.at.slice(0, 19).replace('T', ' ')),
    ].join(','),
  )
  return [header, ...rows].join('\n')
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Self-contained printable receiving slip (opened in a new tab → browser Print /
 * Save as PDF). Inline styles only, no app chrome, label and names HTML-escaped.
 */
export function buildPrintHtml(summary: SessionSummary): string {
  const rows = summary.byMaterial
    .map(
      (m) => `<tr>
        <td>${esc(m.materialName)}</td>
        <td style="text-align:right">${m.unitCount}</td>
        <td style="text-align:right">${esc(formatUnitTotals(m.totals))}</td>
      </tr>`,
    )
    .join('')

  const notes: string[] = []
  if (summary.blockedCount > 0)
    notes.push(`${summary.blockedCount} unit(s) received without a pack weight — blocked from issue until fixed on the PO.`)
  if (summary.queuedCount > 0)
    notes.push(`${summary.queuedCount} scan(s) were queued offline and sync automatically.`)
  if (summary.alreadyCount > 0) notes.push(`${summary.alreadyCount} scan(s) were of already-received units (not counted).`)
  if (summary.errorCount > 0) notes.push(`${summary.errorCount} failed scan(s).`)

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receiving slip</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;color:#1b1b1f;margin:32px;font-size:14px}
  h1{font-size:20px;margin:0 0 2px}
  .sub{color:#6b6b70;margin:0 0 18px}
  table{border-collapse:collapse;width:100%;margin:14px 0}
  th,td{border-bottom:1px solid #d9d9de;padding:7px 8px;text-align:left}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b6b70}
  .totals{font-weight:700}
  .note{color:#8a5a00;font-size:12px;margin:3px 0}
  @media print{body{margin:12mm}}
</style></head><body>
<h1>Receiving slip${summary.label ? ` — ${esc(summary.label)}` : ''}</h1>
<p class="sub">${fmtTime(summary.startedAt)} → ${fmtTime(summary.endedAt)} · ${summary.durationMinutes} min · ${summary.receivedCount} unit${summary.receivedCount === 1 ? '' : 's'} received</p>
<table>
  <thead><tr><th>Material</th><th style="text-align:right">Units</th><th style="text-align:right">Quantity</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="totals"><td>Total</td><td style="text-align:right">${summary.receivedCount}</td><td style="text-align:right">${esc(formatUnitTotals(summary.totals))}</td></tr></tfoot>
</table>
${notes.map((n) => `<p class="note">⚠ ${esc(n)}</p>`).join('')}
<p class="sub" style="margin-top:22px">Modern Colours — every colour, accounted for.</p>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},150)})</script>
</body></html>`
}
