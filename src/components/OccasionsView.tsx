/**
 * The occasion and gift planner: Christmas, birthdays, anniversaries.
 *
 * Each occasion is a countdown, a budget and a list of presents grouped by who
 * they are for. The money is worked out by the backend in minor units, so this
 * file only ever formats and parses — it never adds prices up itself.
 */

import { useCallback, useEffect, useState } from 'react';

import { openExternal, plannerApi, toAppError } from '../lib/api';
import { editableMenu, giftMenu, occasionMenu } from '../lib/menus';
import type { GiftActions, OccasionActions } from '../lib/menus';
import { useMenu } from '../lib/useMenu';
import { plural, relativeDateLabel } from '../lib/dates';
import { formatMinor, formatMinorShort, parseMinor, spentRatio } from '../lib/money';
import type {
  GiftIdea,
  GiftStatus,
  OccasionDetail,
  OccasionKind,
} from '../lib/planner-types';
import type { AppError } from '../lib/types';
import { useStore } from '../state/store';
import {
  CalendarIcon,
  CloseIcon,
  GiftIcon,
  LinkIcon,
  PlusIcon,
  TrashIcon,
} from './Icons';
import { EmptyState, ErrorState, LoadingState } from './States';

const KIND_LABELS: Record<OccasionKind, string> = {
  christmas: 'Vánoce',
  birthday: 'Narozeniny',
  anniversary: 'Výročí',
  nameday: 'Svátek',
  holiday: 'Svátek / volno',
  other: 'Jiné',
};

const STATUS_LABELS: Record<GiftStatus, string> = {
  idea: 'Nápad',
  decided: 'Rozhodnuto',
  bought: 'Koupeno',
  wrapped: 'Zabaleno',
  given: 'Předáno',
};

const STATUS_ORDER: GiftStatus[] = ['idea', 'decided', 'bought', 'wrapped', 'given'];

