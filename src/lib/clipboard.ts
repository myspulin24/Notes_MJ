/**
 * Clipboard access, degrading gracefully.
 *
 * The Tauri plugin is the reliable path on the desktop; the browser API is the
 * fallback for `npm run dev` in a tab. Both can fail, and neither failing is
 * worth an error dialog — the caller gets `false`/`null` and says so quietly.
 */

import { isDesktop } from './api';

export async function writeText(text: string): Promise<boolean> {
  if (isDesktop()) {
    try {
      const { writeText: write } = await import('@tauri-apps/plugin-clipboard-manager');
      await write(text);
      return true;
    } catch {
      // Fall through to the browser API rather than giving up.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** `null` means "could not read", which is different from an empty clipboard. */
export async function readText(): Promise<string | null> {
  if (isDesktop()) {
    try {
      const { readText: read } = await import('@tauri-apps/plugin-clipboard-manager');
      return (await read()) ?? '';
    } catch {
      // Fall through.
    }
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
