# @mumme-it/opencode-ntfy

Konfigurierbare ntfy-Benachrichtigungen für OpenCode V2 ohne externe Laufzeitabhängigkeiten.
Jede Meldung enthält einen direkten Link zur auslösenden Session.
Der Plugin-Vertrag ist mit OpenCode `2.1.3` geprüft. Node.js ab Version 22 ist erforderlich.

## Verhalten

- Echte Rückfragen: `form.created` mit `metadata.kind === "question"`.
- Freigaben: `permission.asked`, standardmäßig eingeschaltet.
- Abschluss: `session.execution.succeeded`. Fehler und Abbrüche erhalten eigene Meldungen.
- Jede Meldung enthält eine ntfy-Click-URL und die Aktion **Session öffnen** zur auslösenden Session.
- Rückfragen von Unteragenten werden ebenfalls gemeldet. Abschlüsse von Unteragenten sind standardmäßig ausgeschaltet.
- Nachrichten enthalten standardmäßig Sessiontitel und Projektverzeichnisnamen. Beide Angaben lassen sich ausschalten.
- Frageinhalte, Antworten, Fehlermeldungen und Zugangsdaten werden nicht in die Nachricht eingebaut.
- Die Zustellung läuft im Ereignisabonnement, nicht in einem blockierenden Tool-Hook.
- Instanzen filtern nach Verzeichnis und Workspace, damit verschiedene Projekte nicht dieselbe Meldung mehrfach senden.

## Konfiguration

Ergänze **einen Eintrag** im vorhandenen `plugins`-Array von `~/.config/opencode/opencode.json`.
OpenCode installiert das npm-Paket selbst. Ersetze bei einer Migration den vorhandenen lokalen Eintrag,
statt eine zweite Instanz hinzuzufügen. Behalte dabei deine bisherigen Optionen bei.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@mumme-it/opencode-ntfy@0.1.0",
      "options": {
        "server": "https://ntfy.sh",
        "topic": "DEIN-TOPIC",
        "webUrl": "https://code.example.com",
        "serverUrl": "https://code.example.com"
      }
    }
  ]
}
```

`server` ist die ntfy-Basisadresse, ohne Topic. Ein eigener Server und ein Pfadpräfix sind möglich.
`webUrl` ist die vom iPhone erreichbare Adresse der OpenCode-Weboberfläche.
`serverUrl` muss **exakt** der dort gespeicherten HTTP-Verbindung entsprechen, einschließlich eines eventuell vorhandenen abschließenden `/`.
Wenn beide Adressen identisch sind, kann `serverUrl` entfallen; der Standard ist `webUrl` ohne abschließenden `/`.
Es werden keine Pairing- oder Login-Tokens in Links eingebaut.

Optionale Einstellungen:

- `tokenFile`: absoluter Pfad zu einer Datei mit einem ntfy-Access-Token. Die Datei hat Vorrang vor der Token-Umgebungsvariable.
- `questions: false`: Rückfragemeldungen ausschalten. Standard: `true`.
- `permissions: false`: Freigabemeldungen ausschalten. Standard: `true`.
- `completions: false`: Meldungen für Erfolg, Fehler und Abbruch ausschalten. Standard: `true`.
- `includeChildCompletions: true`: auch Abschlüsse, Fehler und Abbrüche von Unteragenten melden.
- `includeSessionTitle: false`: den Sessiontitel aus dem Nachrichtentext entfernen. Standard: `true`.
- `includeProjectName: false`: den Projektverzeichnisnamen aus dem Nachrichtentext entfernen. Standard: `true`.
- `attentionPriority`: ntfy-Priorität für Fragen, Freigaben und Fehler, ganzzahlig von `1` bis `5`. Standard: `4`.
- `completionPriority`: ntfy-Priorität für Erfolg und Abbruch, ganzzahlig von `1` bis `5`. Standard: `3`.
- `enabled: false`: das Plugin deaktivieren, ohne den Eintrag zu entfernen.

Schalter müssen JSON-Booleans sein, keine Zeichenketten. `includeChildCompletions` ist standardmäßig `false`,
`enabled` ist standardmäßig `true`. Die beiden Prioritäten gelten auch für Unteragenten.

Alternativ können `OPENCODE_NTFY_SERVER`, `OPENCODE_NTFY_TOPIC`, `OPENCODE_NTFY_WEB_URL`,
`OPENCODE_NTFY_SERVER_URL`, `OPENCODE_NTFY_TOKEN` und `OPENCODE_NTFY_TOKEN_FILE` verwendet werden.
Diese Variablen müssen im **OpenCode-Serverprozess** gesetzt sein, nicht nur im verbundenen Terminal.
Explizite Optionen für dasselbe Feld haben Vorrang. Eine Token-Datei hat immer Vorrang vor `OPENCODE_NTFY_TOKEN`.
Tokens werden nicht als Plugin-Option gespeichert. Die Schalter und Prioritäten werden über `options` eingestellt.

Bei öffentlichen, ungeschützten ntfy-Topics können andere Personen mit Kenntnis des Topic-Namens mitlesen und Nachrichten senden.
Verwende ein geschütztes Topic oder einen schwer zu erratenden Namen. Sessiontitel werden an den ntfy-Server übertragen.

OpenCode lädt Änderungen an der Konfiguration automatisch neu. Bei Bedarf erzwingt `/reload` das Neuladen.
Ein Serverneustart ist dafür nicht erforderlich.

## iPhone einrichten

1. Installiere die ntfy-App und abonniere das konfigurierte Topic auf dem richtigen Server.
2. Öffne die OpenCode-Weboberfläche auf dem iPhone und melde dich an. Speichere bei Bedarf die passende Serververbindung.
3. Prüfe eine echte Rückfrage und einen erfolgreichen Abschluss bei gesperrtem iPhone.
4. Tippe auf beide Meldungen. Beide müssen die jeweils auslösende Session öffnen, auch bei zwei parallelen Sessions.

Bei selbst betriebenem ntfy benötigt zeitnahe iOS-Zustellung einen APNS/Firebase-angebundenen Upstream,
üblicherweise `upstream-base-url: https://ntfy.sh`. Ohne ihn kann die Zustellung Stunden dauern.
Die OpenCode-Adresse muss vom Telefon erreichbar sein, gegebenenfalls über dessen VPN.

