# Notes_MJ export format

Version **2** · media type `application/json` · UTF-8, no BOM.

This is the format written by **Settings → Export** and by the `export_json`
command, and the only format `import_json` accepts. It is intended to be
readable, diff-able and processable with ordinary tools — `jq`, a spreadsheet
importer, a twenty-line script. Nothing about it is proprietary.

## Guarantees

* **Round-trips exactly.** Export → import into an empty database → export
  again produces the same content. The end-to-end test asserts this.
* **Ids are preserved.** That is what makes re-importing the same file a no-op
  instead of a duplication.
* **Dates are calendar days** (`YYYY-MM-DD`), with no time and no time zone.
  A deadline of "20 September" is the 20th wherever you are.
* **Timestamps are RFC 3339 in UTC** (`2026-09-07T08:15:30.123Z`).
* **Nothing is lossy except attachment bytes** — see below.

## Top level

```jsonc
{
  "format": "t3.export",   // always this string; the import refuses anything else
  "version": 2,            // an importer must refuse a version it does not know
  "exported_at": "2026-09-07T08:15:30.000Z",
  "app_version": "1.0.0",
  "attachments_note": "…", // informational only
  "areas": [ … ],
  "projects": [ … ],
  "tags": [ … ],
  "tasks": [ … ],
  "saved_filters": [ … ],

  // added in version 2; a version 1 file simply has none of these
  "notes": [ … ],
  "occasions": [ … ],
  "gifts": [ … ],
  "settings": { … } | null
}
```

## `areas[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | |
| `name` | string | Unique, case-insensitively |
| `position` | number | Sort order; ascending |
| `archived` | boolean | Hidden from the sidebar when true |
| `created_at`, `updated_at` | timestamp | |

## `projects[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | |
| `name` | string | |
| `notes` | string | Plain text, `\n` line breaks |
| `area_id` | string \| null | Must match an `areas[].id`, or be null |
| `status` | `"open"` \| `"completed"` \| `"canceled"` | |
| `list` | `"inbox"` \| `"anytime"` \| `"someday"` | |
| `start_on`, `due_on` | date \| null | |
| `position` | number | |
| `created_at`, `updated_at` | timestamp | |
| `completed_at` | timestamp \| null | |

## `tags[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | |
| `name` | string | Unique, case-insensitively |
| `color` | string | `#rrggbb` |
| `created_at` | timestamp | |

## `tasks[]`

One entry per task, **including subtasks and completed history**. Relationships
are denormalised onto the task so that one array is enough.

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | |
| `title` | string | Non-empty; a task with a blank title is skipped on import |
| `notes` | string | |
| `project_id` | string \| null | |
| `area_id` | string \| null | |
| `parent_id` | string \| null | Set on a subtask. One level only |
| `status` | `"open"` \| `"completed"` \| `"canceled"` | |
| `list` | `"inbox"` \| `"anytime"` \| `"someday"` | |
| `start_on` | date \| null | The day it starts appearing in Today |
| `due_on` | date \| null | The deadline; independent of `start_on` |
| `priority` | 0–3 | 0 none, 1 low, 2 medium, 3 high |
| `position` | number | Manual sort order within its list |
| `recurrence_id` | string \| null | Only the *open* occurrence of a series has one |
| `series_id` | string \| null | Present on every occurrence, so history groups |
| `created_at`, `updated_at` | timestamp | |
| `completed_at` | timestamp \| null | |
| `tag_names` | string[] | Matched to `tags[]` by name, case-insensitively |
| `attachments` | object[] | See below |
| `recurrence_rule` | object \| null | See below |
| `recurrence_state` | object \| null | See below |

