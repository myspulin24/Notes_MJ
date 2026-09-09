/** The left rail: views, saved filters, areas and projects. */

import { useState } from 'react';

import { api } from '../lib/api';
import { areaMenu, filterMenu, projectMenu } from '../lib/menus';
import type { SidebarActions } from '../lib/menus';
import { useMenu } from '../lib/useMenu';
import type { Counts, ViewName } from '../lib/types';
import { useStore } from '../state/store';
import type { Route } from '../state/store';
import {
  ArchiveIcon,
  GiftIcon,
  GridIcon,
  NoteIcon,
  BoxIcon,
  CalendarIcon,
  InboxIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  TargetIcon,
} from './Icons';

const VIEWS: { view: ViewName; label: string; icon: JSX.Element; countKey: keyof Counts }[] = [
  { view: 'inbox', label: 'Doručené', icon: <InboxIcon />, countKey: 'inbox' },
  { view: 'today', label: 'Dnes', icon: <StarIcon />, countKey: 'today' },
  { view: 'upcoming', label: 'Nadcházející', icon: <CalendarIcon />, countKey: 'upcoming' },
  { view: 'anytime', label: 'Kdykoli', icon: <LayersIcon />, countKey: 'anytime' },
  { view: 'someday', label: 'Někdy', icon: <BoxIcon />, countKey: 'someday' },
  { view: 'completed', label: 'Dokončené', icon: <ArchiveIcon />, countKey: 'completed' },
];

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const {
    route,
    counts,
    areas,
    projects,
    savedFilters,
    navigate,
    runSearch,
    toast,
    reportError,
    refreshSidebar,
    refresh,
    notify,
  } = useStore();
  const [adding, setAdding] = useState<'area' | 'project' | null>(null);
  const [draft, setDraft] = useState('');
  const settings = useStore((s) => s.settings);
  const showCounts = settings?.show_sidebar_counts ?? true;
  const showHints = settings?.show_keyboard_hints ?? true;
  const menu = useMenu(refreshSidebar);

  /**
   * The right-click actions for the rail.
   *
   * They all go through one object so the toast, the sidebar reload and the
   * undo offer read the same whichever item was clicked - and so that deleting
   * the thing you are standing in moves you somewhere that still exists.
   */
  const actions: SidebarActions = {
    renameProject: async (project, name) => {
      try {
        await api.updateProject(project.id, { title: name });
        await refreshSidebar();
        toast('success', `Projekt přejmenován na „${name}“.`);
      } catch (error) {
        reportError(error, 'Projekt se nepodařilo přejmenovat');
      }
    },
    completeProject: async (project) => {
      try {
        await api.setProjectStatus(project.id, 'completed');
        await refreshSidebar();
        await refresh();
        void notify('project.completed', 'Projekt dokončen', project.name);
        toast('success', `Projekt „${project.name}“ je dokončený.`, {
          label: 'Zpět',
          run: () => void useStore.getState().undo(),
        });
      } catch (error) {
        reportError(error, 'Projekt se nepodařilo dokončit');
      }
    },
    deleteProject: async (project) => {
      try {
        await api.deleteProject(project.id);
        if (route.kind === 'project' && route.id === project.id) {
          await navigate({ kind: 'view', view: 'today' });
        }
        await refreshSidebar();
        await refresh();
        toast('success', `Projekt „${project.name}“ smazán.`, {
          label: 'Zpět',
          run: () => void useStore.getState().undo(),
        });
      } catch (error) {
        reportError(error, 'Projekt se nepodařilo smazat');
      }
    },
    renameArea: async (area, name) => {
      try {
        await api.renameArea(area.id, name);
        await refreshSidebar();
        toast('success', `Oblast přejmenována na „${name}“.`);
      } catch (error) {
        reportError(error, 'Oblast se nepodařilo přejmenovat');
      }
    },
    deleteArea: async (area) => {
      try {
        await api.deleteArea(area.id);
        if (route.kind === 'area' && route.id === area.id) {
          await navigate({ kind: 'view', view: 'today' });
        }
        await refreshSidebar();
        await refresh();
        toast('success', `Oblast „${area.name}“ smazána.`, {
          label: 'Zpět',
          run: () => void useStore.getState().undo(),
        });
      } catch (error) {
        reportError(error, 'Oblast se nepodařilo smazat');
      }
    },
    deleteFilter: async (filter) => {
      try {
        await api.deleteSavedFilter(filter.id);
        await refreshSidebar();
        toast('success', `Uložený filtr „${filter.name}“ smazán.`);
      } catch (error) {
        reportError(error, 'Filtr se nepodařilo smazat');
      }
    },
  };

  const isActive = (candidate: Route) => {
    if (route.kind !== candidate.kind) return false;
    if (route.kind === 'view' && candidate.kind === 'view') return route.view === candidate.view;
    if (route.kind === 'project' && candidate.kind === 'project') return route.id === candidate.id;
    if (route.kind === 'area' && candidate.kind === 'area') return route.id === candidate.id;
    return false;
  };

  const submitDraft = async () => {
    const name = draft.trim();
    if (!name) {
      setAdding(null);
      setDraft('');
      return;
    }
    try {
      if (adding === 'area') {
        const area = await api.createArea(name);
        toast('success', `Oblast „${area.name}“ přidána.`);
        void notify('area.created', 'Nová oblast', area.name);
        await refreshSidebar();
        await navigate({ kind: 'area', id: area.id });
      } else {
        const project = await api.createProject(name, null);
        toast('success', `Projekt „${project.name}“ přidán.`);
        void notify('project.created', 'Nový projekt', project.name);
        await refreshSidebar();
        await navigate({ kind: 'project', id: project.id });
      }
      setAdding(null);
      setDraft('');
    } catch (error) {
      reportError(error, 'Nepodařilo se to vytvořit');
    }
  };

  return (
    <nav className="sidebar" aria-label="Pohledy a projekty">
      <div className="sidebar-scroll">
        <button
          type="button"
          className="search-trigger"
          onClick={() => void runSearch('')}
        >
          <SearchIcon size={15} />
          <span>Hledat</span>
          {showHints ? <kbd>Ctrl K</kbd> : null}
        </button>

        <ul className="nav-list">
          <li>
            <button
              type="button"
              className={`nav-item${route.kind === 'dashboard' ? ' active' : ''}`}
              onClick={() => void navigate({ kind: 'dashboard' })}
            >
              <span className="nav-icon icon-dashboard">
                <GridIcon />
              </span>
              <span className="nav-label">Přehled</span>
              {showHints ? <kbd>D</kbd> : null}
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`nav-item${route.kind === 'calendar' ? ' active' : ''}`}
              onClick={() => void navigate({ kind: 'calendar' })}
            >
              <span className="nav-icon icon-upcoming">
                <CalendarIcon />
              </span>
              <span className="nav-label">Kalendář</span>
              {showHints ? <kbd>C</kbd> : null}
            </button>
          </li>
        </ul>

        <ul className="nav-list">
          {VIEWS.map(({ view, label, icon, countKey }) => {
            const count = counts?.[countKey] ?? 0;
            const overdue = view === 'today' ? (counts?.overdue ?? 0) : 0;
            return (
              <li key={view}>
                <button
                  type="button"
                  className={`nav-item${isActive({ kind: 'view', view }) ? ' active' : ''}`}
                  onClick={() => void navigate({ kind: 'view', view })}
                >
                  <span className={`nav-icon icon-${view}`}>{icon}</span>
                  <span className="nav-label">{label}</span>
                  {showCounts && overdue > 0 ? (
                    <span className="badge overdue" title={`${overdue} po termínu`}>
                      {overdue}
                    </span>
                  ) : null}
                  {showCounts && count > 0 && view !== 'completed' ? (
                    <span className="badge">{count}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {savedFilters.length ? (
          <>
            <h3 className="nav-head">Uložené filtry</h3>
            <ul className="nav-list">
              {savedFilters.map((filter) => (
                <li key={filter.id}>
                  <button
                    type="button"
                    className={`nav-item${
                      route.kind === 'search' && route.query === filter.query ? ' active' : ''
                    }`}
                    onClick={() => void runSearch(filter.query)}
                    onContextMenu={(e) => menu.open(e, filterMenu(filter, menu.ctx, actions))}
                    title={filter.query}
                  >
                    <span className="nav-icon">
                      <TargetIcon size={16} />
                    </span>
                    <span className="nav-label">{filter.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <h3 className="nav-head">Plánovač</h3>
        <ul className="nav-list">
          <li>
            <button
              type="button"
              className={`nav-item${route.kind === 'notes' ? ' active' : ''}`}
              onClick={() => void navigate({ kind: 'notes' })}
            >
              <span className="nav-icon">
                <NoteIcon size={16} />
              </span>
              <span className="nav-label">Zápisník</span>
              {showHints ? <kbd>Z</kbd> : null}
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`nav-item${
                route.kind === 'occasions' || route.kind === 'occasion' ? ' active' : ''
              }`}
              onClick={() => void navigate({ kind: 'occasions' })}
            >
              <span className="nav-icon icon-gift">
                <GiftIcon size={16} />
              </span>
              <span className="nav-label">Události a dárky</span>
              {showHints ? <kbd>U</kbd> : null}
            </button>
          </li>
        </ul>

        <h3 className="nav-head">
          Oblasti
          <button
            type="button"
            className="icon-btn"
            title="Nová oblast"
            aria-label="Nová oblast"
            onClick={() => {
              setAdding('area');
              setDraft('');
            }}
          >
            <PlusIcon size={14} />
          </button>
        </h3>
        <ul className="nav-list">
          {areas.map((area) => (
            <li key={area.id}>
              <button
                type="button"
                className={`nav-item${isActive({ kind: 'area', id: area.id }) ? ' active' : ''}`}
                onClick={() => void navigate({ kind: 'area', id: area.id })}
                onContextMenu={(e) => menu.open(e, areaMenu(area, menu.ctx, actions))}
                title="Pravým tlačítkem otevřete nabídku"
              >
                <span className="nav-icon">
                  <LayersIcon size={16} />
                </span>
                <span className="nav-label">{area.name}</span>
              </button>
            </li>
          ))}
          {!areas.length && adding !== 'area' ? (
            <li className="nav-hint">Oblasti seskupují trvalé části vašeho života.</li>
          ) : null}
        </ul>

        <h3 className="nav-head">
          Projekty
          <button
            type="button"
            className="icon-btn"
            title="Nový projekt"
            aria-label="Nový projekt"
            onClick={() => {
              setAdding('project');
              setDraft('');
            }}
          >
            <PlusIcon size={14} />
          </button>
        </h3>
        <ul className="nav-list">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className={`nav-item${
                  isActive({ kind: 'project', id: project.id }) ? ' active' : ''
                }`}
                onClick={() => void navigate({ kind: 'project', id: project.id })}
                onContextMenu={(e) => menu.open(e, projectMenu(project, menu.ctx, actions))}
                title="Pravým tlačítkem otevřete nabídku"
              >
                <span className="nav-icon">
                  <ArchiveIcon size={16} />
                </span>
                <span className="nav-label">{project.name}</span>
              </button>
            </li>
          ))}
          {!projects.length && adding !== 'project' ? (
            <li className="nav-hint">Projekt je cokoli, co má víc než jeden krok.</li>
          ) : null}
        </ul>

        {adding ? (
          <form
            className="sidebar-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitDraft();
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={200}
              placeholder={adding === 'area' ? 'Název oblasti' : 'Název projektu'}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void submitDraft()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setAdding(null);
                  setDraft('');
                }
              }}
            />
          </form>
        ) : null}
      </div>

      <button type="button" className="nav-item settings" onClick={onOpenSettings}>
        <span className="nav-icon">
          <SettingsIcon size={16} />
        </span>
        <span className="nav-label">Nastavení a data</span>
      </button>
    </nav>
  );
}
