/**
 * The foot of the sidebar: version, copyright, and a button to look for a new
 * release.
 *
 * The second line does double duty. Normally it is the copyright; while
 * something is happening with an update it becomes the status, and after a
 * check that found nothing it says so for a few seconds and then goes back.
 * That is why the message is keyed on its own text - a changed key remounts
 * the line, and the remount is what plays the animation.
 */

import { useEffect, useState } from 'react';

import { updateStatusLine } from '../lib/updater';
import { useStore } from '../state/store';
import { RefreshIcon } from './Icons';

const COPYRIGHT = '© 2026 Michal Jašek';

/** How long "you are up to date" stays before the copyright returns. */
const FLASH_MS = 3600;

export function SidebarFooter() {
  const appVersion = useStore((s) => s.appVersion);
  const updateStage = useStore((s) => s.updateStage);
  const updateInfo = useStore((s) => s.updateInfo);
  const updateProgress = useStore((s) => s.updateProgress);
  const updateCheckedAt = useStore((s) => s.updateCheckedAt);
  const updateError = useStore((s) => s.updateError);
  const checkForUpdates = useStore((s) => s.checkForUpdates);
  const installUpdate = useStore((s) => s.installUpdate);

  const [flash, setFlash] = useState<string | null>(null);

  // Outcomes worth a word but not worth keeping on screen. Keyed on the
  // timestamp as well as the stage, so checking twice in a row still blinks.
  useEffect(() => {
    if (!updateCheckedAt) return;
    // An error can come from the check, the download or the install, so use
    // the real message; the line ellipsises and the tooltip has it in full.
    const message =
      updateStage === 'current'
        ? 'Máte nejnovější verzi'
        : updateStage === 'unpublished'
          ? 'Pro tuto platformu zatím nejsou aktualizace'
          : updateStage === 'error'
            ? (updateError?.message ?? 'Aktualizaci se nepodařilo dokončit')
            : null;
    if (!message) return;

    setFlash(message);
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [updateStage, updateCheckedAt, updateError]);

  const busy = updateStage === 'checking' || updateStage === 'downloading';
  const ready = updateStage === 'ready';

  // Anything still in progress outranks the flash: it is not history yet.
  const live = updateStatusLine(updateStage, updateInfo?.version ?? null, updateProgress.fraction);

  const line = live ?? flash ?? COPYRIGHT;

  // What the slide-in animation is keyed on, and deliberately not the text.
  //
  // The animation plays on mount, so a changed key replays it. During a
  // download the text changes several times a second ("Stahuji… 41 %", then
  // 42 %…); keying on it would restart the slide on every tick and the line
  // would sit parked at its starting offset, half of it clipped by the box -
  // exactly the state in which nobody can read the percentage. The stage is
  // what actually changed, so that is what the line is keyed on.
  const lineKey = live ? `live-${updateStage}` : flash ? `flash-${flash}` : 'rest';
  const failed = updateStage === 'error';
  const tone = live && !ready ? 'busy' : ready ? 'ready' : failed ? 'bad' : flash ? 'flash' : 'quiet';

  return (
    <footer className="sidebar-foot">
      <div className="sidebar-foot-text">
        <span className="sidebar-foot-version" title={`Notes_MJ ${appVersion || 'neznámá verze'}`}>
          Notes_MJ {appVersion || '—'}
        </span>
        {/*
          Keyed on the kind of message, so a genuinely new one slides in while
          a counter ticking inside the same message just updates in place.
        */}
        <span key={lineKey} className={`sidebar-foot-line tone-${tone}`} title={line}>
          {line}
        </span>
      </div>

      <button
        type="button"
        className={`sidebar-foot-btn${busy ? ' busy' : ''}${ready ? ' ready' : ''}`}
        aria-label={ready ? 'Restartovat a nainstalovat aktualizaci' : 'Zkontrolovat aktualizace'}
        title={
          ready
            ? 'Aktualizace je stažená — kliknutím restartujete a doinstaluje se'
            : 'Zkontrolovat aktualizace'
        }
        disabled={busy}
        onClick={() => void (ready ? installUpdate() : checkForUpdates())}
      >
        <RefreshIcon size={15} />
        {ready ? <span className="sidebar-foot-dot" aria-hidden="true" /> : null}
      </button>
    </footer>
  );
}
