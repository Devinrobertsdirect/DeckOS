---
name: example-weather
description: Fetch and summarise current weather conditions for a location. Use when the user asks about the weather, temperature, wind, rain, or whether to go outside — anything forecast-shaped.
---

# Weather lookup

Answer weather questions with live data from the Open-Meteo API (free, no API
key). Never guess weather from memory.

## Steps

1. **Resolve the location.** If the user named a place, geocode it:

   ```
   GET https://geocoding-api.open-meteo.com/v1/search?name=<place>&count=1
   ```

   Take `results[0].latitude` / `longitude`. If no location was given, use the
   user's saved home location from memory; if none exists, ask.

2. **Fetch conditions:**

   ```
   GET https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto
   ```

3. **Decode `weather_code`** (WMO): 0 clear · 1–3 partly cloudy · 45/48 fog ·
   51–67 drizzle/rain · 71–77 snow · 80–82 showers · 95–99 thunderstorm.

4. **Report in persona.** One or two sentences: current temp (and feels-like
   when it differs by 3° or more), the sky, today's high/low, and rain chance
   if above 30%. Add one practical nudge ("take a jacket") when warranted —
   skip it for bare data requests.

## Rules

- Units follow the user's locale (assume °C unless they use °F).
- If the API is unreachable, say so plainly — do not invent a forecast.
- For multi-day forecasts, extend `daily` params with `&forecast_days=7`
  rather than calling multiple times.
