# CARSCAN

Point your camera at a car, take one photo, and pick it out of a shortlist —
then it's filed in your index with the full specification. A Pokédex for
traffic.

188 real cars, from the Toyota Corolla to the Bugatti Chiron, each with engine,
power, torque, 0–60, top speed, drivetrain, weight and origin. Cars you have not
found yet show only a silhouette of their body style.

The set is weighted towards what is actually parked outside: the best-selling
saloons, crossovers, pickups and vans of North America and Europe, from the
Kia Sorento and Tesla Model Y to the Dacia Sandero and Vauxhall Corsa — plus the
exotics worth the walk across the car park.

Anything else you point it at still counts. A car that isn't in the index can
be typed in by hand and enters as a **Wild** catch — the name, your photo, the
colour and the date, without the numbers — so no scan of a real car is ever
turned away.

## How it plays

1. **Take one photo.** Stand back, fit the whole car in frame, tap the shutter.
2. **Identify.** A small recognition model runs right there in your browser —
   no internet round trip — and guesses the car's body style (SUV, pickup,
   sedan…) and reads its colour off the photo.
3. **Confirm.** You get a shortlist of cars matching that body style, commonest
   first, and tap the right one. On-device recognition can spot a shape; it
   can't read a badge, so you always make the final call.
4. **Collect.** The car joins your Cardex with its full spec sheet, your photo
   of it, the colour you caught it in, and the date. Rarer cars are worth more
   XP. Not in the list? Type its name and it's logged as a Wild catch instead.
   Only a photo with no car in it at all is turned away.

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

Covers the recognition mapping (ImageNet classes → body style, and telling a
car photo from a non-car one), the shortlist ranking (body-style match first,
then commonness), and database integrity.

## How identification works

| File | Role |
| --- | --- |
| `js/classify.js` | Loads MobileNet via TensorFlow.js on first use and classifies the photo. Maps its ImageNet classes to a body style (`inferBodyFromPredictions`) and decides whether the photo has a car in it at all (`looksLikeVehicle`) — both pure functions, easy to test without a model. |
| `js/match.js` | Builds the shortlist: cars matching the guessed body style first, then ranked by rarity so the common ones you're actually likely to see come first. |
| `js/cars.js` | The 188 cars and their specifications. |
| `js/state.js` | Save file: entries, photos, XP, achievements. Sheds photos rather than progress if storage fills. |
| `js/camera.js` | Capture, downscaling, and the dominant-colour read. |

MobileNet knows 1,000 general ImageNet categories — "pickup truck", "sports
car", "minivan" — never an exact make and model, which no free, on-device model
can do. That's an honest limit of running locally rather than paying a cloud
vision API, so the app leans into it: it narrows the shape, you make the call.

## Adding cars

You do not have to — anything the index does not know can be typed in and
caught as a Wild entry. Adding a car to `CARS` in `js/cars.js` is how it gains a
*spec sheet* and a place in the index proper. The fields are self-explanatory;
`rarity` must be one of the five tiers and `body` one of the keys in `BODIES`.
`npm test` checks new entries are well formed.

## Privacy

Nothing leaves your device. Recognition runs locally, and progress and photos
live in local storage on your device only. There is no server and no account.
