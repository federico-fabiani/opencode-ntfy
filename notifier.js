import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

function httpURL(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`ntfy: ${name} fehlt.`)
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`ntfy: ${name} ist keine gültige URL.`)
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`ntfy: ${name} muss eine HTTP(S)-URL ohne Zugangsdaten, Query oder Fragment sein.`)
  }
  return value.trim()
}

export async function readConfig(options = {}, env = process.env) {
  const server = httpURL(options.server ?? env.OPENCODE_NTFY_SERVER ?? "https://ntfy.sh", "server").replace(/\/+$/, "")
  const topic = options.topic ?? env.OPENCODE_NTFY_TOPIC
  if (typeof topic !== "string" || !/^[-_A-Za-z0-9]{1,64}$/.test(topic)) {
    throw new Error("ntfy: topic muss 1–64 Buchstaben, Ziffern, Bindestriche oder Unterstriche enthalten.")
  }
  const webUrl = httpURL(options.webUrl ?? env.OPENCODE_NTFY_WEB_URL, "webUrl").replace(/\/+$/, "")
  // Der Serverschlüssel muss einschließlich eines abschließenden Slash erhalten bleiben.
  const serverUrl = httpURL(options.serverUrl ?? env.OPENCODE_NTFY_SERVER_URL ?? webUrl, "serverUrl")
  const tokenFile = options.tokenFile ?? env.OPENCODE_NTFY_TOKEN_FILE
  let token = env.OPENCODE_NTFY_TOKEN?.trim()
  if (tokenFile) {
    try {
      token = (await readFile(tokenFile, "utf8")).trim()
    } catch {
      throw new Error("ntfy: Token-Datei kann nicht gelesen werden.")
    }
    if (!token) throw new Error("ntfy: Token-Datei ist leer.")
  }
  if (token && /[\r\n]/.test(token)) throw new Error("ntfy: Token enthält einen Zeilenumbruch.")
  for (const key of ["questions", "permissions", "completions", "includeChildCompletions", "includeSessionTitle", "includeProjectName"]) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") {
      throw new Error(`ntfy: ${key} muss true oder false sein.`)
    }
  }
  for (const key of ["attentionPriority", "completionPriority"]) {
    if (options[key] !== undefined && (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > 5)) {
      throw new Error(`ntfy: ${key} muss eine ganze Zahl von 1 bis 5 sein.`)
    }
  }
  return {
    server, topic, webUrl, serverUrl, token,
    questions: options.questions !== false,
    permissions: options.permissions !== false,
    completions: options.completions !== false,
    includeChildCompletions: options.includeChildCompletions === true,
    includeSessionTitle: options.includeSessionTitle !== false,
    includeProjectName: options.includeProjectName !== false,
    attentionPriority: options.attentionPriority ?? 4,
    completionPriority: options.completionPriority ?? 3,
  }
}

export function sessionURL(config, sessionID) {
  const serverKey = Buffer.from(config.serverUrl, "utf8").toString("base64url")
  return `${config.webUrl}/server/${serverKey}/session/${encodeURIComponent(sessionID)}`
}

function sameLocation(left, right) {
  return left?.directory === right.directory && left?.workspaceID === right.workspaceID
}

function notificationEvent(event, config) {
  const data = event?.data
  if (!data) return
  switch (event.type) {
    case "form.created":
      if (!config.questions || data.form?.metadata?.kind !== "question") return
      return { sessionID: data.form.sessionID, key: `question:${data.form.id}`, title: "OpenCode: Rückfrage", priority: config.attentionPriority }
    case "permission.asked":
      if (!config.permissions) return
      return { sessionID: data.sessionID, key: `permission:${data.id}`, title: "OpenCode: Freigabe nötig", priority: config.attentionPriority }
    case "session.execution.succeeded":
      if (!config.completions) return
      return { sessionID: data.sessionID, key: event.id, title: "OpenCode: Agent fertig", completion: true, priority: config.completionPriority }
    case "session.execution.failed":
      if (!config.completions) return
      return { sessionID: data.sessionID, key: event.id, title: "OpenCode: Agent fehlgeschlagen", completion: true, priority: config.attentionPriority }
    case "session.execution.interrupted":
      if (!config.completions) return
      return { sessionID: data.sessionID, key: event.id, title: "OpenCode: Agent unterbrochen", completion: true, priority: config.completionPriority }
  }
}

function caption(value) {
  return String(value).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").slice(0, 160)
}

async function publish(config, payload, signal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted()
    let retryAfter = 1000 * 2 ** attempt
    let retry = true
    try {
      const response = await fetch(`${config.server}/`, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      })
      await response.body?.cancel()
      if (response.ok) return
      retry = response.status === 429 || response.status >= 500
      const header = response.headers.get("retry-after")
      if (header) {
        const seconds = Number(header)
        const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
        if (Number.isFinite(milliseconds)) retryAfter = Math.max(retryAfter, milliseconds)
      }
    } catch {
      signal.throwIfAborted()
    }
    // Lange Wartezeiten des Servers sollen andere Sessions nicht unnötig verzögern.
    if (!retry || retryAfter > 30000 || attempt === 2) throw new Error("ntfy: Zustellung fehlgeschlagen.")
    await delay(retryAfter, undefined, { signal })
  }
}

export function startNotifier(ctx, config) {
  const controller = new AbortController()
  const { signal } = controller
  const seen = new Set()
  const warn = (message) => console.warn(`[mumme-it.ntfy] ${message}`)

  async function handle(event) {
    const notice = notificationEvent(event, config)
    if (!notice || typeof notice.sessionID !== "string" || typeof notice.key !== "string") return
    if (seen.has(notice.key)) return
    // Jede Instanz gehört zu einem Ort, das Abonnement sieht jedoch serverweite Ereignisse.
    if (event.location && !sameLocation(event.location, ctx.location)) return
    const session = await ctx.session.get({ sessionID: notice.sessionID }, { signal })
    if (!sameLocation(session.location, ctx.location)) return
    if (notice.completion && session.parentID && !config.includeChildCompletions) return
    signal.throwIfAborted()
    const click = sessionURL(config, notice.sessionID)
    const message = [
      ...(config.includeSessionTitle ? [caption(session.title || notice.sessionID)] : []),
      ...(config.includeProjectName ? [caption(basename(session.location.directory))] : []),
      "Session öffnen.",
    ].join("\n")
    await publish(config, {
      topic: config.topic,
      title: notice.title,
      message,
      priority: notice.priority,
      click,
      actions: [{ action: "view", label: "Session öffnen", url: click }],
    }, signal)
    seen.add(notice.key)
    if (seen.size > 1024) seen.delete(seen.values().next().value)
  }

  const running = (async () => {
    while (!signal.aborted) {
      try {
        for await (const event of ctx.event.subscribe({ signal })) {
          if (signal.aborted) break
          try {
            await handle(event)
          } catch {
            if (!signal.aborted) warn("Benachrichtigung fehlgeschlagen. ntfy-Ziel und Sessionzugriff prüfen.")
          }
        }
        if (!signal.aborted) warn("Ereignisstrom beendet. Verbindung wird erneut aufgebaut.")
      } catch {
        if (!signal.aborted) warn("Ereignisstrom unterbrochen. Verbindung wird erneut aufgebaut.")
      }
      if (!signal.aborted) await delay(1000, undefined, { signal })
    }
  })().catch(() => {
    if (!signal.aborted) warn("Benachrichtigungsdienst unerwartet beendet.")
  })

  return async () => {
    controller.abort()
    await running
  }
}
