/**
 * The strip along the top of the window when an update is ready to go in.
 *
 * It only ever appears once the download has finished and the signature has
 * checked out, so the offer it makes is always true: one click and it is done.
 * Nothing here interrupts - it can be dismissed, and the panel in settings
 * still holds the same Restart button afterwards.
 */

import { useStore } from '../state/store';
import { CloseIcon, RefreshIcon } from './Icons';

export function UpdateBanner() {
  const { updateStage, updateInfo, installUpdate, dismissUpdate } = useStore();

  if (updateStage !== 'ready') return null;

  return (
    <div className="update-banner" role="status">
      <RefreshIcon size={16} />
      <span className="update-banner-text">
        {updateInfo ? `Verze ${updateInfo.version}` : 'Nová verze'} je stažená a
        připravená k instalaci.
      </span>
      <button type="button" className="btn primary small" onClick={() => void installUpdate()}>
        Restartovat
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Skrýt oznámení o aktualizaci"
        title="Skrýt. Restartovat půjde i z Nastavení → Připomínky a aplikace."
        onClick={dismissUpdate}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
