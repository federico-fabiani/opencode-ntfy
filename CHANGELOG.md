# Änderungen

## 0.3.0

- `session.idle` wird als Abschluss gemeldet. Im Chat endet ein Turn mit
  `session.idle`, nicht mit `session.execution.succeeded` — ohne dieses Ereignis
  kam am Ende eines normalen Turns gar keine Meldung.
- Eine Meldung direkt nach Abschluss oder Freigabe derselben Sitzung wird
  60 Sekunden lang unterdrückt, damit `session.idle` nicht doppelt alarmiert.

## 0.2.0

Fork von `Mumme-IT/opencode-ntfy` durch federico-fabiani. Upstream bleibt die Referenz;
alle Änderungen sind additiv und lassen sich einzeln zurücknehmen.

### Änderungen

- Der Nachrichtentext trägt jetzt Inhalt statt nur eines Platzhalters: Fragentitel bei
  Rückfragen (`form.title`), Aktion bei Freigaben (`action`). Abschaltbar über `includeDetail: false`.
- Freigabe-Ressourcen bleiben standardmäßig ausgeschlossen, weil sie Befehle mit Tokens
  enthalten können. Opt-in über `includePermissionResources: true`.
- `session.retry.scheduled` wird als eigene Meldung mit Aufmerksamkeitspriorität gemeldet.
- Jede Meldung trägt ntfy-Tags (`question`, `warning`, `white_check_mark`, `rotating_light`,
  `octagonal_sign`, `hourglass_flowing_sand`).
- `language: "it"` für italienische Titel und das Aktionslabel. Standard bleibt `de`.
- `maxPerMinute` (Standard `30`) verwirft überschüssige Meldungen und warnt einmal pro Minute.
- Fehler beim Zustellen nennen jetzt den HTTP-Status.

### Unverändert

- Linkaufbau (`base64url` der Server-URL), Deduplizierung, Ortsfilter, Wiederholungslogik,
  Token-Handling und Ereignisstrom-Wiederaufbau sind unverändert übernommen.

## 0.1.0

Dies ist die erste öffentliche Version von `@mumme-it/opencode-ntfy` für OpenCode V2.
Der Plugin-Vertrag ist mit OpenCode 2.1.3 geprüft. Node.js ab Version 22 ist erforderlich.

### Funktionen

- Das Plugin sendet ntfy-Meldungen für strukturierte Rückfragen, Freigaben, erfolgreiche Ausführungen, Fehler und Abbrüche.
- Jede Meldung öffnet die auslösende Session über einen direkten Link und die Aktion „Session öffnen“.
- Server, Topic, Webadresse und Serververbindung sind konfigurierbar. Die Anmeldung erfolgt optional über eine Token-Datei oder Umgebungsvariable.
- Rückfragen, Freigaben und Abschlussmeldungen lassen sich getrennt ausschalten. Abschlüsse von Unteragenten sind optional.
- Prioritäten sind einstellbar. Sessiontitel und Projektverzeichnisnamen lassen sich zum Schutz privater Informationen ausblenden.
- Ereignisse werden nach Verzeichnis und Workspace gefiltert. Erfolgreich versendete Ereignisse werden im Arbeitsspeicher dedupliziert.
- Vorübergehende Zustellfehler werden begrenzt wiederholt. Ein unterbrochener Ereignisstrom wird erneut abonniert.

### Veröffentlichung und Qualität

- Das ESM-Paket benötigt keine externen Laufzeitabhängigkeiten und steht unter der MIT-Lizenz.
- GitHub Actions prüft Syntax, Tests und Paketinhalt unter Node.js 22 und 24.
- Der Veröffentlichungsworkflow prüft Versionsnummer und Tag und unterstützt npm Trusted Publishing sowie ein geschütztes `NPM_TOKEN`.

### Bekannte Grenzen

Es gibt keine persistente Warteschlange. Ereignisse während eines Ausfalls werden nicht nachgeliefert.
Wiederholungsversuche können bei verlorenen HTTP-Antworten doppelte Meldungen erzeugen.
Bei selbst betriebenem ntfy benötigt die sofortige iOS-Zustellung einen passend konfigurierten Upstream.
