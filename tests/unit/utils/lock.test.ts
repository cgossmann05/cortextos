import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { acquireLock, releaseLock } from '../../../src/utils/lock';

// Backdate a path's mtime to simulate a stale lock dir (>30s old).
function makeStale(p: string): void {
  const old = new Date(Date.now() - 60_000);
  utimesSync(p, old, old);
}

describe('mkdir-based locking', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'cortextos-lock-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('acquires lock on empty directory', () => {
    expect(acquireLock(testDir)).toBe(true);
    releaseLock(testDir);
  });

  it('prevents double acquire', () => {
    expect(acquireLock(testDir)).toBe(true);
    // Same process, same PID - should fail since lock.d already exists
    // (but our PID check will see it's our own process and succeed)
    // Actually, mkdir will fail because it already exists, then we check PID
    // Since it's our own PID, it sees process alive and returns false
    expect(acquireLock(testDir)).toBe(false);
    releaseLock(testDir);
  });

  it('releases lock correctly', () => {
    expect(acquireLock(testDir)).toBe(true);
    releaseLock(testDir);
    expect(acquireLock(testDir)).toBe(true);
    releaseLock(testDir);
  });

  it('recovers stale lock with empty PID file (crash remnant)', () => {
    // Simulate a crash that left a .lock.d with an empty pid file
    const lockDir = join(testDir, '.lock.d');
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'pid'), '');
    makeStale(lockDir);

    // Should self-heal and acquire
    expect(acquireLock(testDir)).toBe(true);
    releaseLock(testDir);
  });

  it('recovers stale lock with missing PID file (crash between mkdir+write)', () => {
    // Simulate a crash between mkdirSync and writeFileSync
    const lockDir = join(testDir, '.lock.d');
    mkdirSync(lockDir);
    makeStale(lockDir);

    expect(acquireLock(testDir)).toBe(true);
    releaseLock(testDir);
  });

  it('does NOT steal a fresh lock dir with missing PID (genuine mid-acquire)', () => {
    // Fresh lock dir with no pid file — holder is mid-acquire, do not steal
    const lockDir = join(testDir, '.lock.d');
    mkdirSync(lockDir);
    // Not backdated — mtime is now, so age < 30s

    expect(acquireLock(testDir)).toBe(false);
    rmSync(lockDir, { recursive: true, force: true });
  });

  it('does NOT steal a fresh lock dir with empty PID (genuine mid-acquire)', () => {
    const lockDir = join(testDir, '.lock.d');
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'pid'), '');
    // Not backdated

    expect(acquireLock(testDir)).toBe(false);
    rmSync(lockDir, { recursive: true, force: true });
  });
});
