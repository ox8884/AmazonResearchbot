import {randomUUID} from 'node:crypto';
import {link, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

export async function acquireBridgeProcessLock(directory, deviceId) {
  if (typeof deviceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) throw new Error('INVALID_DEVICE_ID');
  const lock = path.join(path.resolve(directory), `.device-${deviceId.toLowerCase()}.lock`);
  const owner = JSON.stringify({pid: process.pid});
  await mkdir(path.dirname(lock), {recursive: true});
  let incompleteLockAttempts = 0;
  for (;;) {
    const pending = `${lock}.${process.pid}.${randomUUID()}.pending`;
    try {
      await writeFile(pending, owner, {encoding: 'utf8', flag: 'wx'});
      try { await link(pending, lock); } finally { await rm(pending, {force: true}); }
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
      await rm(pending, {force: true});
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      let active = false;
      let incomplete = false;
      try {
        let existing;
        try { existing = JSON.parse(await readFile(lock, 'utf8')); } catch { incomplete = true; }
        if (Number.isInteger(existing?.pid) && existing.pid > 0) {
          try { process.kill(existing.pid, 0); active = true; } catch { /* stale owner */ }
        }
      } catch { incomplete = true; }
      if (active) throw new Error('BRIDGE_CLIENT_ALREADY_RUNNING');
      if (incomplete && incompleteLockAttempts < 40) {
        incompleteLockAttempts += 1;
        await new Promise(resolve => setTimeout(resolve, 25));
        continue;
      }
      await rm(lock, {force: true});
    }
  }
}
