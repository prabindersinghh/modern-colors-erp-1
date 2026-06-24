import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { StorageService } from './storage.service';

// Disk-driver fallback: round-trips bytes and rejects path traversal.
describe('StorageService (disk driver)', () => {
  let svc: StorageService;

  beforeEach(() => {
    const config = { get: () => undefined } as unknown as ConfigService; // no R2 creds → disk
    svc = new StorageService(config);
    svc.onModuleInit();
  });

  afterAll(async () => {
    await fs.rm(path.resolve(process.cwd(), '.storage', 'test'), {
      recursive: true,
      force: true,
    });
  });

  it('round-trips a buffer through put/get', async () => {
    const key = 'test/sample.bin';
    const data = Buffer.from('hello storage', 'utf8');
    await svc.put(key, data, 'application/octet-stream');
    const out = await svc.get(key);
    expect(out.equals(data)).toBe(true);
  });

  it('rejects keys that escape the storage root', async () => {
    await expect(
      svc.put('../../etc/evil', Buffer.from('x')),
    ).rejects.toThrow('Invalid storage key');
  });
});
