import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatWeight(kg: number): string {
  return `${kg.toFixed(2)} kg`
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function generateQrId(
  materialCode: string,
  date: Date,
  sequence: number
): string {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
  return `RM-${materialCode}-${dateStr}-${String(sequence).padStart(4, '0')}`
}

export function getMaterialCode(materialName: string): string {
  const words = materialName.split(/[\s-]+/)
  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((w) => w.slice(0, 3).toUpperCase())
      .join('')
  }
  return materialName.slice(0, 4).toUpperCase()
}
