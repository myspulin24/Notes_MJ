//! The notification catalogue.
//!
//! Every notification the app can send is declared here once, with its
//! category, its Czech label and whether it is on by default. The settings
//! page renders itself from this list, so adding a notification is a single
//! entry — there is no second place to remember.
//!
//! The frontend asks `notification_catalogue()` for the list and
//! `Settings::notification_enabled()` for the answer, so the decision about
//! whether a given notification fires lives in one function rather than being
//! re-implemented at each call site.

use serde::{Deserialize, Serialize};

/// A group of related notifications, as shown on the settings page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationCategory {
    Tasks,
    Projects,
    Calendar,
    Notes,
    Occasions,
    Focus,
    Data,
    App,
}

impl NotificationCategory {
    /// Order and headings on the settings page.
    pub const ALL: [NotificationCategory; 8] = [
        NotificationCategory::Tasks,
        NotificationCategory::Projects,
        NotificationCategory::Calendar,
        NotificationCategory::Notes,
        NotificationCategory::Occasions,
        NotificationCategory::Focus,
        NotificationCategory::Data,
        NotificationCategory::App,
    ];

    pub fn label(self) -> &'static str {
        match self {
            NotificationCategory::Tasks => "Úkoly",
            NotificationCategory::Projects => "Projekty a oblasti",
            NotificationCategory::Calendar => "Kalendář a termíny",
            NotificationCategory::Notes => "Zápisník",
            NotificationCategory::Occasions => "Události a dárky",
            NotificationCategory::Focus => "Soustředěná práce",
            NotificationCategory::Data => "Data a zálohy",
            NotificationCategory::App => "Aplikace a aktualizace",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            NotificationCategory::Tasks => "Co se děje s jednotlivými úkoly.",
            NotificationCategory::Projects => "Změny ve struktuře, do které úkoly řadíte.",
            NotificationCategory::Calendar => "Plánování na konkrétní dny a hlídání termínů.",
            NotificationCategory::Notes => "Poznámky, které nejsou úkoly.",
            NotificationCategory::Occasions => "Vánoce, narozeniny a nákup dárků.",
            NotificationCategory::Focus => "Odpočet při soustředěné práci.",
            NotificationCategory::Data => "Zálohy, export a import.",
            NotificationCategory::App => "Nové verze Notes_MJ.",
        }
    }
}

/// One switchable notification.
#[derive(Debug, Clone, Serialize)]
pub struct NotificationEvent {
    /// Stable key stored in the settings. Never translated, never reused.
    pub id: &'static str,
    pub category: NotificationCategory,
    pub label: &'static str,
    /// One line of "what exactly triggers this", shown under the toggle.
    pub description: &'static str,
    pub default_on: bool,
}