### `tasks[].attachments[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | |
| `task_id` | string | |
| `stored_name` | string | The file name inside `attachments\`. Re-sanitised on import |
| `display_name` | string | What the UI shows. Never used as a path |
| `size_bytes` | integer | |
| `created_at` | timestamp | |

**Attachment bytes are not embedded.** The JSON records the metadata only.
To move attachments along with the JSON, either use
**Settings → Export everything**, which writes a folder containing
`t3-export.json` and a copy of `attachments\`, or copy the `attachments`
folder from your data directory by hand.

### `tasks[].recurrence_rule`

```jsonc
{
  "freq": "daily" | "weekly" | "monthly" | "yearly",
  "interval": 1,             // every N units, 1..1000
  "weekdays": [0, 3],        // weekly only. 0 = Monday … 6 = Sunday.
                             // Empty means "the weekday starts_on falls on"
  "monthly": null,           // see below; null means "same day as starts_on"
  "month": null,             // yearly only, 1..12; null means "same as starts_on"
  "anchor": "fixed_schedule" | "after_completion",
  "starts_on": "2026-09-07",
  "ends": { "type": "never" }
}
```

`monthly` is one of:

```jsonc
{ "type": "day_of_month", "day": 15 }   // 1..31, or -1 for "the last day"
{ "type": "nth_weekday", "nth": 3, "weekday": 0 }  // nth 1..5, or -1 for "last"
```

`ends` is one of:

```jsonc
{ "type": "never" }
{ "type": "on_date", "date": "2027-01-01" }
{ "type": "after_occurrences", "count": 10 }
```

Semantics worth knowing, because they are what the tests pin down:

* `day_of_month` **clamps**: day 31 lands on 28/29 February and returns to 31 in
  March.
* `nth_weekday` with `nth: 5` **skips** months that have no fifth such weekday.
* `fixed_schedule` never drifts — completing March's rent late does not move
  April's.
* `after_completion` measures from the day you actually ticked it off, and
  produces exactly one next date however long you left it.

### `tasks[].recurrence_state`

```jsonc
{
  "occurrences_done": 3,
  "last_scheduled": "2026-09-14",
  "last_completed": "2026-09-07"
}
```

## `saved_filters[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | |
| `name` | string | Unique, case-insensitively |
| `query` | string | The raw search text, e.g. `tag:home due:overdue` |
| `created_at` | timestamp | |

## Import behaviour

Import runs in a single transaction and is a **single undo step**. If anything
fails, nothing changes.

**Merge** (the default, and the safe one)

* Rows whose `id` already exists are skipped and counted in `skipped_existing`.
* Tags are matched by **name**, not id, so two exports of the same `home` tag
  merge into one.
* An area or saved filter whose *name* clashes with a different row is renamed
  `Name (2)` rather than rejected.
* A `project_id` or `area_id` that does not resolve is set to null and reported
  in `warnings` — the task is never dropped.
* A subtask whose parent is absent is promoted to a top-level task and reported.

**Replace**

* Takes a backup first, then deletes everything and loads the file.
* Still one undo step: Ctrl+Z restores the previous database in full.

The importer refuses, with a message and no changes:

* a file whose `format` is not `t3.export`;
* a `version` higher than this build understands;
* anything that is not valid JSON;
* a file larger than 256 MB.

## Working with an export

```bash
# every open task with a deadline, oldest first
jq -r '.tasks[] | select(.status=="open" and .due_on!=null)
       | [.due_on, .title] | @tsv' t3-export.json | sort

# what got done last month
jq -r '.tasks[] | select(.completed_at? // "" | startswith("2026-08"))
       | .title' t3-export.json

# how many tasks per project
jq -r '[.projects[] | {(.id): .name}] | add as $p
       | .tasks | group_by(.project_id)[]
       | "\(.length)\t\($p[.[0].project_id] // "(no project)")"' t3-export.json
```

---

## Version 2 additions

Version 2 added the notebook, occasions, the gift planner and the settings
snapshot. A **version 1 file still imports**: every new array carries a
default, so an older export simply contributes none of them.

### `notes[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | |
| `title` | string | Non-empty; a blank one is skipped with a warning |
| `body` | string | Plain text, `\n` line breaks |
| `pinned` | boolean | Pinned notes sort to the top |
| `color` | string | `#rrggbb`, or empty for the default |
| `position` | number | Manual sort order |
| `created_at`, `updated_at` | timestamp | |
| `tag_names` | string[] | Shares the same tag vocabulary as tasks |

### `occasions[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | |
| `name` | string | |
| `kind` | `"christmas"` \| `"birthday"` \| `"anniversary"` \| `"nameday"` \| `"holiday"` \| `"other"` | Icon and wording only |
| `on_date` | date | For a birthday this may be the year of birth |
| `yearly` | boolean | When true, the date recurs annually |
| `budget_minor` | integer \| null | **Minor units** (haléře). Negative values are dropped |
| `notes` | string | |
| `position` | number | |
| `created_at`, `updated_at` | timestamp | |

A yearly occasion on **29 February** falls on 28 February in a common year,
matching the task recurrence engine.

### `gifts[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | |
| `occasion_id` | string | Must match an `occasions[].id`, or the gift is skipped and reported |
| `recipient` | string | Free text; the planner groups by it |
| `title` | string | |
| `notes` | string | |
| `url` | string | **Only `http://` or `https://`.** Anything else is dropped on import |
| `price_minor` | integer \| null | Minor units |
| `status` | `"idea"` \| `"decided"` \| `"bought"` \| `"wrapped"` \| `"given"` | `bought`/`wrapped`/`given` count as money spent |
| `position` | number | |
| `created_at`, `updated_at` | timestamp | |

### `settings`

The whole preferences object, or `null`. **Not applied by default.** The
importer only restores it when explicitly asked (the checkbox in
Settings → Import), because inheriting someone else's theme and window
choices is rarely what "import my tasks" means. The report says
`settings_applied` either way.

Unknown keys are ignored and missing keys take their default, so a settings
block written by an older or newer build always loads.

### `tasks[].completed_on`

Also new in version 2: the user's **local** calendar day a task was finished
on. `completed_at` is a UTC instant, so deriving a day from it puts an
early-morning completion in CET on the previous date. The dashboard and the
archive group by `completed_on`. It is `null` for anything still open.

## Working with the gift list

```bash
# what is still to buy this Christmas, and what it will cost
jq -r '.occasions[] | select(.kind=="christmas") | .id' t3-export.json |
while read -r id; do
  jq -r --arg id "$id" '.gifts[]
    | select(.occasion_id==$id and (.status=="idea" or .status=="decided"))
    | [.recipient, .title, (.price_minor // 0) / 100] | @tsv' t3-export.json
done

# total already spent per occasion
jq -r '[.occasions[] | {(.id): .name}] | add as $o
  | .gifts
  | map(select(.status=="bought" or .status=="wrapped" or .status=="given"))
  | group_by(.occasion_id)[]
  | "\($o[.[0].occasion_id])\t\((map(.price_minor // 0) | add) / 100)"' t3-export.json
```
