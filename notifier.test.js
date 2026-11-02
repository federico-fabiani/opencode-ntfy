import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { once } from "node:events"
import { test } from "node:test"
import plugin from "./index.js"
import { readConfig, sessionURL } from "./notifier.js"

const location = { directory: "/projects/example", workspaceID: "workspace-one" }
const options = {
  topic: "test-topic",
  webUrl: "https://code.example.test",
  serverUrl: "https://backend.example.test/",
}

function event(type, sessionID, extra = {}) {
  return { id: `evt_${sessionID}_${type}`, type, location, data: { sessionID, ...extra } }
}

function question(sessionID, id = `form_${sessionID}`) {
  return event("form.created", sessionID, { form: { id, sessionID, title: "Soll ich fortfahren?", metadata: { kind: "question" } } })
}

async function harness(t, events, { overrides = {}, sessions = {}, respond, subscribe } = {}) {
  const requests = []
  const warnings = []
  const lookups = []
  t.mock.method(console, "warn", (message) => warnings.push(message))
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    })
    if (respond) return respond(response, requests.length)
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end('{"id":"test"}')
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  let cleanup
  t.after(async () => {
    await cleanup?.()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const { promise: drained, resolve: finish } = Promise.withResolvers()
  let streamSignal
  const ctx = {
    options: { ...options, server: `http://127.0.0.1:${server.address().port}`, ...overrides },
    location,
    session: {
      async get({ sessionID }) {
        lookups.push(sessionID)
        return { id: sessionID, title: `Titel ${sessionID}`, location, ...sessions[sessionID] }
      },
    },
    event: {
      async *subscribe({ signal }) {
        streamSignal = signal
        if (subscribe) await subscribe()
        for (const item of events) yield item
        finish()
        if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
      },
    },
  }
  cleanup = await plugin.setup(ctx)
  return { requests, warnings, lookups, drained, cleanup, ctx, signal: () => streamSignal }
}

test("Rückfragen und Abschluss öffnen die richtige Session, auch parallel und ohne alte Idle-Duplikate", { timeout: 5000 }, async (t) => {
  const done = event("session.execution.succeeded", "ses_A")
  const events = [
    question("ses_A"), question("ses_B"), question("ses_A"),
    done, event("session.status", "ses_A", { status: { type: "idle" } }), done,
    event("session.execution.succeeded", "ses_B"),
  ]
  const h = await harness(t, events)
  await h.drained
  assert.equal(h.requests.length, 4)
  assert.deepEqual(h.requests.map((request) => request.body.title), [
    "OpenCode: Rückfrage", "OpenCode: Rückfrage", "OpenCode: Agent fertig", "OpenCode: Agent fertig",
  ])
  for (const [index, id] of ["ses_A", "ses_B", "ses_A", "ses_B"].entries()) {
    const request = h.requests[index]
    assert.equal(request.method, "POST")
    assert.equal(request.body.topic, "test-topic")
    const link = new URL(request.body.click)
    assert.equal(link.origin, options.webUrl)
    const [, prefix, serverKey, sessionPrefix, sessionID] = link.pathname.split("/")
    assert.equal(prefix, "server")
    assert.equal(Buffer.from(serverKey, "base64url").toString(), options.serverUrl)
    assert.equal(sessionPrefix, "session")
    assert.equal(sessionID, id)
    assert.equal(request.body.actions[0].url, request.body.click)
    assert.match(request.body.message, new RegExp(`Titel ${id}`))
  }
  await h.cleanup()
  assert.equal(h.signal().aborted, true)
  assert.deepEqual(h.warnings, [])
})

test("Fragen sind von Formularen und Freigaben getrennt; Fehler und Abbruch sind keine Erfolge", { timeout: 5000 }, async (t) => {
  const unrelated = question("ses_other")
  unrelated.data.form.metadata.kind = "another-form"
  const h = await harness(t, [
    unrelated,
    event("permission.asked", "ses_A", { id: "permission_1", action: "shell", resources: ["secret"] }),
    event("session.execution.failed", "ses_A", { error: { message: "secret" } }),
    event("session.execution.interrupted", "ses_B", { reason: "user" }),
    { type: "form.created", data: {} },
  ])
  await h.drained
  assert.deepEqual(h.requests.map((r) => r.body.title), [
    "OpenCode: Freigabe nötig", "OpenCode: Agent fehlgeschlagen", "OpenCode: Agent unterbrochen",
  ])
  assert.ok(h.requests.every((r) => !JSON.stringify(r.body).includes("secret")))
})

test("Ort und Workspace verhindern doppelte Meldungen; Unteragentenfragen bleiben erhalten", { timeout: 5000 }, async (t) => {
  const foreignEvent = { ...question("ses_foreign"), location: { ...location, directory: "/other" } }
  const workspaceEvent = { ...question("ses_workspace"), location: { ...location, workspaceID: "workspace-two" } }
  const noLocation = { ...question("ses_lookup"), location: undefined }
  const h = await harness(t, [
    foreignEvent, workspaceEvent, noLocation,
    question("ses_child"), event("session.execution.succeeded", "ses_child"),
    event("session.execution.succeeded", "ses_parent"),
  ], { sessions: {
    ses_lookup: { location: { directory: "/other" } },
    ses_child: { parentID: "ses_parent" },
  } })
  await h.drained
  assert.equal(h.requests.length, 2)
  assert.ok(h.requests[0].body.click.endsWith("/ses_child"))
  assert.ok(h.requests[1].body.click.endsWith("/ses_parent"))
  assert.ok(!h.lookups.includes("ses_foreign"))
  assert.ok(!h.lookups.includes("ses_workspace"))
})

test("Freigaben können entfallen und Unteragentenabschlüsse eingeschaltet werden", { timeout: 5000 }, async (t) => {
  const h = await harness(t, [
    event("permission.asked", "ses_child", { id: "permission_1" }),
    question("ses_child"), event("session.execution.succeeded", "ses_child"),
  ], { overrides: { permissions: false, includeChildCompletions: true }, sessions: { ses_child: { parentID: "ses_parent" } } })
  await h.drained
  assert.equal(h.requests.length, 2)
  assert.deepEqual(h.requests.map((r) => r.body.priority), [4, 3])
})

test("Temporäre HTTP-Fehler werden wiederholt; HTTP 401 blockiert spätere Sessions nicht", { timeout: 8000 }, async (t) => {
  const h = await harness(t, [question("ses_A"), question("ses_B"), question("ses_C")], {
    respond(response, count) {
      response.writeHead(count === 1 ? 503 : count === 3 ? 401 : 200)
      response.end("sensitive server response")
    },
  })
  await h.drained
  assert.equal(h.requests.length, 4)
  assert.deepEqual(h.requests.map((r) => r.body.click.split("/").at(-1)), ["ses_A", "ses_A", "ses_B", "ses_C"])
  assert.equal(h.warnings.length, 1)
  assert.ok(!h.warnings.join().includes("sensitive"))
})

test("Cleanup bricht laufende Zustellung ab", { timeout: 5000 }, async (t) => {
  const { promise, resolve } = Promise.withResolvers()
  const h = await harness(t, [question("ses_A")], { respond() { resolve() } })
  await promise
  await h.cleanup()
  assert.equal(h.requests.length, 1)
  assert.equal(h.signal().aborted, true)
  assert.deepEqual(h.warnings, [])
})

test("Abgebrochener Ereignisstrom wird erneut abonniert", { timeout: 5000 }, async (t) => {
  let attempts = 0
  const h = await harness(t, [question("ses_A")], {
    subscribe() { if (++attempts === 1) throw new Error("private connection detail") },
  })
  await h.drained
  assert.equal(attempts, 2)
  assert.equal(h.requests.length, 1)
  assert.equal(h.warnings.length, 1)
  assert.ok(!h.warnings.join().includes("private"))
})

test("Konfiguration validiert Ziele und hält das Token aus Sessionlinks heraus", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-ntfy-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const tokenFile = join(directory, "token")
  await writeFile(tokenFile, "private-token\n", { mode: 0o600 })
  const config = await readConfig({ ...options, tokenFile }, { OPENCODE_NTFY_TOKEN: "overridden" })
  assert.equal(config.token, "private-token")
  assert.equal(config.server, "https://ntfy.sh")
  assert.ok(!sessionURL(config, "ses_test").includes("private-token"))
  for (const invalid of [
    { topic: "invalid/topic" }, { webUrl: "javascript:alert(1)" },
    { webUrl: "https://user:password@example.test" }, { serverUrl: "https://example.test?token=secret" },
    { permissions: "false" }, { questions: 0 }, { completions: "true" },
    { includeSessionTitle: null }, { includeProjectName: "false" },
    { attentionPriority: 0 }, { attentionPriority: 6 }, { completionPriority: 2.5 }, { completionPriority: "3" },
  ]) await assert.rejects(readConfig({ ...options, ...invalid }, {}))
  await assert.rejects(readConfig({}, {}), /topic/)
  await assert.rejects(readConfig({ topic: "ok" }, {}), /webUrl/)
  assert.equal(await plugin.setup({ options: { enabled: false } }), undefined)
  await assert.rejects(plugin.setup({ options: { enabled: "false" } }), /enabled/)
})

