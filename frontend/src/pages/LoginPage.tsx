import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LogoMark, TaglineStrip, TAGLINE } from '@/components/brand/Logo'
import { SeverityAlert } from '@/components/ui/severity'

export function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Warm the backend as soon as the login screen loads so the container is awake by
  // the time the operator submits (mitigates cold-start login failures on mobile data).
  useEffect(() => {
    void api.warmUp()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* Paint-chip backdrop: three brand-coloured washes bleeding in from the
          edges. Pure CSS gradients — no images, no layout cost. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-40 h-[30rem] w-[30rem] rounded-full bg-brand-red/[0.09] blur-3xl" />
        <div className="absolute -right-24 top-1/4 h-[26rem] w-[26rem] rounded-full bg-brand-amber/[0.10] blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-[28rem] w-[28rem] rounded-full bg-brand-violet/[0.07] blur-3xl" />
      </div>

      <div className="relative flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          {/* Brand block */}
          <div className="mb-7 flex flex-col items-center text-center animate-fade-up">
            <LogoMark className="h-16 w-16" animate />
            <h1 className="mt-4 text-title-2 text-chip-900">Modern Colours</h1>
            <p className="mt-1.5 text-sm text-chip-500">{TAGLINE}</p>
          </div>

          <div
            className="rounded-xl border bg-card p-6 shadow-elev-3 animate-fade-up sm:p-7"
            style={{ animationDelay: '90ms' }}
          >
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@moderncolours.local"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11"
                />
              </div>

              {error && (
                <SeverityAlert
                  severity="critical"
                  title={error}
                  className="animate-shake"
                />
              )}

              <Button type="submit" className="h-11 w-full text-[0.9375rem]" disabled={busy}>
                {busy ? (
                  <>
                    {/* The mark itself is the spinner — brand even while waiting. */}
                    <LogoMark className="h-4 w-4 animate-orbit" />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-chip-400">
            Modern Colours Pvt. Ltd. · Material Inward &amp; Production Control
          </p>
        </div>
      </div>

      {/* The signature moving strip, anchored to the bottom of the login window. */}
      <TaglineStrip className="relative border-t bg-card/70 py-2.5 backdrop-blur-sm" />
    </div>
  )
}
