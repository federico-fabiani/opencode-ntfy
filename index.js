import { readConfig, startNotifier } from "./notifier.js"

// Plugin.define ist in OpenCode V2 eine Identitätsfunktion. Dieses Objekt
// erfüllt denselben Vertrag ohne eine zweite Installation des Host-SDK.
export default {
  id: "mumme-it.ntfy",
  async setup(ctx) {
    const options = ctx.options ?? {}
    if (options.enabled !== undefined && typeof options.enabled !== "boolean") {
      throw new Error("ntfy: enabled muss true oder false sein.")
    }
    if (options.enabled === false) return
    const config = await readConfig(options)
    return startNotifier(ctx, config)
  },
}
