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

// Titel je Sprache. Der Standard bleibt Deutsch, damit die Upstream-Tests und
// bestehende Installationen unverändert weiterlaufen.
const TITLES = {
  de: {
    question: "OpenCode: Rückfrage",
    permission: "OpenCode: Freigabe nötig",
    done: "OpenCode: Agent fertig",
    failed: "OpenCode: Agent fehlgeschlagen",
    interrupted: "OpenCode: Agent unterbrochen",
    retry: "OpenCode: Wartet auf Provider",
    idle: "OpenCode: wartet auf dich",
  },
  it: {
    question: "OpenCode: domanda",
    permission: "OpenCode: permesso richiesto",
    done: "OpenCode: finito",
    failed: "OpenCode: errore",
    interrupted: "OpenCode: interrotto",
    retry: "OpenCode: in attesa del provider",
    idle: "OpenCode: in attesa di te",
  },
}

// Emoji-Shortcodes von ntfy: unterscheiden die Ereignisart auf einen Blick.
const TAGS = {
  question: ["question"],
  permission: ["warning"],
  done: ["white_check_mark"],
  failed: ["rotating_light"],
  interrupted: ["octagonal_sign"],
  retry: ["hourglass_flowing_sand"],
  idle: ["zzz"],
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
  for (const key of ["questions", "permissions", "completions", "includeChildCompletions", "includeSessionTitle", "includeProjectName", "includeDetail", "includePermissionResources"]) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") {
      throw new Error(`ntfy: ${key} muss true oder false sein.`)
    }
  }
  for (const key of ["attentionPriority", "completionPriority"]) {
    if (options[key] !== undefined && (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > 5)) {
      throw new Error(`ntfy: ${key} muss eine ganze Zahl von 1 bis 5 sein.`)
    }
  }
  const language = options.language ?? "de"
  if (!Object.hasOwn(TITLES, language)) {
    throw new Error(`ntfy: language muss eine von ${Object.keys(TITLES).join(", ")} sein.`)
  }
  for (const key of ["questionDelay", "permissionDelay", "completionDelay", "errorDelay"]) {
    const value = options[key]
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 600)) {
      throw new Error(`ntfy: ${key} muss eine Zahl von 0 bis 600 Sekunden sein.`)
    }
  }
  const maxPerMinute = options.maxPerMinute ?? 30
  if (!Number.isInteger(maxPerMinute) || maxPerMinute < 1 || maxPerMinute > 600) {
    throw new Error("ntfy: maxPerMinute muss eine ganze Zahl von 1 bis 600 sein.")
  }
  return {
    server, topic, webUrl, serverUrl, token, language, maxPerMinute,
    questions: options.questions !== false,
    permissions: options.permissions !== false,
    completions: options.completions !== false,
    includeChildCompletions: options.includeChildCompletions === true,
    includeSessionTitle: options.includeSessionTitle !== false,
    includeProjectName: options.includeProjectName !== false,
    includeDetail: options.includeDetail !== false,
    includePermissionResources: options.includePermissionResources === true,
    questionDelay: options.questionDelay ?? 30,
    permissionDelay: options.permissionDelay ?? 20,
    completionDelay: options.completionDelay ?? 60,
    errorDelay: options.errorDelay ?? 15,
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
  const titles = TITLES[config.language]
  switch (event.type) {
    case "form.created":
      if (!config.questions || data.form?.metadata?.kind !== "question") return
      return {
        sessionID: data.form.sessionID,
        key: `question:${data.form.id}`,
        title: titles.question,
        tags: TAGS.question,
        detail: data.form.title,
        delay: config.questionDelay * 1000,
        priority: config.attentionPriority,
      }
    case "permission.asked": {
      if (!config.permissions) return
      // Ressourcen können Befehle mit Tokens enthalten: nur auf ausdrücklichen Wunsch mitsenden.
      const resources = config.includePermissionResources && Array.isArray(data.resources) ? data.resources : []
      return {
        sessionID: data.sessionID,
        key: `permission:${data.id}`,
        title: titles.permission,
        tags: TAGS.permission,
        detail: [data.action, ...resources].filter((part) => typeof part === "string" && part).join(" "),
        delay: config.permissionDelay * 1000,
        priority: config.attentionPriority,
      }
    }
    case "session.execution.succeeded":
      if (!config.completions) return
      return { sessionID: data.sessionID, key: event.id, title: titles.done, tags: TAGS.done, completion: true, delay: config.completionDelay * 1000, priority: config.completionPriority }
    case "session.execution.failed":
      if (!config.completions) return
      return { sessionID: data.sessionID, key: event.id, title: titles.failed, tags: TAGS.failed, completion: true, delay: config.errorDelay * 1000, priority: config.attentionPriority }
    case "session.execution.interrupted":
      if (!config.completions) return
      return { sessionID: data.sessionID, key: event.id, title: titles.interrupted, tags: TAGS.interrupted, completion: true, delay: config.completionDelay * 1000, priority: config.completionPriority }
    // Der Agent ist fertig, aber der Lauf ist nicht "succeeded": session.idle
    // ist das Ereignis, das im Chat tatsächlich am Ende eines Turns kommt.
    case "session.idle":
      if (!config.completions) return
      return { sessionID: data.sessionID, key: event.id, title: titles.idle, tags: TAGS.idle, completion: true, idle: true, delay: config.completionDelay * 1000, priority: config.completionPriority }
    // Der Provider begrenzt gerade: kein Fehler der Sitzung, aber relevant für die Planung.
    case "session.retry.scheduled":
      return {
        sessionID: data.sessionID,
        key: event.id ?? `retry:${data.sessionID}`,
        title: titles.retry,
        tags: TAGS.retry,
        delay: config.errorDelay * 1000,
        priority: config.attentionPriority,
      }
  }
}

