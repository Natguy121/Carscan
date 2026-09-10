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
   sedan…) and reads its colour off the photo.
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

   **Can't see it in the list? Narrow it down.** Thirty more things you can
   check from the pavement — sits up high, diesel clatter, V8 rumble, seven
   seats, looks pre-1990 — each a filter over the whole index. The shape ones
   fill themselves in from what the model saw, so you only ever tick what it
   couldn't tell. A tick cycles yes → no → unanswered, and a *no* narrows as hard
   as a *yes*.

   **Whatever you tap, it learns.** Confirming a car files that photo's
   fingerprint under it, and the next time you scan something similar the app
   recognises it on its own — "Recognised from memory" — and puts that car at the
   top. The more you play, the more it knows the cars on *your* street.
4. **Collect.** The car joins your Cardex with its full spec sheet, your photo
   of it, the colour you caught it in, and the date. Rarer cars are worth more
   XP.

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
car), the thirty traits (each splits the index, the shape fills itself in from
the guess, dead ends are never offered), the learned memory (recognising a car from a similar photo, refusing to match an
unrelated one, staying inside its storage budget), and database integrity —
every entry unique, well formed, and using a real body style and rarity.

## How identification works

| File | Role |
| --- | --- |
| `js/classify.js` | Loads MobileNet via TensorFlow.js on first use and classifies the photo. `inferBody` adds each vehicle class's probability to its body style and picks the heaviest, returning a confidence alongside it, so several weak agreeing guesses beat one stronger disagreeing one. `inferCharacter` reads sporty / hard-working / family-sized off the same predictions, and returns nothing at all when the read is split. `looksLikeVehicle` decides whether the photo has a car in it. All pure functions, easy to test without a model. |
| `js/app.js` (badge picker) | The one exact-match filter that isn't a trait: type the make you can actually read on the car and the whole index narrows to it. Suggestions are drawn only from makes still possible given every other answer, the same "no dead ends" rule the traits follow. This is the closest thing to "brand recognition" in the app, and it works by trusting the player's eyes rather than pretending MobileNet can read a logo. |
| `js/traits.js` | The thirty things to look for. Every trait is derived from a field already in the database — `country`, `body`, `seats`, the parsed `engine` string, the first year in `years` — so a trait is never a new claim about a car, just a verified spec turned into something you can check by looking. `answersForBody` settles all six shape traits from the model's own guess. Traits that would empty the list, or that every remaining car shares, are withheld. |
| `js/memory.js` | The part that learns. MobileNet's second-to-last layer turns a photo into a fingerprint where two photos of the same car land close together; confirming a car files that fingerprint under it, and a later scan is matched against them by cosine similarity. Quantised to a byte per number and capped at 240 samples, evicting from whichever car has the most so a daily commuter can't crowd out a one-off. |
| `js/logos.js` | The same fingerprint trick as `memory.js`, filed under a make instead of a car, from a close-up photo of just the badge. See [Logo trainer](#logo-trainer) below. |
| `js/match.js` | Builds the shortlist: body style first, then whether the car fits the character the photo read as, then cars you have already caught, then makes you catch often, then commonness. Your own scan record is real evidence about what is parked near you. A car recognised from memory is pinned above all of it. |
| `js/cars.js` | The 898 cars and their specifications. |
| `js/state.js` | Save file: entries, photos, XP, achievements. Sheds photos rather than progress if storage fills. |
| `js/camera.js` | Capture, downscaling, and the dominant-colour read. |

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

**The password.** First time you open it, you set one. There's no server, so
it's checked against a SHA-256 hash kept in this browser's own local storage —
never the plaintext, and nothing sent anywhere. Be clear about what this
actually is: it stops another player on the same device from casually filling
the trainer with junk. It does **not** stop anyone who opens developer tools —
that's a real limit of a password with no server behind it, not a bug — so
never reuse a password you use anywhere else.

**Training only affects this device.** Like everything else here, trained
badges live in local storage, not a shared database. *Export trained set*
downloads them as JSON; *Import* merges a file back in. That's how a trained
set moves between devices, or how you'd hand one to someone else to bake into
their own copy of the app.

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

Nothing leaves your device. Recognition runs locally, and progress, photos,
the learned fingerprints, and anything taught in the logo trainer (including
its password hash) live in local storage on your device only. There is no
server and no account. Resetting progress in the Garage also wipes what it has
learned; the logo trainer's own *Forget all* clears just the trained badges.
