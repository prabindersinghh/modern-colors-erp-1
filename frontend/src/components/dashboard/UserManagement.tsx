import { useCallback, useEffect, useState } from 'react'
import { UserPlus, KeyRound, UserX, UserCheck, Lock, ShieldCheck, Pencil, AlertTriangle } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { Department, ManagedUser } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { toast } from '@/hooks/useToast'
import { useAutoRefresh } from '@/lib/refresh'
import { cn } from '@/lib/utils'

const DOMAIN = '@moderncolours.local'
const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Store',
  OVERSIGHT: 'Admin',
  PRODUCTION_HEAD: 'Production head',
  DISPATCH: 'Dispatch',
  OPERATOR: 'Operator',
  SUPERVISOR: 'Supervisor',
}

/** Mirrors the server rule so the operator hears about a weak password before submitting. */
function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'At least 8 characters.'
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'Needs a letter and a digit.'
  return null
}

/**
 * The factory Admin's user management. Creation is limited to Production Head and
 * Dispatch logins (the server enforces this — privileged roles are seed-only), the
 * domain suffix is fixed, and removal is always deactivation, never deletion.
 */
export function UserManagement() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null)
  const [error, setError] = useState(false)
  const [creating, setCreating] = useState(false)
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null)
  const [renameTarget, setRenameTarget] = useState<ManagedUser | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<ManagedUser | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () => api.get<ManagedUser[]>('/admin/users').then(setUsers).catch(() => setError(true)),
    [],
  )
  useEffect(() => void load(), [load])
  useAutoRefresh(load)

  const act = async (fn: () => Promise<unknown>, okTitle: string) => {
    setBusy(true)
    try {
      await fn()
      toast({ title: okTitle })
      await load()
      return true
    } catch (err) {
      toast({ variant: 'destructive', title: 'Refused', description: err instanceof ApiError ? err.message : '' })
      return false
    } finally {
      setBusy(false)
    }
  }

  if (error) return <EmptyState title="Could not load logins" description="Please refresh to try again." />

  const protectedRole = (u: ManagedUser) => u.role === 'ADMIN' || u.role === 'OVERSIGHT'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-chip-600">
          Every login in the system. Removing a login <b>deactivates</b> it — its history stays
          intact and traceable forever.
        </p>
        <Button className="gap-1.5" onClick={() => setCreating((c) => !c)}>
          <UserPlus className="h-4 w-4" /> New login
        </Button>
      </div>

      {creating && (
        <CreateLoginForm
          busy={busy}
          onCreate={async (body) => {
            const ok = await act(() => api.post('/admin/users', body), `${body.localPart}${DOMAIN} created`)
            if (ok) setCreating(false)
          }}
        />
      )}

      {users?.some((u) => u.usingDefaultPassword) && (
        <Card edge="warning">
          <CardContent className="flex items-start gap-2 p-3.5 text-sm text-chip-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              Some logins that came with the system still use the published default password.
              Reset them below, or deactivate the ones you are not using and create your own.
            </span>
          </CardContent>
        </Card>
      )}

      {!users ? (
        <p className="text-sm text-chip-500">Loading…</p>
      ) : (
        <div className="stagger grid gap-2">
          {users.map((u) => (
            <Card key={u.id} className={cn(!u.active && 'opacity-60')}>
              {/* Mobile: the email gets a full row of its own (it IS the identity, so it
                  must never truncate), then meta, then actions. From sm up it becomes a
                  single row with the actions on the right. */}
              <CardContent className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 sm:flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="break-all font-mono text-sm font-medium text-chip-900">{u.email}</span>
                    {u.active ? (
                      <Badge className="shrink-0 bg-healthy text-success-foreground hover:bg-healthy">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">Inactive</Badge>
                    )}
                    {protectedRole(u) && (
                      <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-chip-500">
                        <Lock className="h-3 w-3" /> protected
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-chip-500">
                    <Badge variant="outline" className="text-[10px]">{ROLE_LABEL[u.role] ?? u.role}</Badge>
                    {u.department && <Badge variant="secondary" className="text-[10px]">{u.department}</Badge>}
                    {/* Which logins came with the system and which the Admin made himself. */}
                    <Badge variant="outline" className={cn('text-[10px]', u.seeded ? 'border-chip-300 text-chip-500' : 'border-primary/40 text-primary')}>
                      {u.seeded ? 'Came with the system' : 'Created by you'}
                    </Badge>
                    {u.usingDefaultPassword && (
                      <Badge className="bg-warning text-[10px] text-warning-foreground hover:bg-warning">Default password</Badge>
                    )}
                    <span>{u.name}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-chip-500">
                    created {u.createdAt.slice(0, 10)} · last login{' '}
                    {u.lastLoginAt ? u.lastLoginAt.slice(0, 16).replace('T', ' ') : 'never'}
                  </div>
                </div>
                {!protectedRole(u) && (
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" variant="outline" className="h-9 flex-1 gap-1 text-xs sm:flex-none" disabled={busy} onClick={() => setRenameTarget(u)}>
                      <Pencil className="h-3.5 w-3.5" /> Rename
                    </Button>
                    <Button size="sm" variant="outline" className="h-9 flex-1 gap-1 text-xs sm:flex-none" disabled={busy} onClick={() => setResetTarget(u)}>
                      <KeyRound className="h-3.5 w-3.5" /> Reset
                    </Button>
                    {u.active ? (
                      <Button size="sm" variant="outline" className="h-9 flex-1 gap-1 text-xs text-destructive sm:flex-none" disabled={busy} onClick={() => setDeactivateTarget(u)}>
                        <UserX className="h-3.5 w-3.5" /> Deactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 flex-1 gap-1 text-xs text-healthy sm:flex-none"
                        disabled={busy}
                        onClick={() => void act(() => api.post(`/admin/users/${u.id}/reactivate`), `${u.email} reactivated`)}
                      >
                        <UserCheck className="h-3.5 w-3.5" /> Reactivate
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-chip-500">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
        Heads of the same department share that department's data — every action is still recorded
        under the individual login. Store and Admin logins cannot be created or deactivated here.
      </p>

      {renameTarget && (
        <RenameDialog
          user={renameTarget}
          busy={busy}
          onClose={() => setRenameTarget(null)}
          onRename={async (name) => {
            const ok = await act(
              () => api.post(`/admin/users/${renameTarget.id}/rename`, { name }),
              `${renameTarget.email} renamed`,
            )
            if (ok) setRenameTarget(null)
          }}
        />
      )}

      {resetTarget && (
        <ResetPasswordDialog
          user={resetTarget}
          busy={busy}
          onClose={() => setResetTarget(null)}
          onReset={async (password) => {
            const ok = await act(
              () => api.post(`/admin/users/${resetTarget.id}/reset-password`, { password }),
              `Password reset for ${resetTarget.email}`,
            )
            if (ok) setResetTarget(null)
          }}
        />
      )}

      <ConfirmationDialog
        open={!!deactivateTarget}
        onOpenChange={(v) => !v && setDeactivateTarget(null)}
        title="Deactivate this login?"
        description={
          deactivateTarget
            ? `${deactivateTarget.email} will no longer be able to log in. Everything they created stays intact and attributed to them. You can reactivate at any time. This is recorded in the audit trail.`
            : ''
        }
        confirmLabel="Deactivate"
        onConfirm={() =>
          void act(() => api.post(`/admin/users/${deactivateTarget!.id}/deactivate`), `${deactivateTarget!.email} deactivated`).then(
            () => setDeactivateTarget(null),
          )
        }
      />
    </div>
  )
}

function CreateLoginForm({
  busy,
  onCreate,
}: {
  busy: boolean
  onCreate: (body: { localPart: string; name: string; role: string; department?: string; password: string }) => Promise<void>
}) {
  const [localPart, setLocalPart] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'PRODUCTION_HEAD' | 'DISPATCH'>('PRODUCTION_HEAD')
  const [department, setDepartment] = useState<Department>('PU')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const pwErr = password ? passwordProblem(password) : null
  const mismatch = confirm.length > 0 && password !== confirm
  const canSubmit = localPart.trim() && name.trim() && password && !pwErr && password === confirm

  return (
    <Card edge="primary" className="animate-fade-up">
      <CardHeader className="pb-2">
        <CardTitle className="text-title-3">New login</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Login</Label>
            <div className="flex items-center gap-1">
              <Input
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value.toLowerCase())}
                placeholder="pu2"
                className="h-10 min-w-0 flex-1 font-mono"
                autoCapitalize="none"
              />
              {/* The suffix is fixed and displayed, not editable — the server composes it. */}
              <span className="shrink-0 rounded-md bg-chip-100 px-2 py-2.5 font-mono text-xs text-chip-600">{DOMAIN}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Display name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. PU Head — night shift" className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'PRODUCTION_HEAD' | 'DISPATCH')}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="PRODUCTION_HEAD">Production head</option>
              <option value="DISPATCH">Dispatch</option>
            </select>
          </div>
          {role === 'PRODUCTION_HEAD' && (
            <div className="space-y-1.5">
              <Label>Department</Label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value as Department)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="PU">PU</option>
                <option value="ENAMEL">Enamel</option>
                <option value="POWDER">Powder</option>
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
            {pwErr && <p className="text-xs text-critical">{pwErr}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Confirm password</Label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-10" />
            {mismatch && <p className="text-xs text-critical">Passwords do not match.</p>}
          </div>
        </div>
        <Button
          disabled={busy || !canSubmit}
          onClick={() =>
            void onCreate({
              localPart: localPart.trim(),
              name: name.trim(),
              role,
              department: role === 'PRODUCTION_HEAD' ? department : undefined,
              password,
            })
          }
        >
          Create login
        </Button>
      </CardContent>
    </Card>
  )
}

/** Display name only — the login itself, its role and its history never change. */
function RenameDialog({
  user,
  busy,
  onClose,
  onRename,
}: {
  user: ManagedUser
  busy: boolean
  onClose: () => void
  onRename: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(user.name)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full rounded-t-2xl bg-background p-5 shadow-xl sm:max-w-sm sm:rounded-2xl">
        <h2 className="text-title-3 text-chip-900">Rename login</h2>
        <p className="mt-1 font-mono text-xs text-chip-500">{user.email}</p>
        <div className="mt-4 space-y-1.5">
          <Label>Display name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" autoFocus />
          <p className="text-xs text-chip-500">
            Only the name shown in lists changes. The login, its role and everything it recorded stay
            exactly as they are.
          </p>
        </div>
        <div className="mt-5 flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            className="h-11 flex-1"
            disabled={busy || !name.trim() || name.trim() === user.name}
            onClick={() => void onRename(name.trim())}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

function ResetPasswordDialog({
  user,
  busy,
  onClose,
  onReset,
}: {
  user: ManagedUser
  busy: boolean
  onClose: () => void
  onReset: (password: string) => Promise<void>
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const pwErr = password ? passwordProblem(password) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full rounded-t-2xl bg-background p-5 shadow-xl sm:max-w-sm sm:rounded-2xl">
        <h2 className="text-title-3 text-chip-900">Reset password</h2>
        <p className="mt-1 font-mono text-xs text-chip-500">{user.email}</p>
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" autoFocus />
            {pwErr && <p className="text-xs text-critical">{pwErr}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Confirm</Label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11" />
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            className="h-11 flex-1"
            disabled={busy || !password || !!pwErr || password !== confirm}
            onClick={() => void onReset(password)}
          >
            Reset
          </Button>
        </div>
      </div>
    </div>
  )
}