test("Token-Datei wird als Bearer-Header gesendet, nicht als Inhalt oder URL", { timeout: 5000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-ntfy-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const tokenFile = join(directory, "token")
  await writeFile(tokenFile, "test-private-token\n", { mode: 0o600 })
  const h = await harness(t, [question("ses_A")], { overrides: { tokenFile } })
  await h.drained
  assert.equal(h.requests[0].headers.authorization, "Bearer test-private-token")
  assert.ok(!JSON.stringify(h.requests[0].body).includes("test-private-token"))
  assert.equal(h.requests[0].url, "/")
})

test("Fragen und Abschlussmeldungen lassen sich zusammen ausschalten", { timeout: 5000 }, async (t) => {
  const h = await harness(t, [
    question("ses_A"),
    event("permission.asked", "ses_A", { id: "permission_1" }),
    event("session.execution.succeeded", "ses_A"),
    event("session.execution.failed", "ses_A"),
    event("session.execution.interrupted", "ses_A"),
  ], { overrides: { questions: false, completions: false } })
  await h.drained
  assert.deepEqual(h.requests.map((r) => r.body.title), ["OpenCode: Freigabe nötig"])
  assert.deepEqual(h.lookups, ["ses_A"])
})

test("Prioritäten gelten für alle Ereignisarten und private Metadaten können entfallen", { timeout: 5000 }, async (t) => {
  const h = await harness(t, [
    question("ses_A"),
    event("permission.asked", "ses_A", { id: "permission_1" }),
    event("session.execution.succeeded", "ses_A"),
    event("session.execution.failed", "ses_A"),
    event("session.execution.interrupted", "ses_A"),
  ], { overrides: { attentionPriority: 5, completionPriority: 1, includeSessionTitle: false, includeProjectName: false } })
  await h.drained
  assert.deepEqual(h.requests.map((r) => r.body.priority), [5, 5, 1, 5, 1])
  assert.equal(h.requests[0].body.message, "Soll ich fortfahren?")
  assert.ok(h.requests.slice(1).every((r) => r.body.message === "ses_A"))
  assert.ok(h.requests.every((r) => r.body.click.endsWith("/ses_A")))
})