function caption(value) {
  return String(value).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").slice(0, 160)
}

async function publish(config, payload, signal) {
  let lastStatus
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
      lastStatus = response.status
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
    if (!retry || retryAfter > 30000 || attempt === 2) {
      throw new Error(`ntfy: Zustellung fehlgeschlagen${lastStatus ? ` (HTTP ${lastStatus})` : ""}.`)
    }
    await delay(retryAfter, undefined, { signal })
  }
}

export function startNotifier(ctx, config) {
  const controller = new AbortController()
  const { signal } = controller
  const seen = new Set()
  // Letzte Meldung pro Sitzung: session.idle kommt nach jedem Turn und wäre
  // direkt nach einem Abschluss oder einer Freigabe nur Rauschen.
  const lastSent = new Map()
  const IDLE_QUIET_MS = 60_000
  const sent = []
  let limitWarnedAt = 0
  const warn = (message) => console.warn(`[mumme-it.ntfy] ${message}`)

  // Einfache Gleitfenster-Bremse: verhindert Notifikationslawinen, wenn ein
  // Workflow viele Sitzungen auf einmal startet.
  const allow = () => {
    const now = Date.now()
    while (sent.length > 0 && now - sent[0] >= 60_000) sent.shift()
    if (sent.length >= config.maxPerMinute) return false
    sent.push(now)
    return true
  }

  // Eine Meldung geht nicht sofort raus. Sie wird kurz zurückgehalten und
  // verworfen, wenn in der Zwischenzeit geantwortet, die Sitzung neu gestartet
  // oder eine andere Sitzung geöffnet wurde: wer ohnehin hinsieht, braucht
  // keinen Push.
  const pending = new Map()

  function hasPendingCompletion(sessionID) {
    for (const entry of pending.values()) {
      if (entry.sessionID === sessionID && entry.completion) return true
    }
    return false
  }

  function dropPending(key) {
    const entry = pending.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(key)
  }

  function dropSession(sessionID) {
    for (const [key, entry] of [...pending]) {
      if (entry.sessionID !== sessionID) continue
      clearTimeout(entry.timer)
      pending.delete(key)
    }
  }

  function cancelFor(event) {
    const data = event.data ?? {}
    if (event.type === "permission.replied" && typeof data.id === "string") return dropPending(`permission:${data.id}`)
    if (event.type === "form.replied" && typeof data.id === "string") return dropPending(`question:${data.id}`)
    if ((event.type === "session.viewed" || event.type === "session.execution.started") && typeof data.sessionID === "string") {
      return dropSession(data.sessionID)
    }
  }

  async function deliver(notice, session) {
    if (notice.idle) {
      const last = lastSent.get(notice.sessionID) ?? 0
      if (Date.now() - last < IDLE_QUIET_MS) return
    }
    signal.throwIfAborted()
    if (!allow()) {
      const now = Date.now()
      if (now - limitWarnedAt > 60_000) {
        limitWarnedAt = now
        warn(`Mehr als ${config.maxPerMinute} Meldungen pro Minute; weitere werden verworfen.`)
      }
      return
    }
    const click = sessionURL(config, notice.sessionID)
    const message = [
      ...(config.includeSessionTitle ? [caption(session.title || notice.sessionID)] : []),
      ...(config.includeDetail && notice.detail ? [caption(notice.detail)] : []),
      ...(config.includeProjectName ? [caption(basename(session.location.directory))] : []),
    ].join("\n").trim()
    await publish(config, {
      topic: config.topic,
      title: notice.title,
      // ntfy verlangt einen Text; die Sitzungs-ID ist der letzte Ausweg.
      message: message || notice.sessionID,
      priority: notice.priority,
      click,
      ...(notice.tags ? { tags: notice.tags } : {}),
      actions: [{ action: "view", label: config.language === "it" ? "Apri sessione" : "Session öffnen", url: click }],
    }, signal)
    lastSent.set(notice.sessionID, Date.now())
    if (lastSent.size > 1024) lastSent.delete(lastSent.keys().next().value)
  }

  async function handle(event) {
    const notice = notificationEvent(event, config)
    if (!notice || typeof notice.sessionID !== "string" || typeof notice.key !== "string") {
      cancelFor(event)
      return
    }
    if (seen.has(notice.key)) return
    // Jede Instanz gehört zu einem Ort, das Abonnement sieht jedoch serverweite Ereignisse.
    if (event.location && !sameLocation(event.location, ctx.location)) return
    // session.idle ist nur der Ersatz, wenn kein Abschluss angekündigt ist.
    if (notice.idle && hasPendingCompletion(notice.sessionID)) return
    const session = await ctx.session.get({ sessionID: notice.sessionID }, { signal })
    if (!sameLocation(session.location, ctx.location)) return
    if (notice.completion && session.parentID && !config.includeChildCompletions) return
    seen.add(notice.key)
    const delayMs = notice.delay ?? 0
    if (delayMs > 0) {
      if (pending.size >= 128) {
        warn("Zu viele ausstehende Meldungen; eine wird verworfen.")
        return
      }
      const timer = setTimeout(() => {
        pending.delete(notice.key)
        if (signal.aborted) return
        deliver(notice, session).catch(() => {
          if (!signal.aborted) warn("Benachrichtigung fehlgeschlagen. ntfy-Ziel und Sessionzugriff prüfen.")
        })
      }, delayMs)
      timer.unref?.()
      pending.set(notice.key, { timer, sessionID: notice.sessionID, completion: !!notice.completion })
      return
    }
    await deliver(notice, session)
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
    for (const entry of pending.values()) clearTimeout(entry.timer)
    pending.clear()
    controller.abort()
    await running
  }
}
