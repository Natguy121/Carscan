# PLANSCAN

Floor plans from your phone. Walk around a room, press your phone against
each wall, and get a measured, to-scale plan — with doors, windows, floor
area and wall area — that you can export as an image.

Inspired by how RoomScan's original version worked: no special hardware,
just the motion sensors every phone already has.

## How it works

1. **Touch each wall.** Hold the phone flat, screen up, and press its long
   edge against the wall with the top pointing the way you're walking. When
   the on-screen level goes green, tap **Capture wall**. The phone records
   which way that wall runs.
2. **Type its length** — from a tape measure, a laser measure, or by pacing
   it out. Two walls can be left blank: a room has to close back on itself,
   so the last two lengths can be worked out from the rest. Measure two
   adjacent walls of a rectangle and you're done.
3. **Walk round** to the next wall the same way and repeat until you're back
   at the start. The live preview draws the room as you go and closes it as
   soon as it can.
4. **Finish room.** Corners that are nearly 90° are squared up, the small
   mismatch every tape-measured room has is shared out across the walls so the
   plan closes exactly, and the room is added to the plan.

Then:

- **Tap a wall** to correct its length, or add a door or window to it.
- **Tap a room** to rename it, set the ceiling height (for wall area — handy
  for paint — and volume), turn it, or square up its corners.
- **Drag rooms** to fit them together; corners click onto each other.
- **Export** the plan as a PNG or SVG, black on white, or copy the room list
  as text.

No phone handy? **Draw by hand** builds a room from turns (left, right, 45°)
and lengths, and **Rectangle** makes one from a width and length.

Metric and imperial both work, and you can type lengths however you'd write
them: `3.45`, `345cm`, `12' 6"`, `12ft 6in`, `12 6`.

## What it can't do

There's no LiDAR here. A web page can't reach a phone's depth sensor or run
the kind of AR room capture a native app can — that needs a native iOS app
built on Apple's RoomPlan. What a browser *can* read is the phone's
orientation, which measures **angles** well but not **distances**, so lengths
come from you.

The angle comes from the gyroscope-fused orientation rather than the raw
compass, so metal and wiring in walls don't throw it the way they throw a
compass needle. Because it's relative to where the phone started, rooms in
the same plan aren't automatically lined up with each other — drag and turn
them into place.

## Setup

None. Open the page. Plans are saved in the browser's own storage — no
account, nothing uploaded.

Motion sensors only work over HTTPS (or `localhost`), and iPhones ask for
permission the first time you scan.

## Running it

Plain HTML, CSS and ES modules — no build step, no dependencies.

```bash
npm start          # serves on http://localhost:8080
npm test
```

`render.yaml` deploys it to Render as a static site; GitHub Pages works too.

## Code

| File | Role |
| --- | --- |
| `js/geometry.js` | The maths. `solveRoom` turns a list of `{heading, length}` walls into corners: fills in up to two missing lengths, then closes the loop by weighted least squares on the lengths alone, so headings — and right angles — survive. `squareUp` snaps nearly-square headings onto the room's own grid, not north's. |
| `js/sensors.js` | Reads `deviceorientation`, averages headings over the last 0.6 s (wrapping properly across 0°/360°), and reports whether the phone is flat and steady enough to capture. |
| `js/units.js` | Parses tape-measure input and formats lengths, areas and volumes. Everything is stored in metres. |
| `js/render.js` | Draws plans and the live scan preview as self-contained SVG — the same markup is used on screen and for export. |
| `js/store.js` | Saves plans and settings in local storage. |
| `js/app.js` | Views, sheets, scanning flow, dragging, export. |