test("Sessiontitel und Projektname können getrennt ausgeblendet werden", { timeout: 5000 }, async (t) => {
  for (const [overrides, message] of [
    [{ includeSessionTitle: false }, "Soll ich fortfahren?\nexample"],
    [{ includeProjectName: false }, "Titel ses_A\nSoll ich fortfahren?"],
  ]) {
    const h = await harness(t, [question("ses_A")], { overrides })
    await h.drained
    assert.equal(h.requests[0].body.message, message)
    await h.cleanup()
  }
})

test("Fragen und Abschlüsse können jeweils ohne die andere Ereignisart aktiv bleiben", { timeout: 5000 }, async (t) => {
  for (const [overrides, expected] of [
    [{ questions: false }, "OpenCode: Agent fertig"],
    [{ completions: false }, "OpenCode: Rückfrage"],
  ]) {
    const h = await harness(t, [question("ses_A"), event("session.execution.succeeded", "ses_A")], { overrides })
    await h.drained
    assert.deepEqual(h.requests.map((r) => r.body.title), [expected])
    await h.cleanup()
  }
})

test("Optionen überschreiben Umgebungsvariablen; Umgebungsziele funktionieren ohne Optionen", async () => {
  const env = {
    OPENCODE_NTFY_SERVER: "https://ntfy.example.test/prefix/",
    OPENCODE_NTFY_TOPIC: "environment-topic",
    OPENCODE_NTFY_WEB_URL: "https://web.example.test/",
    OPENCODE_NTFY_SERVER_URL: "https://server.example.test/",
    OPENCODE_NTFY_TOKEN: "environment-token",
  }
  const fromEnv = await readConfig({}, env)
  assert.equal(fromEnv.server, "https://ntfy.example.test/prefix")
  assert.equal(fromEnv.topic, env.OPENCODE_NTFY_TOPIC)
  assert.equal(fromEnv.webUrl, "https://web.example.test")
  assert.equal(fromEnv.serverUrl, env.OPENCODE_NTFY_SERVER_URL)
  assert.equal(fromEnv.token, env.OPENCODE_NTFY_TOKEN)
  const explicit = await readConfig(options, env)
  assert.equal(explicit.topic, options.topic)
  assert.equal(explicit.webUrl, options.webUrl)
  assert.equal(explicit.serverUrl, options.serverUrl)
})

