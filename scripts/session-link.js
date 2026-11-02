#!/usr/bin/env node
// Gibt die Kandidaten-Links für eine Sitzung aus.
//
// Die Serverkennung im Web-UI ist base64url der Verbindungs-URL, wie sie im
// Browser gespeichert ist. Ob dort ein abschließender Schrägstrich steht,
// hängt davon ab, wie der Server hinzugefügt wurde. Dieses Skript zeigt beide
// Varianten, damit man am Telefon die richtige erkennt.
//
// Verwendung:
//   node scripts/session-link.js <sessionID> <webUrl>

const [sessionID, webUrl] = process.argv.slice(2)
if (!sessionID || !webUrl) {
  console.error("Verwendung: node scripts/session-link.js <sessionID> <webUrl>")
  process.exit(2)
}

const base = webUrl.replace(/\/+$/, "")
for (const connection of [base, `${base}/`]) {
  const key = Buffer.from(connection, "utf8").toString("base64url")
  console.log(`${connection}\n  ${base}/server/${key}/session/${encodeURIComponent(sessionID)}\n`)
}
