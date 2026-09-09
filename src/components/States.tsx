/**
 * The four states every list in Notes_MJ can be in.
 *
 * They live in one file so it stays obvious that all four exist and that none
 * of them is an afterthought: an empty Today should feel like an achievement,
 * a failed load should say what to do next, and neither should look like a
 * crash.
 */

import type { ReactNode } from 'react';

import type { AppError } from '../lib/types';

export function LoadingState({ label = 'Načítám' }: { label?: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      {/* Three dots rather than a spinner: local reads finish in a few
          milliseconds, and a spinner that flashes reads as a glitch. */}
      <div className="dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{label}…</p>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state state-empty">
      <div className="state-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      {hint ? <p>{hint}</p> : null}
      {action ? <div className="state-action">{action}</div> : null}
    </div>
  );
}

/**
 * A recoverable error. Every backend error carries whether retrying is worth
 * it, so the button only appears when it is.
 */
export function ErrorState({
  error,
  onRetry,
  onDismiss,
}: {
  error: AppError;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="state state-error" role="alert">
      <div className="state-icon" aria-hidden="true">
        <WarningIcon />
      </div>
      <h2>{headline(error)}</h2>
      <p>{error.message}</p>
      <div className="state-action">
        {onRetry && error.retryable !== false ? (
          <button type="button" className="btn primary" onClick={onRetry}>
            Zkusit znovu
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="btn" onClick={onDismiss}>
            Zavřít
          </button>
        ) : null}
      </div>
    </div>
  );
}

function headline(error: AppError): string {
  switch (error.kind) {
    case 'validation':
      return 'Tohle nevypadá správně';
    case 'not_found':
      return 'Už to tam není';
    case 'io':
      return 'Notes_MJ se nedostalo k vašim datům';
    case 'unavailable':
      return 'Tohle tady není dostupné';
    default:
      return 'Něco se pokazilo';
  }
}

/** A compact inline error, for a panel rather than a whole pane. */
export function InlineError({ error, onRetry }: { error: AppError; onRetry?: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <WarningIcon />
      <span>{error.message}</span>
      {onRetry && error.retryable !== false ? (
        <button type="button" className="link" onClick={onRetry}>
          Zkusit znovu
        </button>
      ) : null}
    </div>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M12 9v4m0 3.5h.01M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
