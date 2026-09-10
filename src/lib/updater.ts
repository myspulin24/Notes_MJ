/**
 * Checking for, downloading and applying a new version.
 *
 * Notes_MJ is otherwise entirely offline, so this file is deliberately the only
 * place that reaches the network, and it is written to fail quietly: a missing
 * plugin, no connection or a GitHub outage must leave the app working exactly
 * as it did before. Nothing here ever throws at the caller.
 *
 * The signature check happens in Rust, inside the updater plugin, against the
 * public key baked into `tauri.conf.json`. An installer that is not signed by
 * the matching private key is refused before a single byte is executed, so a
 * compromised release page cannot turn into a compromised machine.
 */

import { isDesktop, toAppError } from './api';
import type { AppError } from './types';

/** What the updater knows about a version waiting to be installed. */
export interface UpdateInfo {
  version: string;
  /** Release notes as written in the GitHub release, may be empty. */
  notes: string;
  /** Publication date as the plugin reports it, may be empty. */
  date: string;
}

export type CheckResult =
  | { kind: 'available'; info: UpdateInfo }
  | { kind: 'current' }
  | { kind: 'unsupported' }
  | { kind: 'error'; error: AppError };

/**
 * The handle the plugin hands back; kept opaque so this module owns the type.
 *
 * `download` and `install` are deliberately kept apart. The plugin also offers
 * `downloadAndInstall`, but on Windows that *exits the application* as soon as
 * the bytes have arrived - which, for a download started quietly in the
 * background, would mean the window vanishing mid-sentence. Downloading stages
 * the installer and changes nothing; only `install` acts, and only when the
 * user presses Restart.
 */
type UpdateHandle = {
  version: string;
  body?: string | null;
  date?: string | null;
  download: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
};

export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

let pending: UpdateHandle | null = null;

/**
 * Accumulates the plugin's download events into a 0..1 fraction.
 *
 * Kept separate and pure because it is the only real logic here, and because
 * the awkward case - a server that sends no Content-Length - is easy to get
 * wrong and impossible to notice by hand.
 */
export interface DownloadProgress {
  /** Bytes received so far. */
  received: number;
  /** Total size if the server declared one, otherwise null. */
  total: number | null;
  /** 0..1, or null when the total is unknown and the download is not done. */
  fraction: number | null;
  done: boolean;
}

export const NO_PROGRESS: DownloadProgress = {
  received: 0,
  total: null,
  fraction: null,
  done: false,
};

export function applyDownloadEvent(
  current: DownloadProgress,
  event: DownloadEvent,
): DownloadProgress {
  switch (event.event) {
    case 'Started': {
      // A zero or missing length means "I am not telling you"; treat both the
      // same rather than dividing by zero later.
      const declared = event.data?.contentLength ?? 0;
      return { received: 0, total: declared > 0 ? declared : null, fraction: 0, done: false };
    }
    case 'Progress': {
      const received = current.received + Math.max(0, event.data?.chunkLength ?? 0);
      return {
        received,
        total: current.total,
        // A server that under-reports its own length must not produce 140 %.
        fraction: current.total ? Math.min(1, received / current.total) : null,
        done: false,
      };
    }
    case 'Finished':
      return {
        received: current.received,
        total: current.total ?? current.received,
        fraction: 1,
        done: true,
      };
    default:
      return current;
  }
}

/** "1.1.0" -> "verze 1.1.0", plus the date when the release page carried one. */
export function describeUpdate(info: UpdateInfo): string {
  const date = shortDate(info.date);
  return date ? `verze ${info.version} (${date})` : `verze ${info.version}`;
}

/**
 * The plugin reports dates like "2026-09-09 18:22:31.0 +00:00:00", which is
 * neither ISO nor Czech. Take the day and render it the way the rest of the
 * app does; give up quietly on anything unexpected.
 */
export function shortDate(raw: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!match) return '';
  const [, year, month, day] = match;
  return `${Number(day)}. ${Number(month)}. ${year}`;
}

// -- the plugin calls ---------------------------------------------------------

/** The installed version, or an empty string in a browser tab. */
export async function currentVersion(): Promise<string> {
  if (!isDesktop()) return '';
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return '';
  }
}

/**
 * Asks GitHub whether there is anything newer.
 *
 * Version comparison is the plugin's job: it parses both sides as semver, so
 * 1.10.0 correctly beats 1.9.0 and a downgrade is never offered.
 */
export async function checkForUpdate(): Promise<CheckResult> {
  if (!isDesktop()) return { kind: 'unsupported' };

  // Whatever was staged before is about to be superseded.
  await discardUpdate();

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      return { kind: 'current' };
    }
    pending = update as unknown as UpdateHandle;
    return {
      kind: 'available',
      info: {
        version: update.version,
        notes: (update.body ?? '').trim(),
        date: (update.date ?? '').trim(),
      },
    };
  } catch (error) {
    pending = null;
    return { kind: 'error', error: toAppError(error) };
  }
}

/** Whether a checked-for update is staged and installable. */
export function hasPendingUpdate(): boolean {
  return pending !== null;
}

/**
 * Fetches the update and leaves it staged.
 *
 * The signature is checked here, as part of the download, so reaching the end
 * of this function without an error means the bytes are both complete and
 * genuinely ours. Nothing is executed.
 */
export async function downloadUpdate(
  onProgress: (progress: DownloadProgress) => void,
): Promise<{ ok: true } | { ok: false; error: AppError }> {
  if (!pending) {
    return {
      ok: false,
      error: {
        kind: 'unavailable',
        message: 'Není co stahovat - nejdřív zkontrolujte aktualizace.',
        retryable: true,
      },
    };
  }

  let progress = NO_PROGRESS;
  try {
    await pending.download((event) => {
      progress = applyDownloadEvent(progress, event);
      onProgress(progress);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}

/**
 * Runs the staged installer, which closes the app and reopens the new version.
 *
 * On Windows `install` hands over to the NSIS installer and exits this process,
 * so anything written after the await will not run. That is fine: every command
 * commits its own SQLite transaction as it goes, so there is nothing waiting to
 * be flushed. It only returns at all when the handover failed.
 */
export async function installUpdate(): Promise<AppError | null> {
  if (!pending) {
    return {
      kind: 'unavailable',
      message: 'Není co instalovat - aktualizace se nestáhla.',
      retryable: true,
    };
  }
  try {
    await pending.install();
    return null;
  } catch (error) {
    return toAppError(error);
  }
}

/** Lets go of a staged update and the resources the plugin holds for it. */
export async function discardUpdate(): Promise<void> {
  const held = pending;
  pending = null;
  // Best effort: a handle we could not close is not worth a message.
  await held?.close().catch(() => {});
}

/**
 * The one-line status the sidebar foot shows while something is going on.
 *
 * Returns null when nothing is - which is the signal to fall back to whatever
 * the caller shows at rest. Kept out of the component because the precedence
 * is the part that can go wrong: a live stage always outranks the "up to date"
 * message, or a second check would leave a stale answer sitting under a
 * spinner.
 */
export function updateStatusLine(
  stage: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error',
  version: string | null,
  fraction: number | null,
): string | null {
  const named = version ? `Verze ${version}` : 'Nová verze';
  switch (stage) {
    case 'checking':
      return 'Hledám aktualizaci…';
    case 'downloading':
      // Without a declared size there is no honest percentage to show.
      return fraction === null
        ? 'Stahuji aktualizaci…'
        : `Stahuji… ${Math.round(fraction * 100)} %`;
    case 'available':
      return `${named} je k dispozici`;
    case 'ready':
      return `${named} čeká na restart`;
    default:
      return null;
  }
}