export function OccasionsView({ focusId }: { focusId?: string | null }) {
  const { today, settings, reportError, toast, bumpPlanner, navigate, notify } = useStore();

  const [occasions, setOccasions] = useState<OccasionDetail[]>([]);
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    kind: 'birthday' as OccasionKind,
    on_date: today,
    yearly: true,
  });
  const [giftDraft, setGiftDraft] = useState({ title: '', recipient: '' });
  const menu = useMenu(async () => {
    await load();
  });

  const currency = settings?.currency ?? 'Kč';

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await plannerApi.listOccasions(today);
      setOccasions(list);
      setOpenId((current) => current ?? list[0]?.id ?? null);
      return list;
    } catch (e) {
      setError(toAppError(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (focusId) setOpenId(focusId);
  }, [focusId]);

  const open = occasions.find((o) => o.id === openId) ?? null;

  const patchOccasion = async (id: string, patch: Parameters<typeof plannerApi.updateOccasion>[1]) => {
    try {
      await plannerApi.updateOccasion(id, patch, today);
      await load();
      bumpPlanner();
    } catch (e) {
      reportError(e, 'Událost se nepodařilo upravit');
    }
  };

  const patchGift = async (id: string, patch: Parameters<typeof plannerApi.updateGift>[1]) => {
    try {
      const updated = await plannerApi.updateGift(id, patch);
      const list = await load();
      bumpPlanner();

      // Buying something is the moment worth announcing, and the moment the
      // budget can tip over.
      if (patch.status && updated.status === 'bought') {
        void notify('gift.bought', 'Dárek koupen', `${updated.title} pro ${updated.recipient || 'nikoho'}`);
      }
      const owner = list.find((o) => o.id === updated.occasion_id);
      if (owner && owner.remaining_minor !== null && owner.remaining_minor < 0) {
        void notify(
          'gift.budget_exceeded',
          `Rozpočet překročen: ${owner.name}`,
          `O ${formatMinor(Math.abs(owner.remaining_minor), currency)}.`,
        );
      }
    } catch (e) {
      reportError(e, 'Dárek se nepodařilo upravit');
    }
  };

  const removeOccasion = async (occasion: OccasionDetail) => {
    try {
      await plannerApi.deleteOccasion(occasion.id);
      setOpenId((current) => (current === occasion.id ? null : current));
      await load();
      bumpPlanner();
      toast('success', `Událost „${occasion.name}“ smazána.`, {
        label: 'Zpět',
        run: () => void useStore.getState().undo().then(() => load()),
      });
    } catch (e) {
      reportError(e, 'Událost se nepodařilo smazat');
    }
  };

  const removeGift = async (gift: GiftIdea) => {
    try {
      await plannerApi.deleteGift(gift.id);
      await load();
      bumpPlanner();
    } catch (e) {
      reportError(e, 'Dárek se nepodařilo smazat');
    }
  };

  const occasionActions: OccasionActions = {
    open: (occasion) => setOpenId(occasion.id),
    remove: removeOccasion,
  };

  const giftActions: GiftActions = {
    setStatus: (gift, status) => patchGift(gift.id, { status }),
    openLink: async (gift) => {
      const opened = await openExternal(gift.url);
      if (!opened) toast('info', 'Odkaz se nepodařilo otevřít.');
    },
    remove: removeGift,
  };

  if (loading && !occasions.length) return <LoadingState label="Načítám události" />;
  if (error && !occasions.length) {
    return <ErrorState error={error} onRetry={() => void load()} />;
  }

  return (
    <div className="occasions-pane">
      <div className="occasion-list">
        <header className="notes-head">
          <h2>Události</h2>
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            <PlusIcon size={15} />
            Nová
          </button>
        </header>

        {adding ? (
          <form
            className="occasion-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!draft.name.trim()) return;
              try {
                const created = await plannerApi.createOccasion(
                  draft.name.trim(),
                  draft.kind,
                  draft.on_date,
                  draft.yearly,
                  today,
                );
                setAdding(false);
                setDraft({ name: '', kind: 'birthday', on_date: today, yearly: true });
                await load();
                setOpenId(created.id);
                bumpPlanner();
                void notify(
                  'occasion.created',
                  'Nová událost',
                  `${created.name} — ${countdown(created.days_until)}`,
                );
              } catch (err) {
                reportError(err, 'Událost se nepodařilo vytvořit');
              }
            }}
          >
            <input
              autoFocus
              value={draft.name}
              maxLength={200}
              placeholder="Např. Vánoce nebo Petra – narozeniny"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              aria-label="Název události"
            />
            <div className="field-row">
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as OccasionKind })}
                aria-label="Druh události"
              >
                {STATUS_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={draft.on_date}
                onChange={(e) => setDraft({ ...draft, on_date: e.target.value })}
                aria-label="Datum"
              />
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={draft.yearly}
                onChange={(e) => setDraft({ ...draft, yearly: e.target.checked })}
              />
              Opakuje se každý rok
            </label>
            <p className="hint">
              U narozenin klidně zadejte rok narození – Notes_MJ spočítá nejbližší výskyt.
            </p>
            <div className="field-row">
              <button type="submit" className="btn primary" disabled={!draft.name.trim()}>
                Vytvořit
              </button>
              <button type="button" className="btn" onClick={() => setAdding(false)}>
                Zrušit
              </button>
            </div>
          </form>
        ) : null}

        {occasions.length === 0 && !adding ? (
          <EmptyState
            icon={<GiftIcon size={30} />}
            title="Žádné události"
            hint="Přidejte Vánoce, narozeniny nebo výročí a pište si k nim, co chcete koupit."
            action={
              <button type="button" className="btn primary" onClick={() => setAdding(true)}>
                <PlusIcon size={15} />
                První událost
              </button>
            }
          />
        ) : (
          <ul className="occasion-cards">
            {occasions.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className={`occasion-card${o.id === openId ? ' selected' : ''}`}
                  onClick={() => setOpenId(o.id)}
                  onContextMenu={(e) => menu.open(e, occasionMenu(o, menu.ctx, occasionActions))}
                >
                  <span className="occasion-card-top">
                    <GiftIcon size={14} />
                    <strong>{o.name}</strong>
                    <span className={`countdown${o.days_until <= 7 ? ' soon' : ''}`}>
                      {countdown(o.days_until)}
                    </span>
                  </span>
                  <span className="muted small">
                    {KIND_LABELS[o.kind]} · {relativeDateLabel(o.next_date, today)}
                  </span>
                  <span className="occasion-card-stats muted small">
                    {o.gift_count === 0
                      ? 'zatím žádné dárky'
                      : `${o.bought_count}/${o.gift_count} pořízeno`}
                    {o.budget_minor !== null
                      ? ` · rozpočet ${formatMinorShort(o.budget_minor, currency)}`
                      : ''}
                  </span>
                  {o.budget_minor !== null ? (
                    <span className="progress-bar thin">
                      <span
                        className={`progress-fill${
                          (o.remaining_minor ?? 0) < 0 ? ' over' : ''
                        }`}
                        style={{
                          width: `${Math.round(spentRatio(o.spent_minor, o.budget_minor) * 100)}%`,
                        }}
                      />
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* -- the open occasion ------------------------------------------------ */}
      {open ? (
        <section className="occasion-detail">
          <header>
            <div>
              <h1>{open.name}</h1>
              <p className="muted">
                {KIND_LABELS[open.kind]} · {relativeDateLabel(open.next_date, today)} ·{' '}
                {countdown(open.days_until)}
                {open.yearly ? ' · každý rok' : ''}
              </p>
            </div>
            <button
              type="button"
              className="btn danger small"
              onClick={() => {
                if (
                  settings?.confirm_delete !== false &&
                  !window.confirm(
                    `Smazat událost „${open.name}“ i s ${open.gift_count} dárky?`,
                  )
                ) {
                  return;
                }
                void removeOccasion(open);
              }}
            >
              <TrashIcon size={14} />
              Smazat
            </button>
          </header>

          {/* -- budget -------------------------------------------------------- */}
          <div className="budget-box">
            <div className="budget-figures">
              <Figure label="Naplánováno" value={formatMinor(open.planned_minor, currency)} />
              <Figure label="Utraceno" value={formatMinor(open.spent_minor, currency)} />
              <Figure
                label="Zbývá z rozpočtu"
                value={
                  open.budget_minor === null
                    ? '—'
                    : formatMinor(open.remaining_minor, currency)
                }
                tone={
                  open.remaining_minor !== null && open.remaining_minor < 0 ? 'danger' : undefined
                }
              />
            </div>
            <label className="field-row">
              <span className="muted small">Rozpočet</span>
              <MoneyInput
                value={open.budget_minor}
                currency={currency}
                onCommit={(minor) => void patchOccasion(open.id, { budget_minor: minor })}
                onInvalid={() => toast('error', 'Zadejte částku jako číslo, například 3499,50.')}
              />
              <input
                type="date"
                value={open.on_date}
                onChange={(e) =>
                  e.target.value && void patchOccasion(open.id, { on_date: e.target.value })
                }
                aria-label="Datum události"
              />
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={open.yearly}
                  onChange={(e) => void patchOccasion(open.id, { yearly: e.target.checked })}
                />
                každý rok
              </label>
            </label>
            {open.budget_minor !== null ? (
              <span className="progress-bar">
                <span
                  className={`progress-fill${(open.remaining_minor ?? 0) < 0 ? ' over' : ''}`}
                  style={{
                    width: `${Math.round(spentRatio(open.spent_minor, open.budget_minor) * 100)}%`,
                  }}
                />
              </span>
            ) : null}
          </div>

          {/* -- add a gift ---------------------------------------------------- */}
          <form
            className="gift-add"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!giftDraft.title.trim()) return;
              try {
                const gift = await plannerApi.createGift(
                  open.id,
                  giftDraft.title.trim(),
                  giftDraft.recipient.trim(),
                );
                setGiftDraft({ title: '', recipient: giftDraft.recipient });
                await load();
                bumpPlanner();
                void notify(
                  'gift.added',
                  'Nápad na dárek',
                  `${gift.title}${gift.recipient ? ` pro ${gift.recipient}` : ''}`,
                );
              } catch (err) {
                reportError(err, 'Dárek se nepodařilo přidat');
              }
            }}
          >
            <PlusIcon size={15} />
            <input
              value={giftDraft.title}
              maxLength={500}
              placeholder="Co koupit"
              onChange={(e) => setGiftDraft({ ...giftDraft, title: e.target.value })}
              aria-label="Co koupit"
            />
            <input
              className="recipient"
              value={giftDraft.recipient}
              maxLength={200}
              placeholder="Pro koho"
              list="notes-mj-recipients"
              onChange={(e) => setGiftDraft({ ...giftDraft, recipient: e.target.value })}
              aria-label="Pro koho"
            />
            <datalist id="notes-mj-recipients">
              {[...new Set(open.gifts.map((g) => g.recipient).filter(Boolean))].map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            <button type="submit" className="btn primary" disabled={!giftDraft.title.trim()}>
              Přidat
            </button>
          </form>

          {/* -- the list, grouped by recipient -------------------------------- */}
          {open.gifts.length === 0 ? (
            <EmptyState
              icon={<GiftIcon size={28} />}
              title="Zatím prázdný seznam"
              hint="Napište si sem každý nápad – i ten, který si ještě rozmyslíte."
            />
          ) : (
            groupByRecipient(open.gifts).map(([recipient, gifts]) => (
              <div className="gift-group" key={recipient || '—'}>
                <h3>
                  {recipient || 'Bez jména'}
                  <span className="muted small">
                    {gifts.length} {plural(gifts.length, 'dárek', 'dárky', 'dárků')} ·{' '}
                    {formatMinorShort(
                      gifts.reduce((sum, g) => sum + (g.price_minor ?? 0), 0),
                      currency,
                    )}
                  </span>
                </h3>
                <ul className="gift-list">
                  {gifts.map((gift) => (
                    <li
                      key={gift.id}
                      className={`gift-row status-${gift.status}`}
                      onContextMenu={(e) => {
                        // A right-click inside the title or price box should
                        // still offer Vyjmout / Kopírovat / Vložit.
                        if (editableMenu(e.target)) return;
                        menu.open(e, giftMenu(gift, menu.ctx, giftActions));
                      }}
                    >
                      <select
                        className="gift-status"
                        value={gift.status}
                        onChange={(e) =>
                          void patchGift(gift.id, { status: e.target.value as GiftStatus })
                        }
                        aria-label={`Stav: ${gift.title}`}
                      >
                        {STATUS_ORDER.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>

                      <input
                        className="gift-title"
                        defaultValue={gift.title}
                        maxLength={500}
                        onBlur={(e) => {
                          const value = e.target.value.trim();
                          if (value && value !== gift.title) void patchGift(gift.id, { title: value });
                          else e.target.value = gift.title;
                        }}
                        aria-label="Název dárku"
                      />

                      {settings?.gifts_hide_prices ? (
                        <span className="gift-price-hidden muted">•••</span>
                      ) : (
                        <MoneyInput
                          value={gift.price_minor}
                          currency={currency}
                          compact
                          onCommit={(minor) => void patchGift(gift.id, { price_minor: minor })}
                          onInvalid={() =>
                            toast('error', 'Zadejte cenu jako číslo, například 899 nebo 899,50.')
                          }
                        />
                      )}

                      {gift.url ? (
                        <button
                          type="button"
                          className="icon-btn"
                          title={gift.url}
                          aria-label="Otevřít odkaz"
                          onClick={async () => {
                            const opened = await openExternal(gift.url);
                            if (!opened) toast('info', 'Odkaz se nepodařilo otevřít.');
                          }}
                        >
                          <LinkIcon size={15} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Přidat odkaz"
                          aria-label="Přidat odkaz"
                          onClick={() => {
                            const url = window.prompt('Odkaz na dárek (https://…)', '');
                            if (url) void patchGift(gift.id, { url: url.trim() });
                          }}
                        >
                          <LinkIcon size={15} />
                        </button>
                      )}

                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Smazat ${gift.title}`}
                        onClick={() => void removeGift(gift)}
                      >
                        <CloseIcon size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}

          <button
            type="button"
            className="btn subtle wide"
            onClick={() => void navigate({ kind: 'calendar' })}
          >
            <CalendarIcon size={15} />
            Zobrazit v kalendáři
          </button>
        </section>
      ) : (
        <section className="occasion-detail empty">
          <EmptyState
            icon={<GiftIcon size={30} />}
            title="Vyberte událost"
            hint="Nebo si vlevo založte novou."
          />
        </section>
      )}
    </div>
  );
}

const STATUS_KINDS: OccasionKind[] = [
  'birthday',
  'christmas',
  'anniversary',
  'nameday',
  'holiday',
  'other',
];

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger';
}) {
  return (
    <div className={`figure${tone ? ` tone-${tone}` : ''}`}>
      <span className="figure-value">{value}</span>
      <span className="figure-label muted">{label}</span>
    </div>
  );
}

/**
 * A money box that only commits a valid amount.
 *
 * Empty means "no price"; nonsense is refused with a message rather than
 * silently becoming zero, which would quietly corrupt the budget.
 */
function MoneyInput({
  value,
  currency,
  compact,
  onCommit,
  onInvalid,
}: {
  value: number | null;
  currency: string;
  compact?: boolean;
  onCommit: (minor: number | null) => void;
  onInvalid: () => void;
}) {
  const [text, setText] = useState(() => toText(value));

  useEffect(() => {
    setText(toText(value));
  }, [value]);

  return (
    <span className={`money-input${compact ? ' compact' : ''}`}>
      <input
        value={text}
        inputMode="decimal"
        maxLength={16}
        placeholder="—"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = parseMinor(text);
          if (parsed === undefined) {
            onInvalid();
            setText(toText(value));
            return;
          }
          if (parsed !== value) onCommit(parsed);
        }}
        aria-label="Částka"
      />
      <span className="muted small">{currency}</span>
    </span>
  );
}

function toText(minor: number | null): string {
  if (minor === null) return '';
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2).replace('.', ',');
}

function groupByRecipient(gifts: GiftIdea[]): [string, GiftIdea[]][] {
  const groups = new Map<string, GiftIdea[]>();
  for (const gift of gifts) {
    const key = gift.recipient.trim();
    const list = groups.get(key);
    if (list) list.push(gift);
    else groups.set(key, [gift]);
  }
  // Named recipients first, alphabetically; the unnamed bucket last.
  return [...groups.entries()].sort(([a], [b]) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, 'cs');
  });
}

function countdown(days: number): string {
  if (days === 0) return 'dnes!';
  if (days === 1) return 'zítra';
  if (days < 0) return 'proběhlo';
  return `za ${days} ${plural(days, 'den', 'dny', 'dní')}`;
}
