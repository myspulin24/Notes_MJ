/**
 * The repeat editor.
 *
 * Every change is previewed against the real backend engine, so what the user
 * sees under the controls is exactly what the app will do - not a second,
 * approximate description written in the UI.
 */

import { useEffect, useState } from 'react';

import { api, toAppError } from '../lib/api';
import { relativeDateLabel } from '../lib/dates';
import type { AppError, Freq, RecurrenceRule } from '../lib/types';
import { InlineError } from './States';

interface Props {
  value: RecurrenceRule | null;
  startsOn: string;
  today: string;
  onChange: (rule: RecurrenceRule | null) => void;
}

const WEEKDAY_LABELS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

export function defaultRule(startsOn: string): RecurrenceRule {
  return {
    freq: 'weekly',
    interval: 1,
    weekdays: [],
    monthly: null,
    month: null,
    anchor: 'fixed_schedule',
    starts_on: startsOn,
    ends: { type: 'never' },
  };
}

export function RepeatEditor({ value, startsOn, today, onChange }: Props) {
  const [preview, setPreview] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    if (!value) {
      setPreview([]);
      setDescription('');
      setError(null);
      return;
    }
    let cancelled = false;
    // Ask the backend what this rule actually produces. Debounced lightly so
    // dragging the interval spinner does not fire a call per keystroke.
    const timer = setTimeout(() => {
      api
        .previewRecurrence(value, value.starts_on || startsOn, 5)
        .then((result) => {
          if (cancelled) return;
          setPreview(result.dates);
          setDescription(result.description);
          setError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setPreview([]);
          setError(toAppError(e));
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, startsOn]);

  if (!value) {
    return (
      <button
        type="button"
        className="btn subtle wide"
        onClick={() => onChange(defaultRule(startsOn))}
      >
        Nastavit opakování
      </button>
    );
  }

  const patch = (changes: Partial<RecurrenceRule>) => onChange({ ...value, ...changes });

  const toggleWeekday = (day: number) => {
    const has = value.weekdays.includes(day);
    const next = has ? value.weekdays.filter((d) => d !== day) : [...value.weekdays, day];
    patch({ weekdays: next.sort((a, b) => a - b) });
  };

  return (
    <div className="repeat-editor">
      <div className="field-row">
        <label>
          Každý
          <input
            type="number"
            min={1}
            max={1000}
            value={value.interval}
            onChange={(e) => patch({ interval: clampInt(e.target.value, 1, 1000) })}
          />
        </label>
        <select
          value={value.freq}
          onChange={(e) => {
            const freq = e.target.value as Freq;
            // Switching frequency clears the settings that no longer apply,
            // so a leftover "3rd Tuesday" cannot survive into a daily rule.
            patch({ freq, weekdays: [], monthly: null, month: null });
          }}
          aria-label="Frekvence opakování"
        >
          <option value="daily">den / dnů</option>
          <option value="weekly">týden / týdnů</option>
          <option value="monthly">měsíc / měsíců</option>
          <option value="yearly">rok / let</option>
        </select>
      </div>

      {value.freq === 'weekly' ? (
        <div className="weekday-picker" role="group" aria-label="Dny v týdnu">
          {WEEKDAY_LABELS.map((label, day) => (
            <button
              key={label}
              type="button"
              className={`weekday${value.weekdays.includes(day) ? ' on' : ''}`}
              onClick={() => toggleWeekday(day)}
              aria-pressed={value.weekdays.includes(day)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {value.freq === 'monthly' || value.freq === 'yearly' ? (
        <div className="field-row">
          <select
            value={value.monthly?.type ?? 'same'}
            onChange={(e) => {
              const kind = e.target.value;
              if (kind === 'same') patch({ monthly: null });
              else if (kind === 'day_of_month')
                patch({ monthly: { type: 'day_of_month', day: 1 } });
              else patch({ monthly: { type: 'nth_weekday', nth: 1, weekday: 0 } });
            }}
            aria-label="Který den v měsíci"
          >
            <option value="same">ve stejný den jako datum zahájení</option>
            <option value="day_of_month">v určitý den v měsíci</option>
            <option value="nth_weekday">v n-tý den v týdnu</option>
          </select>
        </div>
      ) : null}

      {value.monthly?.type === 'day_of_month' ? (
        <div className="field-row">
          <label>
            Den
            <input
              type="number"
              min={-1}
              max={31}
              value={value.monthly.day}
              onChange={(e) =>
                patch({ monthly: { type: 'day_of_month', day: clampInt(e.target.value, -1, 31) } })
              }
            />
          </label>
          <button
            type="button"
            className={`btn subtle${value.monthly.day === -1 ? ' on' : ''}`}
            onClick={() => patch({ monthly: { type: 'day_of_month', day: -1 } })}
          >
            Poslední den
          </button>
          <p className="hint">Den, který v kratším měsíci neexistuje, se posune na jeho poslední den.</p>
        </div>
      ) : null}

      {value.monthly?.type === 'nth_weekday' ? (
        <div className="field-row">
          <select
            value={value.monthly.nth}
            onChange={(e) =>
              patch({
                monthly: {
                  type: 'nth_weekday',
                  nth: Number(e.target.value),
                  weekday: (value.monthly as { weekday: number }).weekday,
                },
              })
            }
            aria-label="Pořadí v měsíci"
          >
            <option value={1}>1.</option>
            <option value={2}>2.</option>
            <option value={3}>3.</option>
            <option value={4}>4.</option>
            <option value={5}>5.</option>
            <option value={-1}>poslední</option>
          </select>
          <select
            value={value.monthly.weekday}
            onChange={(e) =>
              patch({
                monthly: {
                  type: 'nth_weekday',
                  nth: (value.monthly as { nth: number }).nth,
                  weekday: Number(e.target.value),
                },
              })
            }
            aria-label="Den v týdnu"
          >
            {WEEKDAY_LABELS.map((label, day) => (
              <option key={label} value={day}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field-row">
        <select
          value={value.anchor}
          onChange={(e) => patch({ anchor: e.target.value as RecurrenceRule['anchor'] })}
          aria-label="Od čeho se počítá další termín"
        >
          <option value="fixed_schedule">podle pevného rozvrhu</option>
          <option value="after_completion">od chvíle, kdy to dokončím</option>
        </select>
      </div>

      <div className="field-row">
        <select
          value={value.ends.type}
          onChange={(e) => {
            const kind = e.target.value;
            if (kind === 'never') patch({ ends: { type: 'never' } });
            else if (kind === 'on_date')
              patch({ ends: { type: 'on_date', date: value.starts_on } });
            else patch({ ends: { type: 'after_occurrences', count: 10 } });
          }}
          aria-label="Kdy opakování skončí"
        >
          <option value="never">nikdy nekončí</option>
          <option value="on_date">skončí k datu</option>
          <option value="after_occurrences">skončí po počtu opakování</option>
        </select>

        {value.ends.type === 'on_date' ? (
          <input
            type="date"
            value={value.ends.date}
            onChange={(e) => patch({ ends: { type: 'on_date', date: e.target.value } })}
          />
        ) : null}
        {value.ends.type === 'after_occurrences' ? (
          <input
            type="number"
            min={1}
            max={999}
            value={value.ends.count}
            onChange={(e) =>
              patch({ ends: { type: 'after_occurrences', count: clampInt(e.target.value, 1, 999) } })
            }
          />
        ) : null}
      </div>

      {error ? (
        <InlineError error={error} />
      ) : (
        <div className="repeat-preview">
          <strong>{description}</strong>
          {preview.length ? (
            <ol>
              {preview.map((date) => (
                <li key={date}>
                  {date} <span className="muted">· {relativeDateLabel(date, today)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">V příštích dvanácti letech žádný termín.</p>
          )}
        </div>
      )}

      <button type="button" className="btn subtle wide" onClick={() => onChange(null)}>
        Zrušit opakování
      </button>
    </div>
  );
}

function clampInt(raw: string, min: number, max: number): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}
