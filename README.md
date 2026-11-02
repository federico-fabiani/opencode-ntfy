# @mumme-it/opencode-ntfy

Konfigurierbare ntfy-Benachrichtigungen für OpenCode V2 ohne externe Laufzeitabhängigkeiten.
Jede Meldung enthält einen direkten Link zur auslösenden Session.
Der Plugin-Vertrag ist mit OpenCode `2.1.3` geprüft. Node.js ab Version 22 ist erforderlich.

> **Fork.** Dieses Repository ist ein Fork von [Mumme-IT/opencode-ntfy](https://github.com/Mumme-IT/opencode-ntfy)
> (MIT-Lizenz, Autor: Mumme-IT). Die Idee, der Ereigniskatalog und die Zustelllogik stammen von dort.
> Ergänzt wurden Meldungstext mit Inhalt, Emoji-Tags, `session.retry.scheduled`,
> ein Ratenbegrenzer und eine Sprachauswahl. Upstream bleibt die Referenz.

## Verhalten

- Echte Rückfragen: `form.created` mit `metadata.kind === "question"`.
- Freigaben: `permission.asked`, standardmäßig eingeschaltet.
- Abschluss: `session.execution.succeeded`. Fehler und Abbrüche erhalten eigene Meldungen.
- Jede Meldung enthält eine ntfy-Click-URL und die Aktion **Session öffnen** zur auslösenden Session.
- Rückfragen von Unteragenten werden ebenfalls gemeldet. Abschlüsse von Unteragenten sind standardmäßig ausgeschaltet.
- Nachrichten enthalten standardmäßig Sessiontitel und Projektverzeichnisnamen. Beide Angaben lassen sich ausschalten.
- Frageinhalte werden als Nachrichtentext eingebaut (Fragentitel), Freigaben als Aktion. Antworten, Fehlermeldungen und Zugangsdaten werden nicht übernommen. Ressourcen von Freigaben können Befehle mit Tokens enthalten und bleiben deshalb standardmäßig ausgeschlossen.
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
- `includeDetail: false`: den inhaltlichen Teil (Fragentitel, Aktion einer Freigabe) aus dem Nachrichtentext entfernen. Standard: `true`.
- `includePermissionResources: true`: Ressourcen einer Freigabe mitsenden. Standard: `false`, weil Befehle Tokens enthalten können.
- `language`: Sprache für Titel und Aktionslabel, `de` oder `it`. Standard: `de`.
- `maxPerMinute`: Obergrenze für Meldungen pro Minute, ganzzahlig von `1` bis `600`. Standard: `30`.
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

**Wenn der Link auf der Startseite landet statt in der Sitzung**, dann weicht `serverUrl` von der im
Web-UI gespeicherten Verbindung ab. Meist ist es nur ein abschließender Schrägstrich: die Oberfläche
speichert je nach Eingabe `https://host` oder `https://host/`. Beide Varianten sind gültig, aber die
Serverkennung ist `base64url` der exakten Zeichenkette. Mit `node scripts/session-link.js <sessionID> <webUrl>`
lassen sich beide Kandidaten ausgeben und am Telefon gegeneinander prüfen. Ist die Verbindung ohne
abschließenden `/` gespeichert, ist der Standardweg richtig: `serverUrl` weglassen, dann wird `webUrl`
ohne Schrägstrich verwendet.

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
Ein neuer Tag `vX.Y.Z` startet `.github/workflows/publish.yml`. Der Workflow veröffentlicht nur dann,
wenn Tag und Version in `package.json` übereinstimmen. Die Veröffentlichung verwendet Node.js 24 und npm 11.19.0.
Die Paket-Positivliste enthält ausschließlich Runtime-Dateien, Paketmetadaten, README, Lizenz und Änderungsprotokoll.

### Erstveröffentlichung

Ein berechtigtes Mitglied der npm-Organisation `mumme-it` veröffentlicht Version `0.1.0` einmalig lokal.
Verwende Node.js ab Version 22. Der folgende Block erstellt einen separaten Checkout des vorhandenen Tags;
die aktive Plugininstallation und ihre persönliche Konfiguration bleiben unverändert.

```sh
(
  set -eu
  bootstrap_dir="$(mktemp -d)"
  git clone --branch v0.1.0 --depth 1 https://github.com/Mumme-IT/opencode-ntfy.git "$bootstrap_dir/opencode-ntfy"
  cd "$bootstrap_dir/opencode-ntfy"
  npm login --registry=https://registry.npmjs.org/
  npm publish --access public --provenance=false --ignore-scripts=false --registry=https://registry.npmjs.org/
  npm view @mumme-it/opencode-ntfy@0.1.0 version --registry=https://registry.npmjs.org/
)
```

Bestätige die Anmeldung und gegebenenfalls 2FA im Browser. `prepublishOnly` führt Syntaxprüfung und Tests aus.
`--provenance=false` überschreibt eine eventuell lokal gesetzte Provenance-Konfiguration,
weil ein lokales Terminal keinen GitHub-OIDC-Herkunftsnachweis erstellen kann.
Der vorhandene Tag enthält in `publishConfig` nur `access: public`, keinen eigenen Provenance-Wert.
Wenn Version `0.1.0` bereits existiert, veröffentliche sie nicht erneut. npm-Versionen sind unveränderlich.
Löse nach erfolgreicher Erstveröffentlichung weder den alten Workflow-Lauf noch den Tag `v0.1.0` erneut aus.

### Weitere Releases mit Trusted Publishing

Der Workflow verwendet ausschließlich OIDC und benötigt kein `NPM_TOKEN` oder anderes npm-Secret.
Die npm-seitige Vertrauensverbindung lässt sich erst nach der Erstveröffentlichung einrichten.
Mit npm ab Version `11.15.0`, einem angemeldeten Konto mit aktiviertem 2FA und Schreibzugriff:

```sh
npm trust github @mumme-it/opencode-ntfy --repo Mumme-IT/opencode-ntfy --file publish.yml --allow-publish --registry=https://registry.npmjs.org/
npm trust list @mumme-it/opencode-ntfy --registry=https://registry.npmjs.org/
```

Bestätige die angeforderte 2FA. Bei einer älteren lokalen npm-Version kannst du beide Befehle
mit `npx --yes --package=npm@11.19.0 npm` statt `npm` starten, ohne npm global zu ändern.
Alternativ öffne die [npm-Paketeinstellungen](https://www.npmjs.com/package/@mumme-it/opencode-ntfy/access),
wähle **Trusted publishing → GitHub Actions** und trage Folgendes ein:

- GitHub-Organisation: `Mumme-IT`
- Repository: `opencode-ntfy`
- Workflow-Datei: `publish.yml`
- Environment: keines
- Aktiviere **Allow npm publish** ausdrücklich; eine reine Stage-Berechtigung reicht für diesen Workflow nicht.

GitHub-hosted Runner erhalten über `id-token: write` kurzlebige Anmeldedaten.
`--provenance` erzeugt bei der CI-Veröffentlichung einen Herkunftsnachweis für das öffentliche Paket.
Eine neue Vertrauensverbindung muss laut npm innerhalb von zwei Tagen erstmals erfolgreich veröffentlichen,
sonst muss sie neu angelegt werden. Richte sie deshalb zeitnah vor dem nächsten tatsächlichen Release ein.
Veröffentliche keine bereits vorhandene Version nur zum Testen der Verbindung.

Erhöhe für ein neues Release die Version in `package.json`, ergänze `CHANGELOG.md`, prüfe die Änderungen
und pushe einen passenden `vX.Y.Z`-Tag. Erstelle anschließend das GitHub Release mit den deutschen Release Notes.
Prüfe den Workflow und die veröffentlichte npm-Version. Ein GitHub Release allein bestätigt keinen npm-Publish.
Die npm-Einrichtung und ihre erste erfolgreiche OIDC-Veröffentlichung sind getrennt zu prüfen.

Offizielle npm-Dokumentation: [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
und [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust).

## Quellen für den V2-Vertrag

- [Plugin-Lebenszyklus und Ereignisabonnement](https://opencode.ai/v2/docs/build/plugins)
- [Lokale Plugins konfigurieren](https://opencode.ai/v2/docs/plugins)
- [Plugin.define ist eine Identitätsfunktion](https://github.com/anomalyco/opencode/blob/v2.1.3/packages/plugin/src/promise/plugin.ts)
- [Fragewerkzeug](https://github.com/anomalyco/opencode/blob/v2.1.3/packages/core/src/tool/plugin/question.ts)
- [Ausführungsereignisse](https://github.com/anomalyco/opencode/blob/v2.1.3/packages/schema/src/session-event.ts)
- [Web-Sessionroute](https://github.com/anomalyco/opencode/blob/v2.1.3/packages/app/src/shell/routes/session.ts)
- [ntfy Click action](https://docs.ntfy.sh/publish/#click-action)
- [ntfy unter iOS](https://docs.ntfy.sh/config/#ios-instant-notifications)