## Grenzen und Diagnose

Es gibt keine persistente Warteschlange und keine Nachlieferung für Ereignisse während eines Serverausfalls.
HTTP-Anfragen haben acht Sekunden Zeitlimit. Netzwerkfehler, HTTP 429 und Serverfehler werden höchstens dreimal versucht.
Andere HTTP-Fehler werden nicht wiederholt. Ein `Retry-After` über 30 Sekunden beendet diesen Zustellversuch.
Wenn ntfy eine Nachricht annimmt, die Antwort aber verloren geht, kann ein Wiederholungsversuch eine doppelte Meldung erzeugen.
Die letzten 1024 erfolgreich versendeten Ereignisse werden während der Laufzeit dedupliziert.
Der Ereignisstrom wird bei Unterbrechungen erneut abonniert. Fehler erscheinen mit dem Präfix `[mumme-it.ntfy]` im Serverlog,
ohne URLs, Tokens oder rohe Serverantworten auszugeben.

Das Plugin erkennt strukturierte Rückfragen des `question`-Werkzeugs. Eine nur als normaler Antworttext formulierte Frage
löst keine gesonderte Rückfragemeldung aus, aber nach dem Lauf die Abschlussmeldung.
Ein Betriebssystem-Kill kann keine zuverlässige Abbruchmeldung mehr auslösen.

## Lokale Prüfung

```sh
git clone https://github.com/Mumme-IT/opencode-ntfy.git
cd opencode-ntfy
npm test
npm run check
node scripts/check-package.js
```

