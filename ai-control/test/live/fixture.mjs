// LIVE-mode fixtures. Everything runs inside a private network namespace (/workspace/mk-iso.sh): the Studio instances
// below are throw-away TEST-flavour servers on temp data dirs — never the owner's 8687/8787 instances.
// The password is a TEST-ONLY value created for these temp databases the same way the Studio's own security tests do it
// (scripts/security-test.mjs uses 'fake-password-123'); it is not, and must never be, a real password.
export const TEST_USER = 'igor';
export const TEST_PASSWORD = 'aic-live-test-only-7c1e9';
export const STUDIO_DIR = process.env.STUDIO_DIR || '/workspace/aic-studio-d1adf4d';
export const EMPTY = { studio: 8687, proxy: 8697, data: '/tmp/aic-live/studio-empty' };   // empty test DB (seed only)
export const SEEDED = { studio: 8688, proxy: 8698, data: '/tmp/aic-live/studio-seeded' }; // + ledger rows, a task, an episode
export const IDLE = { proxy: 8699, idleSec: 4 };                                          // → EMPTY studio, 4 s idle timeout
export const LOGS = '/tmp/aic-live/logs';
export const url = (port, p = '/') => `http://127.0.0.1:${port}${p}`;
export const CTL_RE = /Управление — после отдельного разрешения|Control — after a separate permission|Будет доступно на этапе 3|Available in stage 3/;
