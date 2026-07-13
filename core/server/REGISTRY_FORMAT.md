# Community Plugin Registry Format

The registry is a JSON file (or a remote URL set via `PLUGIN_REGISTRY_URL`) that describes available community plugins.

## Top-level fields

| Field       | Type   | Description                                      |
|-------------|--------|--------------------------------------------------|
| `version`   | string | Registry schema version (e.g. `"1.0"`)           |
| `updatedAt` | string | ISO-8601 timestamp of last registry update        |
| `plugins`   | array  | List of plugin descriptor objects (see below)    |

## Plugin descriptor object

| Field            | Type           | Required | Description                                                   |
|------------------|----------------|----------|---------------------------------------------------------------|
| `id`             | string         | ✅       | Unique identifier. Pattern: `^[a-z][a-z0-9_-]{0,63}$`        |
| `name`           | string         | ✅       | Human-readable display name                                   |
| `author`         | string         | ✅       | Author handle (e.g. `community/username`)                     |
| `description`    | string         | ✅       | One-sentence description shown in the store card              |
| `version`        | string         | ✅       | SemVer version string (e.g. `"1.0.0"`)                        |
| `category`       | string         | ✅       | One of: `monitoring`, `ai`, `automation`, `iot`, `utility`   |
| `permissions`    | string[]       | ✅       | Required permissions (e.g. `["network", "filesystem"]`)       |
| `tags`           | string[]       | ✅       | Search/filter tags (lowercase, no spaces)                     |
| `iconUrl`        | string \| null | —        | HTTPS URL to a PNG/SVG icon (recommended 64×64)               |
| `entrypointUrl`  | string \| null | —        | HTTPS URL to the ESM plugin file. Must be from an approved domain. |
| `installCount`   | number         | ✅       | Approximate total installs (informational)                    |
| `readme`         | string         | ✅       | Short markdown description shown in the store                 |

## Approved entrypoint domains

Only the following origins are accepted for `entrypointUrl`:

- `https://raw.githubusercontent.com`
- `https://cdn.jsdelivr.net`
- `https://unpkg.com`

Plugin files at other origins will be rejected at install time.

## Plugin file interface

The ESM file at `entrypointUrl` must export a default class or object implementing:

```ts
interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  init(context: PluginContext): Promise<void>;
  on_event(event: BusEvent): Promise<void>;
  execute(command: string, args: Record<string, unknown>): Promise<{ output: string; data?: unknown }>;
  shutdown(): Promise<void>;
}
```

## Example entry

```json
{
  "id": "weather_monitor",
  "name": "Weather Monitor",
  "author": "community/weatherbot42",
  "description": "Fetches current weather and 7-day forecasts. Emits alerts on severe weather.",
  "version": "1.0.3",
  "category": "monitoring",
  "permissions": ["network"],
  "tags": ["weather", "monitoring", "alerts"],
  "iconUrl": null,
  "entrypointUrl": "https://raw.githubusercontent.com/deck-os/community-plugins/main/weather_monitor/index.mjs",
  "installCount": 412,
  "readme": "## Weather Monitor\n\nFetches weather data..."
}
```

## Contributing a plugin

1. Fork the community-plugins repository.
2. Add your plugin directory with `index.mjs` (ESM, implements the `Plugin` interface above).
3. Add a descriptor entry to `registry.json`.
4. Open a PR — maintainers will review permissions, validate the interface, and merge.
