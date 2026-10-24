import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"

// Die Positivliste verhindert, dass Tests, Konfiguration oder CI-Dateien im Paket landen.
const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }))
assert.deepEqual(pack.files.map((file) => file.path).sort(), [
  "CHANGELOG.md", "LICENSE", "README.md", "index.js", "notifier.js", "package.json",
].sort())
assert.equal(pack.name, "@mumme-it/opencode-ntfy")
console.log(`Paketinhalt geprüft: ${pack.files.length} Dateien, ${pack.filename}`)
