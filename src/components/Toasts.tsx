/**
 * Transient messages, bottom-left.
 *
 * Success and info fade after a few seconds; errors stay until dismissed,
 * because an error you did not see is an error you cannot act on.
 */

import { useStore } from '../state/store';
import { CloseIcon, UndoIcon } from './Icons';

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  if (!toasts.length) return null;

  return (
    <div className="toasts" role="region" aria-label="Oznámení">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="toast-message">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="link"
              onClick={() => {
                toast.action?.run();
                dismissToast(toast.id);
              }}
            >
              <UndoIcon size={14} />
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            onClick={() => dismissToast(toast.id)}
            aria-label="Zavřít"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
