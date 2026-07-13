/**
 * Weather Monitor — Community Plugin v1.0.4
 * Polls Open-Meteo API (no key required) every 15 minutes and emits weather events.
 * Source: https://raw.githubusercontent.com/deck-os/community-plugins/main/weather_monitor/index.mjs
 */

export default class WeatherMonitor {
  id = "weather_monitor";
  name = "Weather Monitor";
  version = "1.0.4";
  description = "Fetches current weather and 7-day forecasts for your location. Emits alerts when severe weather is detected.";
  category = "monitoring";

  constructor() {
    this._ctx = null;
    this._timer = null;
    this._lat = 40.7128;
    this._lon = -74.006;
    this._lastWeather = null;
    this._pollIntervalMs = 15 * 60 * 1000;
  }

  async init(ctx) {
    this._ctx = ctx;
    ctx.logger.info("WeatherMonitor: initialised — polling Open-Meteo every 15 minutes");

    ctx.http.register("GET", "/current", async (_req) => ({
      status: 200,
      body: {
        weather: this._lastWeather,
        coordinates: { lat: this._lat, lon: this._lon },
        pollIntervalMinutes: this._pollIntervalMs / 60_000,
      },
    }));

    ctx.subscribe("weather_monitor.configure", (event) => {
      const { lat, lon, intervalMinutes } = event.payload ?? {};
      if (typeof lat === "number") this._lat = lat;
      if (typeof lon === "number") this._lon = lon;
      if (typeof intervalMinutes === "number" && intervalMinutes > 0) {
        this._pollIntervalMs = intervalMinutes * 60 * 1000;
        if (this._timer) {
          clearInterval(this._timer);
          this._timer = setInterval(() => this._poll(), this._pollIntervalMs);
        }
      }
      ctx.logger.info(`WeatherMonitor: configuration updated — lat=${this._lat}, lon=${this._lon}`);
      void this._poll();
    });

    await this._poll();
    this._timer = setInterval(() => void this._poll(), this._pollIntervalMs);
  }

  async on_event(event) {
    if (event.type === "system.shutdown") {
      await this.shutdown();
    }
  }

  async execute(payload) {
    const cmd = (payload && payload.command) ? payload.command : "status";
    if (cmd === "status") {
      return {
        success: true,
        weather: this._lastWeather,
        coordinates: { lat: this._lat, lon: this._lon },
        pollIntervalMinutes: this._pollIntervalMs / 60_000,
      };
    }
    if (cmd === "poll") {
      await this._poll();
      return { success: true, weather: this._lastWeather };
    }
    if (cmd === "configure") {
      const { lat, lon } = payload ?? {};
      if (typeof lat === "number") this._lat = lat;
      if (typeof lon === "number") this._lon = lon;
      await this._poll();
      return { success: true, coordinates: { lat: this._lat, lon: this._lon } };
    }
    return { success: false, error: `Unknown command: ${cmd}` };
  }

  async shutdown() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._ctx?.logger.info("WeatherMonitor: shut down");
  }

  async _poll() {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${this._lat}&longitude=${this._lon}` +
        `&current=temperature_2m,wind_speed_10m,weathercode,relative_humidity_2m` +
        `&wind_speed_unit=mph&timezone=auto`;

      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Open-Meteo`);

      const data = await res.json();
      const current = data.current ?? {};
      const units = data.current_units ?? {};

      this._lastWeather = {
        latitude: this._lat,
        longitude: this._lon,
        temperature: current.temperature_2m,
        temperatureUnit: units.temperature_2m ?? "°C",
        windSpeed: current.wind_speed_10m,
        windSpeedUnit: units.wind_speed_10m ?? "mph",
        humidity: current.relative_humidity_2m,
        weatherCode: current.weathercode,
        time: current.time,
        fetchedAt: new Date().toISOString(),
      };

      this._ctx?.emit({
        source: `plugin.${this.id}`,
        target: null,
        type: "weather.update",
        payload: this._lastWeather,
      });

      if (typeof current.weathercode === "number" && current.weathercode >= 80) {
        this._ctx?.emit({
          source: `plugin.${this.id}`,
          target: null,
          type: "notification.created",
          payload: {
            title: "Weather Alert",
            message: `Severe weather detected (code ${current.weathercode}) at (${this._lat}, ${this._lon})`,
            severity: "warning",
            pluginId: this.id,
          },
        });
      }

      this._ctx?.logger.info(
        `WeatherMonitor: temp=${current.temperature_2m}${units.temperature_2m ?? "°C"}, ` +
        `wind=${current.wind_speed_10m}${units.wind_speed_10m ?? "mph"}, code=${current.weathercode}`,
      );
    } catch (err) {
      this._ctx?.logger.warn(`WeatherMonitor: poll failed — ${err && err.message ? err.message : String(err)}`);
    }
  }
}
