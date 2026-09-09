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

/** The handle the plugin hands back; kept opaque so this module owns the type. */
type UpdateHandle = {
  version: string;
  body?: string | null;
  date?: string | null;
  downloadAndInstall: (
    onEvent: (event: DownloadEvent) => void,
  ) => Promise<void>;
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

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      pending = null;
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

/**
 * Downloads the update and stages the installer.
 *
 * Despite the plugin's name this does not restart anything on Windows - the
 * installer is fetched, verified and left ready. Nothing runs until
 * `relaunch()` is called, which is what lets the user finish the sentence.
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
    await pending.downloadAndInstall((event) => {
      progress = applyDownloadEvent(progress, event);
      onProgress(progress);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}

/**
 * Closes the app and lets the staged installer take over.
 *
 * Everything is already committed to SQLite by this point - each command runs
 * in its own transaction - so there is nothing to flush first.
 */
export async function relaunchApp(): Promise<AppError | null> {
  if (!isDesktop()) return null;
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
    return null;
  } catch (error) {
    return toAppError(error);
  }
}

/** Test seam: forget any staged update. */
export function resetPending(): void {
  pending = null;
}
