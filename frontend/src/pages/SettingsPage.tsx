import { useEffect, useState } from 'react'
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { ApiKeyStatus } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/useToast'

export function SettingsPage() {
  const [status, setStatus] = useState<ApiKeyStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => api.get<ApiKeyStatus>('/settings/api-key').then(setStatus).catch(() => {})
  useEffect(() => void load(), [])

  const save = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    try {
      await api.put('/settings/api-key', { apiKey: apiKey.trim() })
      setApiKey('')
      await load()
      toast({ title: 'API key saved', description: 'Validated and encrypted at rest.' })
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not save key',
        description: err instanceof ApiError ? err.message : 'Unexpected error',
      })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      await api.del('/settings/api-key')
      await load()
      toast({ title: 'API key removed' })
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not remove key' })
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Claude API key
          </CardTitle>
          <CardDescription>
            Used server-side only to extract invoices. Encrypted at rest; never displayed in
            full after saving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status:</span>
            {status?.configured ? (
              <Badge className="gap-1">
                <ShieldCheck className="h-3 w-3" /> Configured
              </Badge>
            ) : (
              <Badge variant="secondary">Not configured</Badge>
            )}
            {status?.configured && status.masked && (
              <code className="rounded bg-muted px-2 py-0.5 text-xs">{status.masked}</code>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="key">{status?.configured ? 'Replace key' : 'Enter key'}</Label>
            <Input
              id="key"
              type="password"
              placeholder="sk-ant-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The key is validated against the Claude API before it is stored.
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={save} disabled={saving || !apiKey.trim()}>
              {saving ? 'Validating…' : 'Save key'}
            </Button>
            {status?.configured && (
              <Button variant="outline" className="gap-1.5 text-destructive" onClick={remove}>
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
