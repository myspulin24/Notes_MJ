/**
 * "Nastavení a data".
 *
 * Two halves: the preferences (tabbed, because there are a lot of them now)
 * and the data management that was here before — where the database lives,
 * export, import, backups.
 *
 * Every control writes through to the backend immediately. The backend clamps
 * and normalises, and we store what it returns, so the panel can never show a
 * value that was not actually kept.
 */

import { useEffect, useState } from 'react';

import {
  api,
  pickDirectory,
  pickFile,
  pickSavePath,
  revealInExplorer,
  toAppError,
} from '../lib/api';
import { formatBytes, formatTimestamp, plural, today as localToday } from '../lib/dates';
import type { Settings } from '../lib/planner-types';
import type { AppError, BackupInfo, Health, ImportSummary } from '../lib/types';
import { useStore } from '../state/store';
import { CloseIcon } from './Icons';
import { NotificationSettings } from './NotificationSettings';
import { UpdatePanel } from './UpdatePanel';
import { InlineError, LoadingState } from './States';

type Busy = null | 'export' | 'bundle' | 'import' | 'backup';

type Tab =
  | 'appearance'
  | 'behaviour'
  | 'calendar'
  | 'focus'
  | 'notifications'
  | 'dashboard'
  | 'gifts'
  | 'data';

const TABS: { id: Tab; label: string }[] = [
  { id: 'appearance', label: 'Vzhled' },
  { id: 'behaviour', label: 'Chování' },
  { id: 'calendar', label: 'Kalendář' },
  { id: 'focus', label: 'Soustředění' },
  { id: 'notifications', label: 'Připomínky a aplikace' },
  { id: 'dashboard', label: 'Přehled' },
  { id: 'gifts', label: 'Dárky' },
  { id: 'data', label: 'Data' },
];

const ACCENTS = [
  '#4f7cff', '#12a594', '#e5484d', '#f76b15',
  '#8e4ec6', '#d6409f', '#0090ff', '#46a758',
];

const DASHBOARD_CARDS: { id: string; label: string }[] = [
  { id: 'today', label: 'Dnes' },
  { id: 'overdue', label: 'Po termínu' },
  { id: 'week', label: 'Příštích 7 dní' },
  { id: 'progress', label: 'Projekty' },
  { id: 'occasions', label: 'Blíží se' },
  { id: 'notes', label: 'Připnuté poznámky' },
  { id: 'streak', label: 'Aktivita' },
  { id: 'inbox', label: 'Doručené' },
];

/**
 * The database's file name as it is on disk right now.
 *
 * Read off the real path rather than written out here, because the name has
 * changed once already: telling someone to rename their backup over a file
 * that is not what their copy actually uses is worse than saying nothing.
 */
