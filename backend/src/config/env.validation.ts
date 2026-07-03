/**
 * Fail-fast validation of required environment variables at startup.
 * Security: the app must NEVER fall back to a hardcoded secret. If a critical
 * secret is missing or weak, refuse to boot rather than run with a known-weak key
 * (which would allow JWT forgery or trivial decryption of the stored Claude key).
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];

  // Self-heal dashboard paste accidents: adopt values whose variable NAME carries
  // stray whitespace (e.g. "ENCRYPTION_KEY " set in a PaaS UI is a different env var).
  for (const key of Object.keys(config)) {
    const clean = key.trim();
    if (clean !== key && config[clean] === undefined) {
      config[clean] = config[key];
    }
  }

  // Trim string values (trailing newlines/spaces from copy-paste) and write the
  // cleaned value back so ConfigService serves the sanitized version everywhere.
  const str = (k: string) => {
    const v = config[k];
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    if (t !== v) config[k] = t;
    return t || undefined;
  };

  const dbUrl = str('DATABASE_URL');
  if (!dbUrl) errors.push('DATABASE_URL is required');

  const jwt = str('JWT_SECRET');
  if (!jwt || jwt.length < 32) {
    errors.push('JWT_SECRET is required and must be at least 32 characters (use: openssl rand -hex 32)');
  }
  if (jwt === 'dev-secret' || jwt === 'change-me-to-a-long-random-string') {
    errors.push('JWT_SECRET must not be a placeholder/default value');
  }

  const enc = str('ENCRYPTION_KEY');
  if (!enc || !/^[0-9a-fA-F]{64}$/.test(enc)) {
    // Diagnostics print lengths and variable NAMES only — never secret values.
    // JSON.stringify exposes invisible characters in names (e.g. "ENCRYPTION_KEY ").
    const related = Object.keys(config).filter((k) => k.toUpperCase().includes('ENCRYPT'));
    errors.push(
      'ENCRYPTION_KEY is required and must be 64 hex chars / 32 bytes (use: openssl rand -hex 32). ' +
        `[diagnostics] received: ${enc === undefined ? 'nothing' : `${enc.length}-char value`}; ` +
        `env names containing "ENCRYPT": ${JSON.stringify(related)}`,
    );
  }
  if (enc && /^0+$/.test(enc)) {
    errors.push('ENCRYPTION_KEY must not be the all-zero placeholder value');
  }

  if (errors.length > 0) {
    throw new Error(
      'Invalid environment configuration:\n  - ' + errors.join('\n  - '),
    );
  }

  return config;
}
