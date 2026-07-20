import { ServiceUnavailableException } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Storage failure handling.
 *
 * THE INCIDENT THIS LOCKS DOWN: invoice upload started returning a bare
 * 500 "Internal server error" in production. The storekeeper was told nothing useful,
 * and the cause (the storage backend, not the app) could not be identified without
 * reproducing it by hand. Every storage failure must now produce a specific,
 * actionable message and a 503 — the service is unavailable, the request was fine.
 */
describe('StorageService — failure handling', () => {
  const cfg = (values: Record<string, string | undefined>) =>
    ({ get: (k: string) => values[k] }) as never;

  /** Build a service with R2 "configured", then swap in a failing S3 client. */
  const r2WithError = (err: unknown) => {
    const svc = new StorageService(
      cfg({
        STORAGE_DRIVER: 'r2',
        R2_ACCESS_KEY_ID: 'key',
        R2_SECRET_ACCESS_KEY: 'secret',
        R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
        R2_BUCKET: 'modern-colours',
      }),
    );
    svc.onModuleInit();
    // Replace the real client with one that always fails the way R2 would.
    (svc as unknown as { s3: { send: () => Promise<never> } }).s3 = {
      send: () => Promise.reject(err),
    };
    return svc;
  };

  it('reports bad credentials as a fixable cause, not "internal server error"', async () => {
    const svc = r2WithError({ name: 'InvalidAccessKeyId', $metadata: { httpStatusCode: 403 } });
    await expect(svc.put('po/x.pdf', Buffer.from('x'))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(svc.put('po/x.pdf', Buffer.from('x'))).rejects.toThrow(/access token/i);
  });

  it('reports a missing bucket distinctly from a credential problem', async () => {
    const svc = r2WithError({ name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } });
    await expect(svc.put('po/x.pdf', Buffer.from('x'))).rejects.toThrow(/bucket does not exist/i);
    // ...but WITHOUT naming the bucket — see the identifier-leak test below.
    await expect(svc.put('po/x.pdf', Buffer.from('x'))).rejects.not.toThrow(/modern-colours/);
  });

  it('reports an unreachable endpoint', async () => {
    const svc = r2WithError({ name: 'ENOTFOUND' });
    await expect(svc.get('po/x.pdf')).rejects.toThrow(/could not be reached/i);
  });

  it('tells the operator they can still enter the invoice manually', async () => {
    // The factory must not be blocked entirely because object storage is down.
    const svc = r2WithError({ name: 'InvalidAccessKeyId', $metadata: { httpStatusCode: 403 } });
    await expect(svc.put('po/x.pdf', Buffer.from('x'))).rejects.toThrow(/manually/i);
  });

  it('never leaks credentials in the message', async () => {
    const svc = r2WithError({ name: 'SignatureDoesNotMatch', $metadata: { httpStatusCode: 403 } });
    await expect(svc.put('po/x.pdf', Buffer.from('x'))).rejects.not.toThrow(/secret|key/);
  });

  it('never leaks INFRASTRUCTURE IDENTIFIERS in the message', async () => {
    // Regression: the endpoint host embeds the Cloudflare ACCOUNT ID, and the bucket
    // name is deployment detail. This message is returned to callers (OPERATOR too,
    // not just admins) AND written into the append-only audit log, where it would
    // persist permanently. Identifiers belong in the server log only.
    for (const err of [
      { name: 'ENOTFOUND' },
      { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } },
      { name: 'InvalidAccessKeyId', $metadata: { httpStatusCode: 403 } },
    ]) {
      const svc = r2WithError(err);
      const thrown: Error = await svc
        .put('po/x.pdf', Buffer.from('x'))
        .then(() => new Error('expected a rejection'))
        .catch((e: unknown) => e as Error);
      expect(thrown.message).not.toMatch(/acct\.r2\.cloudflarestorage\.com/);
      expect(thrown.message).not.toMatch(/r2\.cloudflarestorage\.com/);
      expect(thrown.message).not.toMatch(/modern-colours/);
      // Still useful: it always says what to do about it.
      expect(thrown.message).toMatch(/storage/i);
    }
  });

  it('does NOT mask the path-traversal guard as a storage outage', async () => {
    // Regression: the error wrapper originally swallowed this security check and
    // relabelled it "local file storage failed", which both hid the real reason and
    // implied the caller should retry a malicious key.
    const svc = new StorageService(cfg({}));
    svc.onModuleInit();
    await expect(svc.put('../../etc/passwd', Buffer.from('x'))).rejects.toThrow(
      'Invalid storage key',
    );
    await expect(svc.put('../../etc/passwd', Buffer.from('x'))).rejects.not.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  describe('configuration diagnostics', () => {
    it('names exactly which R2 settings are missing', async () => {
      const svc = new StorageService(
        cfg({ STORAGE_DRIVER: 'r2', R2_ACCESS_KEY_ID: 'key' }), // secret/endpoint/bucket absent
      );
      svc.onModuleInit();
      const health = await svc.healthCheck();
      // Falls back to disk, but the gap must be visible rather than silent: on a
      // container host a disk fallback loses uploaded invoices on the next deploy.
      expect(health.driver).toBe('disk');
      expect(health.misconfigured).toEqual(
        expect.arrayContaining(['R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET']),
      );
    });

    it('round-trips successfully on the disk driver', async () => {
      const svc = new StorageService(cfg({}));
      svc.onModuleInit();
      const health = await svc.healthCheck();
      expect(health.driver).toBe('disk');
      expect(health.ok).toBe(true);
    });

    it('reports degraded rather than throwing when the backend is down', async () => {
      const svc = r2WithError({ name: 'InvalidAccessKeyId', $metadata: { httpStatusCode: 403 } });
      const health = await svc.healthCheck();
      // The probe must never take the health endpoint down with it.
      expect(health.ok).toBe(false);
      expect(health.error).toMatch(/access token/i);
      expect(health.driver).toBe('r2');
    });
  });
});
