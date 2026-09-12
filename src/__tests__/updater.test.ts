/**
 * The update flow's pure parts.
 *
 * Everything else in `updater.ts` is a thin call into the Tauri plugin, but the
 * progress accumulator is real arithmetic with two nasty cases - a server that
 * declares no size, and one that declares the wrong size - and a progress bar
 * that reads 143 % is the kind of thing nobody notices until a user does.
 */

import { describe, expect, it } from 'vitest';

import {
  applyDownloadEvent,
  describeUpdate,
  isPlatformUnpublished,
  shortDate,
  updateStatusLine,
  NO_PROGRESS,
} from '../lib/updater';
import type { DownloadEvent, DownloadProgress } from '../lib/updater';

/** Feeds a whole event stream through, the way the plugin would. */
function run(events: DownloadEvent[]): DownloadProgress {
  return events.reduce(applyDownloadEvent, NO_PROGRESS);
}

const started = (contentLength?: number): DownloadEvent => ({
  event: 'Started',
  data: contentLength === undefined ? {} : { contentLength },
});
const chunk = (chunkLength: number): DownloadEvent => ({
  event: 'Progress',
  data: { chunkLength },
});
const finished: DownloadEvent = { event: 'Finished' };

describe('applyDownloadEvent', () => {
  it('starts at zero of the declared size', () => {
    expect(run([started(1000)])).toEqual({
      received: 0,
      total: 1000,
      fraction: 0,
      done: false,
    });
  });

  it('adds chunks up into a fraction', () => {
    const progress = run([started(1000), chunk(250), chunk(250)]);
    expect(progress.received).toBe(500);
    expect(progress.fraction).toBe(0.5);
    expect(progress.done).toBe(false);
  });

  it('treats a missing content length as unknown rather than zero', () => {
    // Dividing by a zero total would give Infinity, and a bar that renders
    // "Infinity%" is worse than one that admits it does not know.
    const progress = run([started(), chunk(4096)]);
    expect(progress.total).toBeNull();
    expect(progress.fraction).toBeNull();
    expect(progress.received).toBe(4096);
  });

  it('treats a declared length of zero the same way', () => {
    expect(run([started(0), chunk(10)]).fraction).toBeNull();
  });

  it('never reports more than 100 % when the server under-declares', () => {
    const progress = run([started(100), chunk(80), chunk(80)]);
    expect(progress.received).toBe(160);
    expect(progress.fraction).toBe(1);
  });

  it('ignores a negative chunk instead of going backwards', () => {
    const progress = run([started(1000), chunk(500), chunk(-200)]);
    expect(progress.received).toBe(500);
  });

  it('finishes at a full bar', () => {
    const progress = run([started(1000), chunk(400), finished]);
    expect(progress.done).toBe(true);
    expect(progress.fraction).toBe(1);
  });

  it('learns the total from the bytes actually received when none was declared', () => {
    const progress = run([started(), chunk(300), chunk(200), finished]);
    expect(progress.total).toBe(500);
    expect(progress.fraction).toBe(1);
    expect(progress.done).toBe(true);
  });

  it('survives a stream that arrives with no Started event', () => {
    // Not expected, but a stuck bar is a better failure than a crash.
    const progress = run([chunk(50)]);
    expect(progress.received).toBe(50);
    expect(progress.fraction).toBeNull();
  });

  it('resets when a second download starts', () => {
    const first = run([started(1000), chunk(1000), finished]);
    const second = applyDownloadEvent(first, started(2000));
    expect(second).toEqual({ received: 0, total: 2000, fraction: 0, done: false });
  });
});

describe('shortDate', () => {
  it('reads the plugin own timestamp format', () => {
    expect(shortDate('2026-09-09 18:22:31.0 +00:00:00')).toBe('9. 9. 2026');
  });

  it('reads a plain ISO date', () => {
    expect(shortDate('2026-12-24')).toBe('24. 12. 2026');
  });

  it('gives up quietly on anything else', () => {
    expect(shortDate('')).toBe('');
    expect(shortDate('nedávno')).toBe('');
  });
});

