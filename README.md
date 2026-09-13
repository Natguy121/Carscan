# CARSCAN

Point your camera at a car, take one photo, and pick it out of a shortlist —
then it's filed in your index with the full specification. A Pokédex for
traffic.

898 real cars across 115 makes, from the Toyota Corolla to the Bugatti Chiron,
each with engine, power, torque, 0–60, top speed, drivetrain, weight and origin.
Every figure is a real published spec — nothing is invented. Cars you have not
found yet show only a silhouette of their body style.

The set covers what is actually parked outside — the best-selling saloons,
crossovers, pickups and vans of North America and Europe — plus the cars worth
crossing a car park for: JDM heroes, European classics, American muscle, and the
hypercars. Many nameplates appear across several generations, so an E30 M3 and a
G80 M3 are separate catches.

## How it plays

1. **Take one photo.** Stand back, fit the whole car in frame, tap the shutter.
2. **Identify.** A small recognition model runs right there in your browser —
   no internet round trip — and guesses the car's body style (SUV, pickup,
   sedan…).
3. **Confirm — and teach it.** You get a shortlist of cars matching that body
   style and tap the right one — or type in the search box to find any of the
   898. The shortlist is ordered by what you're most likely to be looking at:
   cars you've caught before come first, then makes you catch often, then the
   commonest on the road. When the body-style guess is shaky the list widens and
   says so.

   **It reads character, not just shape.** Two cars can share a body style and
   have nothing else in common — a Lamborghini Urus and a school-run RAV4 are
   both SUVs — and the model does see the difference, calling one a sports car
   and the other a jeep. That read reorders the shortlist, so a sporty-looking
   SUV puts the fast ones first and a family-sized one puts the seven-seaters
   first. It only ever reorders; it can never hide a car, because a "sports car"
   reading might just be a four-seat GT.

   **Read the badge and it narrows to just that make.** The model can't read a
   logo — MobileNet has no idea what a Toyota badge looks like — but you can, so
   typing the make you can actually see on the car cuts the index straight down
   to it: 898 → 17 for Toyota's SUVs alone. It only ever suggests makes still
   possible given everything else you've told it, never one already ruled out.
   If badges have been taught in the [Logo trainer](#logo-trainer), a trained
   match shows up here too, as a "Trained badge match" chip to confirm — a hint,
   never an autofill.

   **Whatever you tap, it learns — and then it guesses.** Confirming a car
   files that photo's fingerprint under it, and the next time you scan
   something similar the app recognises it on its own, pins it to the top of
   the list marked **Best guess**, and asks "Is this it?" instead of "Which one
   is it?" — still a tap to confirm, never an automatic catch, but the guess
   itself comes entirely from what it has actually seen before, not from
   ticking boxes. The more you play, the more it knows the cars on *your*
   street. The Garage has *Export learned cars* / *Import learned cars* so this
   can move between devices, or be baked into `data/memory.seed.json` — see
   [Logo trainer](#logo-trainer) for how the same mechanism works for badges;
   this is its plainer sibling, no password, since it's just your own play data.
4. **Collect.** The car joins your Cardex with its full spec sheet, your photo
   of it, and the date. Rarer cars are worth more XP.

A photo the model can't find a car in at all — a steep angle from above, the car
mostly hidden behind something, bad light — gets a **"Couldn't tell if that's a
car"** screen, not a dead end. One tap on *Yes, it's a car* drops straight into
the full 898-car list, so a genuine car is never actually turned away; the model
only ever fails to confirm one, and you always get the last word.

Rarity runs Common → Uncommon → Rare → Epic → Legendary, and reflects how often
you would actually see the car on the road, not how good it is. There are eleven
achievements and a level track.

## Setup

None. Open the page and start scanning — no account, no API key, no billing,
nothing to sign up for. Recognition is a small on-device model (MobileNet, via
TensorFlow.js) that downloads once from a public CDN the first time you use it,
then runs entirely on your device.

## Running it

The app is plain HTML, CSS and ES modules — no build step, no dependencies.

```bash
npm start          # serves on http://localhost:8080
```

Camera access requires a secure context, so use `localhost` in development and
HTTPS in production. Without a camera you can still play: **Upload** feeds a
photo through exactly the same pipeline.

### Deploying to GitHub Pages

Push, then in the repository settings enable Pages from your branch's root.
Pages serves over HTTPS, so the camera works, and there is nothing else to
configure — every visitor's recognition runs on their own device.

### Deploying to Render

`render.yaml` declares this as a static site with no build step, so Render's
Blueprint deploy (New → Blueprint) picks it up automatically. Render's static
sites are served over HTTPS by default, so the camera works there too.

## Tests

```bash
npm test
```

Covers the recognition mapping (ImageNet classes → body style, weighted by
confidence; telling a car photo from a non-car one), the shortlist ranking
(body style outranking character, character outranking history, history
outranking commonness), the character read (a fast SUV read apart from a
school-run one, a split read left uncalled, and reordering that never drops a
car), the learned memory and the logo
trainer (recognising a photo it has seen before, refusing to match an
unrelated one, staying inside its storage budget, and export/import/seed
loading never overwriting what a player learned themselves), and database
integrity — every entry unique, well formed, and using a real body style and
rarity.

## How identification works

| File | Role |
| --- | --- |
| `js/classify.js` | Loads MobileNet via TensorFlow.js on first use and classifies the photo. `inferBody` adds each vehicle class's probability to its body style and picks the heaviest, returning a confidence alongside it, so several weak agreeing guesses beat one stronger disagreeing one. `inferCharacter` reads sporty / hard-working / family-sized off the same predictions, and returns nothing at all when the read is split. `looksLikeVehicle` decides whether the photo has a car in it. All pure functions, easy to test without a model. |
| `js/app.js` (badge picker) | The one manual narrowing left: type the make you can actually read on the car and the whole index narrows to it. This is the closest thing to "brand recognition" in the app, and it works by trusting the player's eyes rather than pretending MobileNet can read a logo. |
| `js/memory.js` | The part that learns. MobileNet's second-to-last layer turns a photo into a fingerprint where two photos of the same car land close together; confirming a car files that fingerprint under it, and a later scan is matched against them by cosine similarity. Quantised to a byte per number and capped at 240 samples, evicting from whichever car has the most so a daily commuter can't crowd out a one-off. `loadSeedMemory` fetches `data/memory.seed.json` once per device on startup and imports it without ever touching what a player has caught themselves — the same seeding trick as `logos.js`, minus the password, since this is just ordinary play data rather than a shared brand asset. |
| `js/logos.js` | The same fingerprint trick as `memory.js`, filed under a make instead of a car, from a close-up photo of just the badge. `loadSeedLogos` fetches `data/logos.seed.json` once per device on startup and imports it without ever touching what a player has taught themselves. See [Logo trainer](#logo-trainer) below. |
| `js/match.js` | Builds the shortlist: body style first, then whether the car fits the character the photo read as, then cars you have already caught, then makes you catch often, then commonness. Your own scan record is real evidence about what is parked near you. A car recognised from memory is pinned above all of it. |
| `js/cars.js` | The 898 cars and their specifications. |
| `js/state.js` | Save file: entries, photos, XP, achievements. Sheds photos rather than progress if storage fills. |
| `js/camera.js` | Camera access, capture, and downscaling. |

MobileNet knows 1,000 general ImageNet categories — "pickup truck", "sports
car", "minivan" — never an exact make and model, which no free, on-device model
can do. That's an honest limit of running locally rather than paying a cloud
vision API, so the app leans into it: it narrows the shape, you make the call,
and it remembers what you called it.

That last part is what closes the gap over time. It never learns "Fortuner" in
general — it learns *the* Fortuner you photographed, and others that look like
it. So the app is vague on day one and sharp on the cars you actually see, which
is the opposite of a cloud model and, for a game about your own street, more
useful. Nothing is downloaded and nothing is uploaded to make that happen.

## Logo trainer

A "Logo trainer" link sits at the bottom of the Garage. It exists because
MobileNet has no concept of a car badge — its 1,000 ImageNet categories don't
include logos, and a real logo detector needs its own labeled dataset and
training pipeline, the same wall hit trying to get exact make/model
recognition generally. This is the honest alternative: teach the app from
photos yourself, on-device, the same embedding trick `memory.js` already uses
for whole cars, just filed under a make instead of a car and trained from a
close-up of just the badge rather than the whole vehicle.

**Photos, many at once.** Once unlocked, pick a make, then either tap
*Take a photo* for a live camera view with a shutter — teaching one loops
straight back into the viewfinder for the next shot, so several photos of the
same badge from different angles is a burst, not a menu you re-enter every
time — or *Upload photos* and select a whole batch from your gallery at once,
which teaches every file in it under the make you picked. More photos of the
same badge, not fancier ones, is what actually makes a badge recognisable.

**The password.** First time you open it, you set one. There's no server, so
it's checked against a SHA-256 hash kept in this browser's own local storage —
never the plaintext, and nothing sent anywhere. Be clear about what this
actually is: it stops another player on the same device from casually filling
the trainer with junk. It does **not** stop anyone who opens developer tools —
that's a real limit of a password with no server behind it, not a bug — so
never reuse a password you use anywhere else.

**Training only affects this device — unless you ship it.** Like everything
else here, trained badges live in local storage, not a shared database.
*Export trained set* downloads them as JSON; *Import* merges a file back in.
That's how a trained set moves between devices, and it's also how the app can
ship with badges already known: train some, export, and drop the file in as
`data/logos.seed.json`. Every visitor's copy of the app fetches that file once
(same-origin, no CDN, so it works wherever the site is hosted) and imports it
automatically on first load — never overwriting anything a player has already
taught themselves. This is also the answer to "can I just hand you photos to
train it": nothing here can run a photo through MobileNet outside a real
browser, so train in yours, export, and hand over the file instead of the
photos — that file is what actually gets baked in.

**How it's used.** A trained badge only ever appears as a suggestion chip —
"Trained badge match: Toyota?" — next to the badge-typing box on a scan,
never an automatic pick. It also only fires when a scan happens to be framed
similarly to the training photos, since the fingerprint is sensitive to what's
actually in the picture: a close-up of a badge and a photo of a whole car
rarely land close together even when it's the same make. That's a real
limitation of doing this with a general-purpose model rather than one trained
specifically to find logos in a wider scene — worth having since it's free
when it works, but not a substitute for reading the badge yourself.

## Adding cars

Append to `CARS` in `js/cars.js`. The fields are self-explanatory; `rarity` must
be one of the five tiers and `body` one of the keys in `BODIES`. `npm test`
checks every entry is well formed, uniquely identified, and uses a real body
style and rarity.

Only add specifications you can verify. The point of the Cardex is that the
numbers on a spec sheet are true.

## Privacy

Nothing leaves your device on its own. Recognition runs locally, and progress,
photos, the learned fingerprints, and anything taught in the logo trainer
(including its password hash) live in local storage on your device only. There
is no server and no account. The only way anything leaves is you choosing
*Export* — a JSON file you save and hand over yourself — and the only way
anything arrives is *Import*, or the app's own seed files loading once on
first run. Resetting progress in the Garage also wipes what it has learned;
the logo trainer's own *Forget all* clears just the trained badges.
