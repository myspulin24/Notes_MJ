/**
 * The hook every list uses to attach a right-click menu.
 *
 * It assembles the [`MenuContext`] from the store once, so a component only
 * has to say *which* menu to build — not re-wire the same eight store actions
 * each time.
 */

import { useCallback } from 'react';

import type { MenuItem } from './contextmenu';
import type { MenuContext } from './menus';
import { useStore } from '../state/store';

export function useMenu(refresh?: () => void | Promise<void>) {
  const openContextMenu = useStore((s) => s.openContextMenu);
  const today = useStore((s) => s.today);
  const settings = useStore((s) => s.settings);

  /** Everything the builders in `menus.ts` need. */
  const ctx: MenuContext = {
    today,
    confirmDelete: settings?.confirm_delete ?? true,
    setStatus: (id, status) => useStore.getState().setStatus(id, status),
    patchTask: (id, patch) => useStore.getState().patchTask(id, patch as never),
    removeTask: (id) => useStore.getState().removeTask(id),
    openInspector: (id) => useStore.getState().openInspector(id),
    startFocus: (id, minutes) => useStore.getState().startFocus(id, minutes),
    navigate: (route) => useStore.getState().navigate(route as never),
    runSearch: (query) => useStore.getState().runSearch(query),
    toast: (kind, message) => useStore.getState().toast(kind, message),
    refresh: () => refresh?.(),
  };

  /**
   * Opens `items` at the cursor.
   *
   * Stops the event so the window-level handler does not replace this menu
   * with the generic one - that listener only acts on events nobody claimed.
   */
  const open = useCallback(
    (event: React.MouseEvent, items: MenuItem[]) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(event.clientX, event.clientY, items);
    },
    [openContextMenu],
  );

  return { open, ctx };
}
