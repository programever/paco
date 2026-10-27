# Races

One JSON file per race, bundled into the app. The format is easy-pacer's plan
file (version 1), so a plan saved from easy-pacer can be dropped in as-is.

```
{
  "version": 1,
  "name": "La Mia - cung Cam 20 km",
  "route": {
    "samples":   [{ "lat": 10.51, "lon": 107.11, "ele": 24.2 }, ...],   // the GPX track, in order
    "waypoints": [{ "name": "Quán cô Hường", "lat": ..., "lon": ... }]  // GPX <wpt>, may be empty
  },
  "checkpoints": [
    { "id": "0", "name": "Start", "km": 0,     "cutoff": null,    "target": null, "role": "start" },
    { "id": "1", "name": "CP1",   "km": 12.08, "cutoff": "09:30", "target": null, "role": "station" },
    { "id": "2", "name": "Finish","km": 19.96, "cutoff": "18:00", "target": null, "role": "finish" }
  ],
  "date": "2026-12-27",   // or null for a training route
  "time": "02:00"         // start time, or null
}
```

- `cutoff` is the checkpoint's COT as `HH:MM`, or `null` for no cutoff.
- `km` is measured along the track from the start.
- One `start` first, one `finish` last, `station` in between.

## Adding a race from a GPX file

Quick way, start and finish only:
`node tools/gpx-to-race.mjs <file.gpx> "<name>" > races/<id>.json`, then list it in `src/app/races.ts`.

By hand, with stations:

1. Take the track points (`<trkpt lat lon><ele>`) in order as `samples`, and the
   `<wpt>` points as `waypoints`.
2. Find each checkpoint's km on the track (nearest track point to the
   checkpoint's position, measured along the track).
3. Fill `cutoff` from the organizer's table, or `null`.
4. Save as `races/<short-name>.json` and add it to the race list in the app.

The five Núi Dinh training routes came from easy-pacer's `src/Storage/Seeded.elm`.
