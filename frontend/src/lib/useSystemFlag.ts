import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

/**
 * Read an operational flag (today: STORE_INWARD_ACCESS) so the UI can tell the truth
 * about what a role can currently do.
 *
 * This is a courtesy, never the enforcement — the server refuses a blocked route whether
 * or not the nav hides it. It defaults to "on" (permissive) on any error or while
 * loading, so a flag-read hiccup can never make a tab vanish that the user is still
 * allowed to use.
 */
export function useStoreInwardAccess(): 'on' | 'off' {
  const [value, setValue] = useState<'on' | 'off'>('on')
  useEffect(() => {
    api
      .get<{ value: string }>('/system-flags/store-inward-access')
      .then((r) => setValue(r.value === 'off' ? 'off' : 'on'))
      .catch(() => setValue('on'))
  }, [])
  return value
}

/**
 * Read the packing-stage flag. Defaults OFF (and stays OFF on any error), so dispatch
 * shows its classic FG-drum home unless the owner has explicitly turned packing on. The
 * server enforces Gap A regardless — this only switches which home Dispatch sees.
 */
export function usePackingStage(): 'on' | 'off' {
  const [value, setValue] = useState<'on' | 'off'>('off')
  useEffect(() => {
    api
      .get<{ value: string }>('/system-flags/packing-stage')
      .then((r) => setValue(r.value === 'on' ? 'on' : 'off'))
      .catch(() => setValue('off'))
  }, [])
  return value
}
