import {mkdir, open, readFile, rm} from 'node:fs/promises';
import path from 'node:path';

export async function acquireBridgeProcessLock(directory, deviceId) {
  if (typeof deviceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) throw new Error('INVALID_DEVICE_ID');
  const lock = path.join(path.resolve(directory), `.device-${deviceId.toLowerCase()}.lock`);
  const owner = JSON.stringify({pid: process.pid});
  await mkdir(path.dirname(lock), {recursive: true});
  for (;;) {
    try {
      const handle = await open(lock, 'wx');
      try { await handle.writeFile(owner, 'utf8'); } finally { await handle.close(); }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          if ((await readFile(lock, 'utf8')) === owner) await rm(lock, {force: false});
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      let active = false;
      try {
        const existing = JSON.parse(await readFile(lock, 'utf8'));
        if (Number.isInteger(existing?.pid) && existing.pid > 0) {
          try { process.kill(existing.pid, 0); active = true; } catch { /* stale owner */ }
        }
      } catch { /* stale or incomplete owner */ }
      if (active) throw new Error('BRIDGE_CLIENT_ALREADY_RUNNING');
      await rm(lock, {force: true});
    }
  }
}
