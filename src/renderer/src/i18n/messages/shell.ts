import type { Bundle } from '..';

export const shell: Bundle = {
  de: {
    'nav.map': 'Weltkarte', 'nav.photos': 'Mediathek', 'nav.albums': 'Alben', 'nav.places': 'Orte', 'nav.insights': 'Statistik',
    'nav.library': 'Entdecken', 'nav.collections': 'Schnellzugriff', 'nav.sources': 'Quellen', 'nav.settings': 'Einstellungen', 'nav.addFolder': 'Ordner hinzufügen',
    'nav.collapse': 'Seitenleiste einklappen', 'nav.expand': 'Seitenleiste ausklappen',
    'nav.favorites': 'Favoriten', 'nav.videos': 'Videos', 'nav.noLocation': 'Ohne Standort', 'nav.recent': 'Letzte 30 Tage',
    'search.placeholder': 'Suchen: Orte, Kameras, Jahre …', 'search.hint': 'Strg K',
    'key.ctrl': 'Strg',
    'sel.count.one': '{n} ausgewählt', 'sel.count.other': '{n} ausgewählt', 'sel.clear': 'Auswahl aufheben',
    'sel.createAlbum': 'Album erstellen', 'sel.favorite': 'Favorit', 'sel.addToAlbum': 'Zu Album hinzufügen',
    'common.cancel': 'Abbrechen', 'common.save': 'Speichern', 'common.close': 'Schließen', 'common.delete': 'Löschen',
    'common.create': 'Erstellen', 'common.rename': 'Umbenennen', 'common.back': 'Zurück', 'common.done': 'Fertig',
    'common.photos.one': '{n} Foto', 'common.photos.other': '{n} Fotos', 'common.items.one': '{n} Element', 'common.items.other': '{n} Elemente',
    'common.loading': 'Wird geladen …', 'common.unknown': 'Unbekannt', 'common.all': 'Alle',

    'sync.title': 'Synchronisierung', 'sync.scanning': 'Synchronisiere …', 'sync.idle': 'Aktuell', 'sync.offline': 'Nicht erreichbar', 'sync.error': 'Fehler',
    'sync.pill.scanningPct': 'Synchronisiere · {pct} %', 'sync.pill.offline': 'Offline',
    'sync.allCurrent': 'Alle Quellen sind aktuell', 'sync.someOffline': 'Mindestens eine Quelle ist nicht erreichbar', 'sync.someError': 'Bei mindestens einer Quelle ist ein Fehler aufgetreten',
    'sync.lastScan': 'Aktuell · {when}', 'sync.rescanAll': 'Alle neu scannen',
    'sync.phase.discovering': 'Ordner wird durchsucht', 'sync.phase.reading': 'Metadaten werden gelesen', 'sync.phase.thumbnails': 'Vorschaubilder werden erstellt', 'sync.phase.done': 'Fertig',

    'sources.added.one': '{n} Ordner hinzugefügt', 'sources.added.other': '{n} Ordner hinzugefügt', 'sources.addedOne': '„{name}“ hinzugefügt',
    'sources.addFailed': 'Ordner konnte nicht hinzugefügt werden', 'sources.removed': '„{name}“ entfernt', 'sources.noFiles': 'In dieser Quelle gibt es noch keine Dateien',
    'sources.rescan': 'Neu scannen', 'sources.reveal': 'Im Explorer zeigen', 'sources.copyPath': 'Pfad kopieren', 'sources.pathCopied': 'Pfad kopiert',
    'sources.remove': 'Entfernen', 'sources.more': 'Weitere Aktionen',
    'sources.removeTitle': '„{name}“ entfernen?', 'sources.removeBody': 'Die Quelle wird aus ImageWorld entfernt. Deine Originaldateien bleiben unverändert auf dem PC; Favoriten und Bewertungen bleiben erhalten.',

    'error.title': 'Das hat nicht geklappt', 'error.body': 'Dieser Bereich konnte nicht angezeigt werden. Deine Fotos sind davon nicht betroffen.',
    'error.retry': 'Erneut versuchen', 'error.reload': 'App neu laden', 'error.details': 'Technische Details',
    'drop.title': 'Ordner hier ablegen', 'drop.hint': 'Die Fotos bleiben an ihrem Ort – ImageWorld liest sie nur.', 'drop.onlyFolders': 'Bitte einen Ordner ablegen, keine einzelnen Dateien',
  },
  en: {
    'nav.map': 'World map', 'nav.photos': 'Library', 'nav.albums': 'Albums', 'nav.places': 'Places', 'nav.insights': 'Insights',
    'nav.library': 'Explore', 'nav.collections': 'Quick access', 'nav.sources': 'Sources', 'nav.settings': 'Settings', 'nav.addFolder': 'Add folder',
    'nav.collapse': 'Collapse sidebar', 'nav.expand': 'Expand sidebar',
    'nav.favorites': 'Favorites', 'nav.videos': 'Videos', 'nav.noLocation': 'No location', 'nav.recent': 'Last 30 days',
    'search.placeholder': 'Search places, cameras, years …', 'search.hint': 'Ctrl K',
    'key.ctrl': 'Ctrl',
    'sel.count.one': '{n} selected', 'sel.count.other': '{n} selected', 'sel.clear': 'Clear selection',
    'sel.createAlbum': 'Create album', 'sel.favorite': 'Favorite', 'sel.addToAlbum': 'Add to album',
    'common.cancel': 'Cancel', 'common.save': 'Save', 'common.close': 'Close', 'common.delete': 'Delete',
    'common.create': 'Create', 'common.rename': 'Rename', 'common.back': 'Back', 'common.done': 'Done',
    'common.photos.one': '{n} photo', 'common.photos.other': '{n} photos', 'common.items.one': '{n} item', 'common.items.other': '{n} items',
    'common.loading': 'Loading …', 'common.unknown': 'Unknown', 'common.all': 'All',

    'sync.title': 'Sync', 'sync.scanning': 'Syncing …', 'sync.idle': 'Up to date', 'sync.offline': 'Unavailable', 'sync.error': 'Error',
    'sync.pill.scanningPct': 'Syncing · {pct}%', 'sync.pill.offline': 'Offline',
    'sync.allCurrent': 'All sources are up to date', 'sync.someOffline': 'At least one source is unavailable', 'sync.someError': 'At least one source reported an error',
    'sync.lastScan': 'Up to date · {when}', 'sync.rescanAll': 'Rescan all',
    'sync.phase.discovering': 'Looking through folders', 'sync.phase.reading': 'Reading metadata', 'sync.phase.thumbnails': 'Creating previews', 'sync.phase.done': 'Done',

    'sources.added.one': '{n} folder added', 'sources.added.other': '{n} folders added', 'sources.addedOne': '“{name}” added',
    'sources.addFailed': 'Couldn’t add the folder', 'sources.removed': '“{name}” removed', 'sources.noFiles': 'This source has no files yet',
    'sources.rescan': 'Rescan', 'sources.reveal': 'Show in Explorer', 'sources.copyPath': 'Copy path', 'sources.pathCopied': 'Path copied',
    'sources.remove': 'Remove', 'sources.more': 'More actions',
    'sources.removeTitle': 'Remove “{name}”?', 'sources.removeBody': 'The source is removed from ImageWorld. Your original files stay untouched on this PC; favorites and ratings are kept.',

    'error.title': 'Something went wrong', 'error.body': 'This area couldn’t be displayed. Your photos are not affected.',
    'error.retry': 'Try again', 'error.reload': 'Reload app', 'error.details': 'Technical details',
    'drop.title': 'Drop a folder here', 'drop.hint': 'Photos stay where they are – ImageWorld only reads them.', 'drop.onlyFolders': 'Please drop a folder, not individual files',
  },
};
