/** The search field, with a plain-English readback and "save this filter". */

import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api';
import { describeQuery, isEmptyQuery, parseQuery } from '../lib/query';
import { useStore } from '../state/store';
import { CloseIcon, SearchIcon, TrashIcon } from './Icons';

export function SearchBar({ onClose }: { onClose: () => void }) {
  const {
    searchInput,
    setSearchInput,
    runSearch,
    today,
    savedFilters,
    refreshSidebar,
    toast,
    reportError,
  } = useStore();
  const [naming, setNaming] = useState(false);
  const [filterName, setFilterName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Debounce so a long query does not run a search per keystroke.
  useEffect(() => {
    const id = setTimeout(() => void runSearch(searchInput), 180);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const parsed = parseQuery(searchInput, today);
  const current = savedFilters.find((f) => f.query === searchInput.trim());

  return (
    <div className="searchbar">
      <div className="searchbar-input">
        <SearchIcon size={16} />
        <input
          ref={inputRef}
          value={searchInput}
          maxLength={500}
          placeholder="Hledejte, nebo použijte štítek: projekt: termín: stav: priorita:"
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          aria-label="Hledat"
        />
        {searchInput ? (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSearchInput('')}
            aria-label="Vymazat hledání"
          >
            <CloseIcon size={15} />
          </button>
        ) : null}
      </div>

      <div className="searchbar-meta">
        <span className="muted">{describeQuery(parsed)}</span>

        {parsed.unknown.length ? (
          <span className="warn">
            Ignorováno: {parsed.unknown.join(', ')}
          </span>
        ) : null}

        {current ? (
          <button
            type="button"
            className="link"
            onClick={async () => {
              try {
                await api.deleteSavedFilter(current.id);
                await refreshSidebar();
                toast('success', `Filtr „${current.name}“ odebrán.`);
              } catch (e) {
                reportError(e, 'Filtr se nepodařilo odebrat');
              }
            }}
          >
            <TrashIcon size={13} /> Odebrat uložený filtr
          </button>
        ) : !isEmptyQuery(parsed) ? (
          naming ? (
            <form
              className="save-filter"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = filterName.trim();
                if (!name) return;
                try {
                  await api.saveFilter(name, searchInput.trim());
                  await refreshSidebar();
                  setNaming(false);
                  setFilterName('');
                  toast('success', `Filtr „${name}“ uložen do postranního panelu.`);
                } catch (err) {
                  reportError(err, 'Filtr se nepodařilo uložit');
                }
              }}
            >
              <input
                autoFocus
                value={filterName}
                maxLength={200}
                placeholder="Pojmenujte filtr"
                onChange={(e) => setFilterName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setNaming(false);
                }}
              />
              <button type="submit" className="btn small primary">
                Uložit
              </button>
            </form>
          ) : (
            <button type="button" className="link" onClick={() => setNaming(true)}>
              Uložit tento filtr
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