test("Freigaben zeigen Aktion und Ressource; Emoji-Tags unterscheiden die Ereignisart", { timeout: 5000 }, async (t) => {
  const h = await harness(t, [
    event("permission.asked", "ses_A", { id: "permission_1", action: "bash", resources: ["npm test"] }),
    event("session.retry.scheduled", "ses_A"),
  ], { overrides: { includePermissionResources: true } })
  await h.drained
  assert.equal(h.requests.length, 2)
  assert.match(h.requests[0].body.message, /bash npm test/)
  assert.deepEqual(h.requests[0].body.tags, ["warning"])
  assert.equal(h.requests[1].body.title, "OpenCode: Wartet auf Provider")
  assert.deepEqual(h.requests[1].body.tags, ["hourglass_flowing_sand"])
})

test("maxPerMinute verwirft zusätzliche Meldungen und warnt einmal", { timeout: 5000 }, async (t) => {
  const events = ["ses_A", "ses_B", "ses_C", "ses_D"].map((id) => event("session.execution.succeeded", id))
  const h = await harness(t, events, { overrides: { maxPerMinute: 2 } })
  await h.drained
  assert.equal(h.requests.length, 2)
  assert.equal(h.warnings.filter((w) => w.includes("Meldungen pro Minute")).length, 1)
})

test("Sprache it übersetzt Titel und Aktionslabel", { timeout: 5000 }, async (t) => {
  const h = await harness(t, [question("ses_A")], { overrides: { language: "it" } })
  await h.drained
  assert.equal(h.requests[0].body.title, "OpenCode: domanda")
  assert.equal(h.requests[0].body.actions[0].label, "Apri sessione")
})

test("Unbekannte Sprache wird abgelehnt", async () => {
  await assert.rejects(readConfig({ topic: "ok", language: "xx" }, { OPENCODE_NTFY_WEB_URL: "https://web.example.test" }), /language/)
})

test("session.idle meldet das Ende eines Chat-Turns", { timeout: 5000 }, async (t) => {
  const h = await harness(t, [event("session.idle", "ses_A")])
  await h.drained
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].body.title, "OpenCode: wartet auf dich")
  assert.deepEqual(h.requests[0].body.tags, ["zzz"])
})

test("session.idle direkt nach einer Freigabe ist kein zweiter Alarm", { timeout: 5000 }, async (t) => {
  const h = await harness(t, [
    event("permission.asked", "ses_A", { id: "permission_1", action: "bash", resources: [] }),
    event("session.idle", "ses_A"),
  ])
  await h.drained
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].body.title, "OpenCode: Freigabe nötig")
})