/// Every notification the app knows how to send.
///
/// The defaults lean quiet for the routine things you do dozens of times a day
/// (creating and completing a task) and loud for the ones you would want to
/// know about even if you were looking away (a deadline arriving, a backup
/// failing). Everything can be switched either way.
pub const CATALOGUE: &[NotificationEvent] = &[
    // -- tasks ---------------------------------------------------------------
    NotificationEvent {
        id: "task.created",
        category: NotificationCategory::Tasks,
        label: "Vytvoření úkolu",
        description: "Pokaždé, když přidáte nový úkol.",
        default_on: false,
    },
    NotificationEvent {
        id: "task.completed",
        category: NotificationCategory::Tasks,
        label: "Dokončení úkolu",
        description: "Když úkol odškrtnete jako hotový.",
        default_on: false,
    },
    NotificationEvent {
        id: "task.reopened",
        category: NotificationCategory::Tasks,
        label: "Znovuotevření úkolu",
        description: "Když dokončený úkol vrátíte mezi otevřené.",
        default_on: false,
    },
    NotificationEvent {
        id: "task.deleted",
        category: NotificationCategory::Tasks,
        label: "Smazání úkolu",
        description: "Když úkol smažete. Vrátit ho jde přes Ctrl+Z.",
        default_on: false,
    },
    NotificationEvent {
        id: "task.filed",
        category: NotificationCategory::Tasks,
        label: "Zařazení úkolu",
        description: "Když úkol přiřadíte do projektu nebo oblasti.",
        default_on: false,
    },
    NotificationEvent {
        id: "task.repeat_rolled",
        category: NotificationCategory::Tasks,
        label: "Další výskyt opakování",
        description: "Když se po dokončení vytvoří další výskyt opakovaného úkolu.",
        default_on: true,
    },
    // -- projects ------------------------------------------------------------
    NotificationEvent {
        id: "project.created",
        category: NotificationCategory::Projects,
        label: "Vytvoření projektu",
        description: "Když založíte nový projekt.",
        default_on: false,
    },
    NotificationEvent {
        id: "project.completed",
        category: NotificationCategory::Projects,
        label: "Dokončení projektu",
        description: "Když projekt uzavřete. Zbývající úkoly se dokončí s ním.",
        default_on: true,
    },
    NotificationEvent {
        id: "area.created",
        category: NotificationCategory::Projects,
        label: "Vytvoření oblasti",
        description: "Když založíte novou oblast.",
        default_on: false,
    },
    // -- calendar ------------------------------------------------------------
    NotificationEvent {
        id: "calendar.scheduled",
        category: NotificationCategory::Calendar,
        label: "Naplánování do kalendáře",
        description: "Když úkolu nastavíte datum zahájení nebo ho přidáte na konkrétní den.",
        default_on: true,
    },
    NotificationEvent {
        id: "calendar.rescheduled",
        category: NotificationCategory::Calendar,
        label: "Přesunutí na jiný den",
        description: "Když už naplánovaný úkol posunete na jiné datum.",
        default_on: false,
    },
    NotificationEvent {
        id: "calendar.deadline_set",
        category: NotificationCategory::Calendar,
        label: "Nastavení termínu",
        description: "Když úkolu přidáte nebo změníte termín dokončení.",
        default_on: false,
    },
    NotificationEvent {
        id: "calendar.due_today",
        category: NotificationCategory::Calendar,
        label: "Dnešní termíny",
        description: "Při spuštění shrne, co má dnes termín.",
        default_on: true,
    },
    NotificationEvent {
        id: "calendar.overdue",
        category: NotificationCategory::Calendar,
        label: "Úkoly po termínu",
        description: "Při spuštění upozorní, že něco propadlo.",
        default_on: true,
    },
    // -- notes ---------------------------------------------------------------
    NotificationEvent {
        id: "note.created",
        category: NotificationCategory::Notes,
        label: "Vytvoření poznámky",
        description: "Když si založíte novou poznámku.",
        default_on: false,
    },
    NotificationEvent {
        id: "note.deleted",
        category: NotificationCategory::Notes,
        label: "Smazání poznámky",
        description: "Když poznámku smažete.",
        default_on: false,
    },
    // -- occasions and gifts -------------------------------------------------
    NotificationEvent {
        id: "occasion.created",
        category: NotificationCategory::Occasions,
        label: "Vytvoření události",
        description: "Když přidáte Vánoce, narozeniny nebo výročí.",
        default_on: false,
    },
    NotificationEvent {
        id: "occasion.approaching",
        category: NotificationCategory::Occasions,
        label: "Blížící se událost",
        description: "Při spuštění upozorní na události v nastaveném předstihu.",
        default_on: true,
    },
    NotificationEvent {
        id: "gift.added",
        category: NotificationCategory::Occasions,
        label: "Přidání dárku",
        description: "Když přidáte nápad na dárek.",
        default_on: false,
    },
    NotificationEvent {
        id: "gift.bought",
        category: NotificationCategory::Occasions,
        label: "Koupení dárku",
        description: "Když dárek označíte jako koupený.",
        default_on: true,
    },
    NotificationEvent {
        id: "gift.budget_exceeded",
        category: NotificationCategory::Occasions,
        label: "Překročení rozpočtu",
        description: "Když utracená částka přesáhne rozpočet události.",
        default_on: true,
    },
    // -- focus ---------------------------------------------------------------
    NotificationEvent {
        id: "focus.finished",
        category: NotificationCategory::Focus,
        label: "Konec odpočtu",
        description: "Když doběhne soustředěná práce.",
        default_on: true,
    },
    NotificationEvent {
        id: "focus.started",
        category: NotificationCategory::Focus,
        label: "Začátek soustředění",
        description: "Potvrzení, že odpočet běží.",
        default_on: false,
    },
    // -- data ----------------------------------------------------------------
    NotificationEvent {
        id: "data.backup_done",
        category: NotificationCategory::Data,
        label: "Dokončená záloha",
        description: "Když se povede automatická nebo ruční záloha.",
        default_on: false,
    },
    NotificationEvent {
        id: "data.backup_failed",
        category: NotificationCategory::Data,
        label: "Neúspěšná záloha",
        description: "Když zálohu nelze zapsat. Doporučeno nechat zapnuté.",
        default_on: true,
    },
    NotificationEvent {
        id: "data.export_done",
        category: NotificationCategory::Data,
        label: "Dokončený export",
        description: "Když se data vyexportují do souboru.",
        default_on: true,
    },
    NotificationEvent {
        id: "data.import_done",
        category: NotificationCategory::Data,
        label: "Dokončený import",
        description: "Když se data načtou ze souboru.",
        default_on: true,
    },
    // -- the app itself ------------------------------------------------------
    NotificationEvent {
        id: "app.update_available",
        category: NotificationCategory::App,
        label: "Nalezená aktualizace",
        description: "Když se najde novější verze a začne se stahovat.",
        default_on: false,
    },
    NotificationEvent {
        id: "app.update_ready",
        category: NotificationCategory::App,
        label: "Aktualizace připravená",
        description: "Když je stažená a čeká jen na restart. Doporučeno nechat zapnuté.",
        default_on: true,
    },
    NotificationEvent {
        id: "app.update_failed",
        category: NotificationCategory::App,
        label: "Neúspěšná aktualizace",
        description: "Když se aktualizaci nepodaří stáhnout nebo ověřit.",
        default_on: true,
    },
];