Die Tests nutzen einen lokalen HTTP-Server. Sie versenden keine Nachrichten an einen echten ntfy-Dienst.
Für lokale Entwicklung kann der Paketeintrag auf das geklonte Pluginverzeichnis zeigen.

## Veröffentlichung auf npm

GitHub Actions prüft bei Pull Requests und Pushes auf `main` Syntax, Tests und den Paketinhalt unter Node.js 22 und 24.
Ein Tag `v0.1.0` startet `.github/workflows/publish.yml`. Der Workflow veröffentlicht nur dann,
wenn Tag und Version in `package.json` übereinstimmen. Die Veröffentlichung verwendet Node.js 24 und npm 11.19.0.
Die Paket-Positivliste enthält ausschließlich Runtime-Dateien, Paketmetadaten, README, Lizenz und Änderungsprotokoll.

### Erstveröffentlichung

Ein berechtigtes Mitglied der npm-Organisation `mumme-it` muss den Zugriff einmalig einrichten.
Für die erste Veröffentlichung eines noch nicht vorhandenen Pakets kann im Repository ein Actions-Secret
`NPM_TOKEN` hinterlegt werden. Verwende einen granularen npm-Token mit Schreibzugriff auf diesen Scope
und den für nicht interaktive Veröffentlichungen notwendigen 2FA-Einstellungen.
Tokens gehören nicht in Issues, Konfigurationsbeispiele oder Git-Dateien.

Wenn der erste Lauf an fehlender Anmeldung scheitert, richte den Zugang ein und starte den Workflow
**npm-Veröffentlichung** über **Run workflow** mit `tag: v0.1.0` erneut. Der Tag muss nicht neu erstellt werden.
Alternativ kann ein berechtigtes Mitglied nach `npm login` aus einem geprüften Checkout veröffentlichen:

```sh
npm publish --access public
```

### Weitere Releases mit Trusted Publishing

Richte in den npm-Paketeinstellungen einen GitHub-Trusted-Publisher ein:

- GitHub-Organisation: `Mumme-IT`
- Repository: `opencode-ntfy`
- Workflow-Datei: `publish.yml`
- Environment: keines
- Erlaube ausdrücklich die Veröffentlichung mit `npm publish`, falls npm dafür eine eigene Auswahl anbietet.

Nach erfolgreicher OIDC-Einrichtung kann das Repository-Secret `NPM_TOKEN` entfernt werden.
GitHub-hosted Runner erhalten über `id-token: write` kurzlebige Anmeldedaten.
`--provenance` erzeugt bei der CI-Veröffentlichung einen Herkunftsnachweis für das öffentliche Paket.

Erhöhe für ein neues Release die Version in `package.json`, ergänze `CHANGELOG.md`, prüfe die Änderungen
und pushe einen passenden `vX.Y.Z`-Tag. Erstelle anschließend das GitHub Release mit den deutschen Release Notes.
Prüfe den Workflow und die veröffentlichte npm-Version. Ein GitHub Release allein bestätigt keinen npm-Publish.

## Quellen für den V2-Vertrag

- [Plugin-Lebenszyklus und Ereignisabonnement](https://opencode.ai/v2/docs/build/plugins)
- [Lokale Plugins konfigurieren](https://opencode.ai/v2/docs/plugins)
- [Plugin.define ist eine Identitätsfunktion](https://github.com/anomalyco/opencode/blob/v2.1.3/packages/plugin/src/promise/plugin.ts)
- [Fragewerkzeug](https://github.com/anomalyco/opencode/blob/v2.1.3/packages/core/src/tool/plugin/question.ts)
- [Ausführungsereignisse](https://github.com/anomalyco/opencode/blob/v2.1.3/packages/schema/src/session-event.ts)
- [Web-Sessionroute](https://github.com/anomalyco/opencode/blob/v2.1.3/packages/app/src/shell/routes/session.ts)
- [ntfy Click action](https://docs.ntfy.sh/publish/#click-action)
- [ntfy unter iOS](https://docs.ntfy.sh/config/#ios-instant-notifications)