describe('describeUpdate', () => {
  it('includes the date when there is one', () => {
    expect(describeUpdate({ version: '1.2.0', notes: '', date: '2026-09-09 18:22:31.0 +00:00:00' }))
      .toBe('verze 1.2.0 (9. 9. 2026)');
  });

  it('omits the brackets when there is not', () => {
    expect(describeUpdate({ version: '1.2.0', notes: '', date: '' })).toBe('verze 1.2.0');
  });
});

describe('updateStatusLine', () => {
  it('mlčí, když se nic neděje', () => {
    // null is the signal for the sidebar to show the copyright instead.
    expect(updateStatusLine('idle', null, null)).toBeNull();
    expect(updateStatusLine('current', '1.2.0', null)).toBeNull();
    expect(updateStatusLine('error', null, null)).toBeNull();
  });

  it('hlásí probíhající kontrolu', () => {
    expect(updateStatusLine('checking', null, null)).toBe('Hledám aktualizaci…');
  });

  it('ukazuje procenta, když je co počítat', () => {
    expect(updateStatusLine('downloading', '1.3.0', 0.42)).toBe('Stahuji… 42 %');
    expect(updateStatusLine('downloading', '1.3.0', 1)).toBe('Stahuji… 100 %');
  });

  it('bez známé velikosti procenta nevymýšlí', () => {
    expect(updateStatusLine('downloading', '1.3.0', null)).toBe('Stahuji aktualizaci…');
  });

  it('pojmenuje verzi, když ji zná', () => {
    expect(updateStatusLine('available', '1.3.0', null)).toBe('Verze 1.3.0 je k dispozici');
    expect(updateStatusLine('ready', '1.3.0', null)).toBe('Verze 1.3.0 čeká na restart');
  });

  it('poradí si i bez čísla verze', () => {
    // The plugin has always given us one, but a blank line would look broken.
    expect(updateStatusLine('ready', null, null)).toBe('Nová verze čeká na restart');
    expect(updateStatusLine('available', '', null)).toBe('Nová verze je k dispozici');
  });
});

describe('isPlatformUnpublished', () => {
  // Both wordings are copied from tauri-plugin-updater's own error enum
  // (`TargetNotFound` and `TargetsNotFound`). If a plugin upgrade reworded
  // them, this is the test that should go red rather than a user seeing a
  // red "update failed" line on a platform that simply has no build.
  it('recognises a single missing target', () => {
    const error = new Error(
      'the platform `darwin-aarch64` was not found in the response `platforms` object',
    );
    expect(isPlatformUnpublished(error)).toBe(true);
  });

  it('recognises the fallback-list variant, which is what macOS actually hits', () => {
    const error = new Error(
      'None of the fallback platforms `["darwin-aarch64", "darwin-universal"]` ' +
        'were found in the response `platforms` object',
    );
    expect(isPlatformUnpublished(error)).toBe(true);
  });

  it('reads a bare string and a plain object with a message', () => {
    expect(
      isPlatformUnpublished('the platform `x` was not found in the response `platforms` object'),
    ).toBe(true);
    expect(
      isPlatformUnpublished({
        message: 'the platform `x` was not found in the response `platforms` object',
      }),
    ).toBe(true);
  });

  it('leaves real failures alone, so they still surface as errors', () => {
    expect(isPlatformUnpublished(new Error('error sending request for url'))).toBe(false);
    expect(isPlatformUnpublished(new Error('signature verification failed'))).toBe(false);
    expect(isPlatformUnpublished(new Error('could not fetch a valid release JSON'))).toBe(false);
  });

  it('does not fall over on things that are not errors at all', () => {
    expect(isPlatformUnpublished(undefined)).toBe(false);
    expect(isPlatformUnpublished(null)).toBe(false);
    expect(isPlatformUnpublished({})).toBe(false);
    expect(isPlatformUnpublished(42)).toBe(false);
  });
});
