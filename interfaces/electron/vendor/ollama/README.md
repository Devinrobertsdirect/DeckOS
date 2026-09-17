# vendor/ollama — bundled local-model runtime (sidecar)

This folder is shipped into the packaged app as `resources/ollama`. On launch,
`main.js` runs `ollama serve` from here so a **fresh machine has a free local
brain with zero setup**; the API server then auto-pulls a small default model
(`llama3.2:3b`) and warms it.

**The Ollama binary is large + platform-specific, so it is NOT committed.**
Populate this folder before packaging:

```bash
cd interfaces/electron
npm run fetch-ollama      # downloads the runtime for the current platform
npm run pack -- --win     # (or --mac / --linux)
```

If this folder is empty at build time, the app still works — `main.js` falls
back to a **system-installed** Ollama, and if there's none, to a cloud key or
the built-in rule engine. Nothing breaks; you just don't get the zero-setup
local brain.