/// A category with its events, ready for the settings page to render.
#[derive(Debug, Clone, Serialize)]
pub struct CatalogueGroup {
    pub category: NotificationCategory,
    pub label: &'static str,
    pub description: &'static str,
    pub events: Vec<&'static NotificationEvent>,
}

/// The catalogue grouped by category, in display order.
pub fn grouped_catalogue() -> Vec<CatalogueGroup> {
    NotificationCategory::ALL
        .iter()
        .map(|category| CatalogueGroup {
            category: *category,
            label: category.label(),
            description: category.description(),
            events: CATALOGUE.iter().filter(|e| e.category == *category).collect(),
        })
        .collect()
}

pub fn find(id: &str) -> Option<&'static NotificationEvent> {
    CATALOGUE.iter().find(|e| e.id == id)
}

pub fn is_known(id: &str) -> bool {
    find(id).is_some()
}

/// The default on/off map, used when nothing has been saved yet.
pub fn defaults() -> std::collections::BTreeMap<String, bool> {
    CATALOGUE
        .iter()
        .map(|e| (e.id.to_string(), e.default_on))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn every_id_is_unique() {
        let mut seen = HashSet::new();
        for event in CATALOGUE {
            assert!(seen.insert(event.id), "duplicate id: {}", event.id);
        }
    }

    #[test]
    fn ids_are_namespaced_and_stable_looking() {
        for event in CATALOGUE {
            assert!(
                event.id.contains('.'),
                "{} should look like 'area.thing'",
                event.id
            );
            assert!(
                event.id.chars().all(|c| c.is_ascii_lowercase() || c == '.' || c == '_'),
                "{} must stay ASCII: it is a storage key, not a label",
                event.id
            );
        }
    }

    #[test]
    fn every_event_has_czech_text() {
        for event in CATALOGUE {
            assert!(!event.label.is_empty(), "{} has no label", event.id);
            assert!(
                event.description.ends_with('.'),
                "{} description should read as a sentence",
                event.id
            );
        }
    }

    #[test]
    fn grouping_covers_every_event_exactly_once() {
        let groups = grouped_catalogue();
        let total: usize = groups.iter().map(|g| g.events.len()).sum();
        assert_eq!(total, CATALOGUE.len(), "no event fell out of its category");
        assert_eq!(groups.len(), NotificationCategory::ALL.len());
        for group in &groups {
            assert!(!group.events.is_empty(), "{:?} has no events", group.category);
        }
    }

    #[test]
    fn the_noisy_everyday_ones_are_off_by_default() {
        // Creating and completing tasks happens dozens of times a day; a
        // notification for each would be unusable as a default.
        assert!(!find("task.created").unwrap().default_on);
        assert!(!find("task.completed").unwrap().default_on);
        assert!(!find("note.created").unwrap().default_on);
    }

    #[test]
    fn the_ones_you_would_miss_are_on_by_default() {
        assert!(find("data.backup_failed").unwrap().default_on);
        assert!(find("focus.finished").unwrap().default_on);
        assert!(find("calendar.overdue").unwrap().default_on);
    }

    #[test]
    fn defaults_cover_the_whole_catalogue() {
        let defaults = defaults();
        assert_eq!(defaults.len(), CATALOGUE.len());
        for event in CATALOGUE {
            assert_eq!(defaults[event.id], event.default_on);
        }
    }

    #[test]
    fn lookup_rejects_something_that_is_not_in_the_catalogue() {
        assert!(is_known("task.created"));
        assert!(!is_known("task.invented"));
        assert!(!is_known(""));
    }
}