function databaseFileName(dbPath: string | undefined): string {
  const name = (dbPath ?? '').split(/[\\/]/).pop();
  return name && name.length > 0 ? name : 'notes_mj.db';
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const {
    boot,
    settings,
    saveSettings,
    resetSettings,
    toast,
    reportError,
    refresh,
    refreshSidebar,
    bumpPlanner,
    notify,
  } = useStore();

  const [tab, setTab] = useState<Tab>('appearance');
  const [health, setHealth] = useState<Health | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [pending, setPending] = useState<{ path: string; summary: ImportSummary } | null>(null);
  const [importSettings, setImportSettings] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, b] = await Promise.all([api.health(), api.listBackups()]);
      setHealth(h);
      setBackups(b);
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  /** Applies one change and persists the whole object. */
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    if (!settings) return;
    void saveSettings({ ...settings, [key]: value }).then((ok) => {
      if (ok) bumpPlanner();
    });
  };

  const exportJson = async () => {
    const path = await pickSavePath({
      title: 'Export vašich úkolů',
      defaultPath: `notes_mj-export-${localToday()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return;
    setBusy('export');
    try {
      const bytes = await api.exportJson(path);
      toast('success', `Exportováno ${formatBytes(bytes)} do ${path}.`);
      void notify('data.export_done', 'Export hotov', `${formatBytes(bytes)} do ${path}`);
    } catch (e) {
      reportError(e, 'Export se nezdařil');
    } finally {
      setBusy(null);
    }
  };

  const exportBundle = async () => {
    const dir = await pickDirectory('Vyberte, kam umístit složku s exportem');
    if (!dir) return;
    setBusy('bundle');
    try {
      const folder = await api.exportBundle(dir);
      toast('success', `Vše včetně příloh exportováno do ${folder}.`);
      void notify('data.export_done', 'Export hotov', folder);
      void revealInExplorer(folder);
    } catch (e) {
      reportError(e, 'Export se nezdařil');
    } finally {
      setBusy(null);
    }
  };

  const chooseImport = async () => {
    const path = await pickFile({
      title: 'Vyberte export z Notes_MJ',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return;
    try {
      setPending({ path, summary: await api.inspectImport(path) });
    } catch (e) {
      reportError(e, 'Tento soubor nelze importovat');
    }
  };

  const runImport = async (mode: 'merge' | 'replace') => {
    if (!pending) return;
    setBusy('import');
    try {
      const report = await api.importJson(pending.path, mode, importSettings);
      setPending(null);
      await refresh();
      await refreshSidebar();
      bumpPlanner();
      await load();
      const added =
        report.tasks +
        report.projects +
        report.areas +
        report.tags +
        report.saved_filters +
        report.notes +
        report.occasions +
        report.gifts;
      toast(
        'success',
        `Importováno ${report.tasks} ${plural(report.tasks, 'úkol', 'úkoly', 'úkolů')} a ` +
          `${added - report.tasks} ${plural(added - report.tasks, 'další položka', 'další položky', 'dalších položek')}.` +
          (report.skipped_existing
            ? ` Přeskočeno ${report.skipped_existing} již existujících.`
            : ''),
      );
      void notify(
        'data.import_done',
        'Import hotov',
        `Načteno ${report.tasks} úkolů a ${added - report.tasks} dalších položek.`,
      );
      if (report.settings_applied) toast('info', 'Nastavení bylo převzato ze souboru.');
      for (const warning of report.warnings) toast('info', warning);
    } catch (e) {
      reportError(e, 'Import se nezdařil');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Nastavení a data">
        <header className="modal-head">
          <h2>Nastavení a data</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Zavřít">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-tabs" aria-label="Sekce nastavení">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`settings-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="modal-body">
            {!settings ? (
              <LoadingState label="Načítám nastavení" />
            ) : (
              <>
                {tab === 'appearance' ? (
                  <>
                    <Section title="Motiv">
                      <Choice
                        label="Barevný motiv"
                        value={settings.theme}
                        options={[
                          ['system', 'Podle systému'],
                          ['light', 'Světlý'],
                          ['dark', 'Tmavý'],
                        ]}
                        onChange={(v) => set('theme', v as Settings['theme'])}
                      />
                      <div className="field-block">
                        <span className="field-label">Barva zvýraznění</span>
                        <div className="swatches">
                          {ACCENTS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={`swatch${settings.accent === color ? ' on' : ''}`}
                              style={{ background: color }}
                              aria-label={`Barva ${color}`}
                              aria-pressed={settings.accent === color}
                              onClick={() => set('accent', color)}
                            />
                          ))}
                          <input
                            type="color"
                            className="swatch custom"
                            value={settings.accent}
                            onChange={(e) => set('accent', e.target.value)}
                            aria-label="Vlastní barva"
                          />
                        </div>
                      </div>
                      <Choice
                        label="Hustota"
                        hint="Jak našlapané jsou seznamy."
                        value={settings.density}
                        options={[
                          ['comfortable', 'Vzdušná'],
                          ['cosy', 'Střední'],
                          ['compact', 'Kompaktní'],
                        ]}
                        onChange={(v) => set('density', v as Settings['density'])}
                      />
                      <Range
                        label="Velikost písma"
                        value={settings.font_scale}
                        min={0.85}
                        max={1.4}
                        step={0.05}
                        format={(v) => `${Math.round(v * 100)} %`}
                        onChange={(v) => set('font_scale', v)}
                      />
                    </Section>

                    <Section title="Rozhraní">
                      <Toggle
                        label="Počty v postranním panelu"
                        checked={settings.show_sidebar_counts}
                        onChange={(v) => set('show_sidebar_counts', v)}
                      />
                      <Toggle
                        label="Nápovědy ke klávesovým zkratkám"
                        checked={settings.show_keyboard_hints}
                        onChange={(v) => set('show_keyboard_hints', v)}
                      />
                      <Toggle
                        label="Omezit animace"
                        hint="Vypne přechody a pohyb. Vhodné i při citlivosti na pohyb."
                        checked={settings.reduce_motion}
                        onChange={(v) => set('reduce_motion', v)}
                      />
                    </Section>
                  </>
                ) : null}

                {tab === 'behaviour' ? (
                  <>
                    <Section title="Start">
                      <Choice
                        label="Po spuštění zobrazit"
                        value={settings.start_view}
                        options={[
                          ['dashboard', 'Přehled'],
                          ['today', 'Dnes'],
                          ['inbox', 'Doručené'],
                          ['upcoming', 'Nadcházející'],
                          ['calendar', 'Kalendář'],
                          ['notes', 'Zápisník'],
                          ['occasions', 'Události'],
                          ['last_used', 'Naposledy otevřené'],
                        ]}
                        onChange={(v) => set('start_view', v as Settings['start_view'])}
                      />
                      <Choice
                        label="Týden začíná"
                        value={String(settings.first_weekday)}
                        options={[
                          ['0', 'Pondělím'],
                          ['6', 'Nedělí'],
                          ['5', 'Sobotou'],
                        ]}
                        onChange={(v) => set('first_weekday', Number(v))}
                      />
                    </Section>

                    <Section title="Seznamy">
                      <Choice
                        label="Výchozí řazení"
                        value={settings.default_sort}
                        options={[
                          ['manual', 'Ruční pořadí'],
                          ['due_date', 'Podle termínu'],
                          ['priority', 'Podle priority'],
                          ['alphabetical', 'Abecedně'],
                          ['created_newest', 'Nejnovější první'],
                          ['created_oldest', 'Nejstarší první'],
                        ]}
                        onChange={(v) => set('default_sort', v as Settings['default_sort'])}
                      />
                      <Toggle
                        label="Ptát se před smazáním"
                        checked={settings.confirm_delete}
                        onChange={(v) => set('confirm_delete', v)}
                      />
                      <Toggle
                        label="Zobrazovat dokončené v seznamech"
                        checked={settings.show_completed_in_lists}
                        onChange={(v) => set('show_completed_in_lists', v)}
                      />
                      <Toggle
                        label="Zařazení vyndá úkol z Doručených"
                        hint="Jakmile úkolu přiřadíte projekt nebo oblast, opustí Doručené."
                        checked={settings.filing_leaves_inbox}
                        onChange={(v) => set('filing_leaves_inbox', v)}
                      />
                      <NumberField
                        label="Velikost stránky archivu"
                        value={settings.archive_page_size}
                        min={20}
                        max={1000}
                        step={20}
                        onChange={(v) => set('archive_page_size', v)}
                      />
                      <NumberField
                        label="Skrýt dokončené starší než (dní)"
                        hint="0 znamená nic neskrývat."
                        value={settings.auto_archive_days}
                        min={0}
                        max={3650}
                        onChange={(v) => set('auto_archive_days', v)}
                      />
                    </Section>

                    <Section title="Dnes a Nadcházející">
                      <Toggle
                        label="Zahrnout do Dneška úkoly po termínu"
                        checked={settings.today_includes_overdue}
                        onChange={(v) => set('today_includes_overdue', v)}
                      />
                      <Toggle
                        label="Po termínu řadit nahoru"
                        checked={settings.overdue_first}
                        onChange={(v) => set('overdue_first', v)}
                      />
                      <NumberField
                        label="Nadcházející zobrazuje dní dopředu"
                        value={settings.upcoming_days}
                        min={7}
                        max={365}
                        onChange={(v) => set('upcoming_days', v)}
                      />
                      <Toggle
                        label="Skrýt víkendy v Nadcházejících"
                        checked={settings.hide_weekends_in_upcoming}
                        onChange={(v) => set('hide_weekends_in_upcoming', v)}
                      />
                    </Section>
                  </>
                ) : null}

                {tab === 'calendar' ? (
                  <Section title="Kalendář">
                    <Toggle
                      label="Zobrazovat víkendy"
                      checked={settings.calendar_show_weekends}
                      onChange={(v) => set('calendar_show_weekends', v)}
                    />
                    <Toggle
                      label="Zobrazovat čísla týdnů"
                      checked={settings.calendar_show_week_numbers}
                      onChange={(v) => set('calendar_show_week_numbers', v)}
                    />
                    <Toggle
                      label="Zobrazovat dokončené úkoly"
                      checked={settings.calendar_show_completed}
                      onChange={(v) => set('calendar_show_completed', v)}
                    />
                    <Toggle
                      label="Zobrazovat události (narozeniny, Vánoce)"
                      checked={settings.calendar_show_occasions}
                      onChange={(v) => set('calendar_show_occasions', v)}
                    />
                    <p className="hint">
                      Začátek týdne se nastavuje v sekci Chování a platí i pro kalendář.
                    </p>
                  </Section>
                ) : null}

                {tab === 'focus' ? (
                  <Section title="Soustředěná práce">
                    <NumberField
                      label="Výchozí délka (minut)"
                      value={settings.focus_minutes}
                      min={1}
                      max={180}
                      onChange={(v) => set('focus_minutes', v)}
                    />
                    <NumberField
                      label="Délka přestávky (minut)"
                      value={settings.focus_break_minutes}
                      min={1}
                      max={60}
                      onChange={(v) => set('focus_break_minutes', v)}
                    />
                    <div className="field-block">
                      <span className="field-label">Rychlá tlačítka</span>
                      <div className="preset-row">
                        {[5, 10, 15, 20, 25, 30, 45, 60, 90].map((m) => {
                          const on = settings.focus_presets.includes(m);
                          return (
                            <button
                              key={m}
                              type="button"
                              className={`btn subtle${on ? ' on' : ''}`}
                              aria-pressed={on}
                              onClick={() =>
                                set(
                                  'focus_presets',
                                  on
                                    ? settings.focus_presets.filter((p) => p !== m)
                                    : [...settings.focus_presets, m].sort((a, b) => a - b),
                                )
                              }
                            >
                              {m}
                            </button>
                          );
                        })}
                      </div>
                      <p className="hint">Nejvýše šest. Prázdný výběr se vrátí na 10/25/45.</p>
                    </div>
                    <Toggle
                      label="Oznámit konec systémovým oznámením"
                      hint="Když je vypnuté, Notes_MJ to řekne přímo v okně."
                      checked={settings.focus_notify}
                      onChange={(v) => set('focus_notify', v)}
                    />
                    <Toggle
                      label="Po doběhnutí úkol rovnou dokončit"
                      checked={settings.focus_complete_on_finish}
                      onChange={(v) => set('focus_complete_on_finish', v)}
                    />
                  </Section>
                ) : null}

                {tab === 'notifications' ? (
                  <>
                    <UpdatePanel />
                    <Section title="Aktualizace">
                      <Toggle
                        label="Hledat novou verzi po spuštění"
                        checked={settings.updates_check_on_start}
                        onChange={(v) => set('updates_check_on_start', v)}
                        hint="Zeptá se GitHubu pár vteřin po otevření okna. Vypnuté znamená, že se aktualizace hledají jen tlačítkem."
                      />
                      <Toggle
                        label="Stáhnout aktualizaci automaticky"
                        checked={settings.updates_auto_download}
                        onChange={(v) => set('updates_auto_download', v)}
                        hint="Nová verze se stáhne hned na pozadí, takže zbývá jen kliknout na Restartovat. Instaluje se vždy až na váš pokyn."
                      />
                    </Section>
                    <NotificationSettings settings={settings} set={set} />
                  </>
                ) : null}

                {tab === 'dashboard' ? (
                  <Section title="Přehled">
                    <Toggle
                      label="Pozdrav a datum nahoře"
                      checked={settings.dashboard_show_greeting}
                      onChange={(v) => set('dashboard_show_greeting', v)}
                    />
                    <div className="field-block">
                      <span className="field-label">Karty a jejich pořadí</span>
                      <ul className="card-picker">
                        {DASHBOARD_CARDS.map((card) => {
                          const index = settings.dashboard_cards.indexOf(card.id);
                          const on = index >= 0;
                          return (
                            <li key={card.id}>
                              <label className="check-label">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() =>
                                    set(
                                      'dashboard_cards',
                                      on
                                        ? settings.dashboard_cards.filter((c) => c !== card.id)
                                        : [...settings.dashboard_cards, card.id],
                                    )
                                  }
                                />
                                {card.label}
                              </label>
                              {on ? (
                                <span className="card-order">
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    aria-label="Nahoru"
                                    disabled={index === 0}
                                    onClick={() =>
                                      set('dashboard_cards', move(settings.dashboard_cards, index, -1))
                                    }
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    aria-label="Dolů"
                                    disabled={index === settings.dashboard_cards.length - 1}
                                    onClick={() =>
                                      set('dashboard_cards', move(settings.dashboard_cards, index, 1))
                                    }
                                  >
                                    ↓
                                  </button>
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </Section>
                ) : null}

                {tab === 'gifts' ? (
                  <Section title="Dárky a peníze">
                    <div className="field-block">
                      <span className="field-label">Měna</span>
                      <input
                        value={settings.currency}
                        maxLength={8}
                        onChange={(e) => set('currency', e.target.value)}
                        aria-label="Měna"
                      />
                      <p className="hint">Jen popisek u částek, žádné převody kurzů.</p>
                    </div>
                    <Toggle
                      label="Skrýt ceny"
                      hint="Pro chvíle, kdy ukazujete obrazovku tomu, komu dárek kupujete."
                      checked={settings.gifts_hide_prices}
                      onChange={(v) => set('gifts_hide_prices', v)}
                    />
                  </Section>
                ) : null}

                {tab === 'data' ? (
                  loading ? (
                    <LoadingState label="Kontroluji vaše data" />
                  ) : error ? (
                    <InlineError error={error} onRetry={() => void load()} />
                  ) : (
                    <>
                      <Section title="Kde jsou vaše data">
                        <p className="muted">
                          Vše je v jedné složce v tomto počítači. Žádný účet, žádný server;
                          Notes_MJ vaše data nikam neposílá.
                        </p>
                        <dl className="kv">
                          <dt>Složka</dt>
                          <dd>
                            <code>{health?.data_dir}</code>
                            <button
                              type="button"
                              className="link"
                              onClick={() => void revealInExplorer(health?.db_path ?? '')}
                            >
                              Zobrazit v Průzkumníku
                            </button>
                          </dd>
                          <dt>Databáze</dt>
                          <dd>
                            <code>{databaseFileName(health?.db_path)}</code> ·{' '}
                            {formatBytes(health?.db_size_bytes ?? 0)}
                          </dd>
                          <dt>Přílohy</dt>
                          <dd>
                            {health?.attachments ?? 0}{' '}
                            {plural(health?.attachments ?? 0, 'soubor', 'soubory', 'souborů')}
                          </dd>
                          <dt>Kontrola integrity</dt>
                          <dd>
                            {health?.integrity === 'ok' ? (
                              <span className="ok">V pořádku</span>
                            ) : (
                              <span className="warn">{health?.integrity}</span>
                            )}
                          </dd>
                          <dt>Verze</dt>
                          <dd>Notes_MJ {boot?.app_version}</dd>
                        </dl>
                      </Section>

                      <Section title="Export">
                        <p className="muted">
                          Čitelný, zdokumentovaný soubor JSON. Popis polí najdete
                          v <code>docs/EXPORT-FORMAT.md</code>.
                        </p>
                        <div className="button-row">
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void exportJson()}
                            disabled={busy !== null}
                          >
                            {busy === 'export' ? 'Exportuji…' : 'Exportovat JSON'}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void exportBundle()}
                            disabled={busy !== null}
                          >
                            {busy === 'bundle' ? 'Exportuji…' : 'Exportovat vše (i s přílohami)'}
                          </button>
                        </div>
                      </Section>

                      <Section title="Import">
                        {pending ? (
                          <div className="import-confirm">
                            <p>
                              <code>{pending.path}</code>
                            </p>
                            <p className="muted">
                              Exportováno {formatTimestamp(pending.summary.exported_at)} aplikací
                              Notes_MJ {pending.summary.app_version}. Obsahuje {pending.summary.tasks}{' '}
                              {plural(pending.summary.tasks, 'úkol', 'úkoly', 'úkolů')},{' '}
                              {pending.summary.projects}{' '}
                              {plural(pending.summary.projects, 'projekt', 'projekty', 'projektů')},{' '}
                              {pending.summary.areas}{' '}
                              {plural(pending.summary.areas, 'oblast', 'oblasti', 'oblastí')}.
                            </p>
                            <div className="button-row">
                              <button
                                type="button"
                                className="btn primary"
                                onClick={() => void runImport('merge')}
                                disabled={busy !== null}
                              >
                                {busy === 'import' ? 'Importuji…' : 'Sloučit s tím, co mám'}
                              </button>
                              <button
                                type="button"
                                className="btn danger"
                                onClick={() => void runImport('replace')}
                                disabled={busy !== null}
                              >
                                Nahradit vše
                              </button>
                              <button type="button" className="btn" onClick={() => setPending(null)}>
                                Zrušit
                              </button>
                            </div>
                            <label className="check-label">
                              <input
                                type="checkbox"
                                checked={importSettings}
                                onChange={(e) => setImportSettings(e.target.checked)}
                              />
                              Převzít i nastavení ze souboru
                            </label>
                            <p className="hint">
                              Před nahrazením se udělá záloha a celou akci vrátíte jedním Ctrl+Z.
                              Nastavení se přenáší jen po zaškrtnutí výše.
                            </p>
                          </div>
                        ) : (
                          <>
                            <p className="muted">
                              Sloučení zachová vše, co už máte, a doplní, co chybí.
                            </p>
                            <button type="button" className="btn" onClick={() => void chooseImport()}>
                              Vybrat soubor…
                            </button>
                          </>
                        )}
                      </Section>

                      <Section title="Automatické zálohy">
                        <p className="muted">
                          Notes_MJ zkopíruje celou databázi do <code>backups</code> při startu
                          a před každou destruktivní akcí. Obnovíte ji tak, že aplikaci zavřete
                          a soubor zálohy přejmenujete na{' '}
                          <code>{databaseFileName(health?.db_path)}</code>.
                        </p>
                        <Toggle
                          label="Zálohovat při spuštění"
                          checked={settings.backup_on_start}
                          onChange={(v) => set('backup_on_start', v)}
                        />
                        <NullableNumber
                          label="Kolik záloh uchovat"
                          value={settings.backup_keep}
                          min={1}
                          max={1000}
                          placeholder="podle .env"
                          onChange={(v) => set('backup_keep', v)}
                        />
                        <NullableNumber
                          label="Minimální rozestup záloh (minut)"
                          value={settings.backup_interval_minutes}
                          min={0}
                          max={43200}
                          placeholder="podle .env"
                          onChange={(v) => set('backup_interval_minutes', v)}
                        />
                        <NullableNumber
                          label="Maximální velikost přílohy (MB)"
                          value={settings.max_attachment_mb}
                          min={1}
                          max={4096}
                          placeholder="podle .env"
                          onChange={(v) => set('max_attachment_mb', v)}
                        />
                        <div className="button-row">
                          <button
                            type="button"
                            className="btn"
                            disabled={busy !== null}
                            onClick={async () => {
                              setBusy('backup');
                              try {
                                const info = await api.backupNow();
                                toast('success', `Zálohováno do ${info.file_name}.`);
                                void notify('data.backup_done', 'Záloha hotova', info.file_name);
                                await load();
                              } catch (e) {
                                void notify(
                                  'data.backup_failed',
                                  'Zálohu se nepodařilo vytvořit',
                                  'Zkontrolujte volné místo na disku.',
                                );
                                reportError(e, 'Záloha se nezdařila');
                              } finally {
                                setBusy(null);
                              }
                            }}
                          >
                            {busy === 'backup' ? 'Zálohuji…' : 'Zálohovat teď'}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void revealInExplorer(boot?.backups_dir ?? '')}
                          >
                            Otevřít složku se zálohami
                          </button>
                        </div>
                        {backups.length ? (
                          <ul className="backup-list">
                            {backups.slice(0, 6).map((backup) => (
                              <li key={backup.file_name}>
                                <code>{backup.file_name}</code>
                                <span className="muted">{formatBytes(backup.size_bytes)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="hint">
                            Zatím žádné zálohy. První vznikne při příštím spuštění.
                          </p>
                        )}
                      </Section>

                      <Section title="Obnovit nastavení">
                        <p className="muted">
                          Vrátí všechny předvolby na výchozí hodnoty. Vašich úkolů, poznámek ani
                          událostí se to nedotkne.
                        </p>
                        <button
                          type="button"
                          className="btn danger"
                          onClick={() => {
                            if (window.confirm('Vrátit všechna nastavení na výchozí hodnoty?')) {
                              void resetSettings().then(() => bumpPlanner());
                            }
                          }}
                        >
                          Obnovit výchozí nastavení
                        </button>
                      </Section>
                    </>
                  )
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// -- reusable controls --------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="field-block">
      <label className="toggle-row">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track" aria-hidden="true">
          <span className="toggle-knob" />
        </span>
        <span className="toggle-label">{label}</span>
      </label>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

function Choice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="field-block">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field-block">
      <span className="field-label">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const parsed = Math.round(Number(e.target.value));
          if (Number.isFinite(parsed)) onChange(Math.max(min, Math.min(max, parsed)));
        }}
        aria-label={label}
      />
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

/** A number that can also be "unset", meaning: use the `.env` default. */
function NullableNumber({
  label,
  value,
  min,
  max,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  placeholder: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="field-block">
      <span className="field-label">{label}</span>
      <div className="field-row">
        <input
          type="number"
          value={value ?? ''}
          min={min}
          max={max}
          placeholder={placeholder}
          onChange={(e) => {
            if (!e.target.value.trim()) {
              onChange(null);
              return;
            }
            const parsed = Math.round(Number(e.target.value));
            if (Number.isFinite(parsed)) {
              onChange(Math.max(min, Math.min(max, parsed)));
            }
          }}
          aria-label={label}
        />
        {value !== null ? (
          <button type="button" className="link" onClick={() => onChange(null)}>
            Podle .env
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field-block">
      <span className="field-label">
        {label} <span className="muted">{format(value)}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  );
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
