/**
 * The update panel, at the top of "Připomínky a aplikace".
 *
 * It shows the installed version, a button to look for a new one, and - once
 * something has been downloaded - the single Restart button that finishes the
 * job. Every stage says what is happening in words, because "nothing visible
 * happened" is the failure mode people read as a broken button.
 */

import { useStore } from '../state/store';
import { describeUpdate } from '../lib/updater';
import { formatBytes } from '../lib/dates';
import { DownloadIcon, RefreshIcon } from './Icons';

export function UpdatePanel() {
  const {
    appVersion,
    updateStage,
    updateInfo,
    updateProgress,
    updateError,
    updateCheckedAt,
    settings,
    checkForUpdates,
    installUpdate,
  } = useStore();

  const busy = updateStage === 'checking' || updateStage === 'downloading';

  return (
    <section className="update-panel">
      <header className="update-head">
        <div>
          <h3>Verze aplikace</h3>
          <p className="muted small">
            Notes_MJ {appVersion || '1.1.0'}
            {updateCheckedAt ? ` · naposledy zkontrolováno ${clockOf(updateCheckedAt)}` : ''}
          </p>
        </div>

        {updateStage === 'ready' ? (
          <button type="button" className="btn primary" onClick={() => void installUpdate()}>
            <RefreshIcon size={15} />
            Restartovat a aktualizovat
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void checkForUpdates(true)}
          >
            <DownloadIcon size={15} />
            {busy ? 'Pracuji…' : 'Zkontrolovat aktualizace'}
          </button>
        )}
      </header>

      <Status
        stage={updateStage}
        info={updateInfo}
        progress={updateProgress}
        error={updateError}
        autoDownload={settings?.updates_auto_download ?? true}
        onDownload={() => void checkForUpdates(true)}
      />

      {updateInfo?.notes && (updateStage === 'ready' || updateStage === 'available') ? (
        <details className="update-notes">
          <summary>Co je nového ve verzi {updateInfo.version}</summary>
          <pre>{updateInfo.notes}</pre>
        </details>
      ) : null}

      <p className="hint">
        Aktualizace se stahují z GitHubu a instalují se jen tehdy, když sedí digitální
        podpis. Vaše data se aktualizací nedotknou — zůstávají ve stejné databázi.
      </p>
    </section>
  );
}

function Status({
  stage,
  info,
  progress,
  error,
  autoDownload,
  onDownload,
}: {
  stage: ReturnType<typeof useStore.getState>['updateStage'];
  info: ReturnType<typeof useStore.getState>['updateInfo'];
  progress: ReturnType<typeof useStore.getState>['updateProgress'];
  error: ReturnType<typeof useStore.getState>['updateError'];
  autoDownload: boolean;
  onDownload: () => void;
}) {
  switch (stage) {
    case 'checking':
      return <p className="update-line">Zjišťuji, jestli je k dispozici novější verze…</p>;

    case 'current':
      return (
        <p className="update-line ok">Máte nejnovější verzi. Nic není potřeba dělat.</p>
      );

    case 'available':
      return (
        <p className="update-line">
          K dispozici je {info ? describeUpdate(info) : 'novější verze'}.
          {autoDownload ? ' Stahuje se…' : ' '}
          {!autoDownload ? (
            <button type="button" className="link" onClick={onDownload}>
              Stáhnout teď
            </button>
          ) : null}
        </p>
      );

    case 'downloading':
      return (
        <div className="update-line">
          <span>
            Stahuji {info ? `verzi ${info.version}` : 'aktualizaci'}
            {progress.total
              ? ` — ${formatBytes(progress.received)} z ${formatBytes(progress.total)}`
              : ` — ${formatBytes(progress.received)}`}
          </span>
          <span className="progress-bar thin">
            <span
              /* Without a declared size there is nothing honest to show but
                 movement, so the bar goes indeterminate rather than lying. */
              className={`progress-fill${progress.fraction === null ? ' indeterminate' : ''}`}
              style={
                progress.fraction === null
                  ? undefined
                  : { width: `${Math.round(progress.fraction * 100)}%` }
              }
            />
          </span>
        </div>
      );

    case 'ready':
      return (
        <p className="update-line ok">
          {info ? `Verze ${info.version} je` : 'Aktualizace je'} stažená a ověřená. Zbývá
          jen restart — rozdělaná práce je průběžně uložená, o nic nepřijdete.
        </p>
      );

    case 'error':
      return (
        <p className="update-line bad">
          {error?.message ?? 'Aktualizaci se nepodařilo dokončit.'}
          {' '}Zkuste to znovu později, nebo si novou verzi stáhněte ručně z GitHubu.
        </p>
      );

    default:
      return (
        <p className="update-line muted">
          Notes_MJ se po spuštění samo podívá, jestli nevyšla novější verze.
        </p>
      );
  }
}

/** "14:07" from an ISO timestamp; the date itself is rarely the interesting bit. */
function clockOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}
