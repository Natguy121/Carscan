# CARSCAN

Point your camera at a car, take one photo, and the game tells you what it is —
then files it in your index with the full specification. A Pokédex for traffic.

Eighty real cars, from the Toyota Corolla to the Bugatti Chiron, each with
engine, power, torque, 0–60, top speed, drivetrain, weight and origin. Cars you
have not found yet show only a silhouette of their body style.

## How it plays

1. **Take one photo.** Stand back, fit the whole car in frame, tap the shutter.
   One shot, one tap — you are not circling a stranger's car with your phone out.
2. **Identify.** The photo is reverse-image searched through Google Cloud Vision
   Web Detection, and its best-guess label and web entities are ranked against
   the car database.
3. **Confirm.** If one car clearly wins, you get the reveal. If Vision cannot
   separate two trims of the same model — a 911 Carrera from a 911 Turbo S, say —
   the game hands you the shortlist and you settle it.
4. **Collect.** The car joins your Cardex with its full spec sheet, your photo of
   it, the colour you caught it in, and the date. Rarer cars are worth more XP.

Rarity runs Common → Uncommon → Rare → Epic → Legendary, and reflects how often
you would actually see the car on the road, not how good it is. There are eleven
achievements and a level track.

## Setup

Identification uses **Google Cloud Vision Web Detection**, the reverse-image
lookup behind Lens-style "best guess" results. You need your own key:

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Cloud Vision API** for it.
3. Create an API key under *APIs & Services → Credentials*.
4. Open CARSCAN, go to the **Garage** tab, paste the key, and save.

The free tier covers 1,000 Web Detection units per month, and a scan is one
photo and therefore one unit — about 1,000 free scans a month.

> **Restrict your key.** The key is stored in your browser's local storage and
> is sent directly from the page to Google, so anyone who can open your deployed
> page can read it. In the Cloud Console, restrict the key to the Cloud Vision
> API and to your own site's HTTP referrer. Do not commit a key to this repo.

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
Pages serves over HTTPS, so the camera works. Every player enters their own key
on their own device; nothing is shared.

### Deploying to Render

`render.yaml` declares this as a static site with no build step, so Render's
Blueprint deploy (New → Blueprint) picks it up automatically. Render's static
sites are served over HTTPS by default, so the camera works there too.

## Tests

```bash
npm test
```

Covers the identification pipeline against realistic Vision responses: a
confident hit, nicknames, the best-guess label outweighing a lower-ranked
entity, trim ambiguity, cars outside the database resolving to *unknown* rather
than to a wrong match, model-year disambiguation between generations, hyphen and
spacing variants of model codes, and database integrity.

## How identification works

| File | Role |
| --- | --- |
| `js/vision.js` | Calls Vision Web Detection, then folds the best-guess label and web entities into phrase and token tallies. The best guess carries the most weight; entity weights decay by rank. |
| `js/match.js` | Scores the fused text against the database. Rare tokens count for more (inverse document frequency), a phrase carrying both make and model counts for much more, and a phrase equal to a car's whole name is decisive. |
| `js/cars.js` | The 80 cars and their specifications. |
| `js/state.js` | Save file: entries, photos, XP, achievements. Sheds photos rather than progress if storage fills. |
| `js/camera.js` | Capture, downscaling, and the dominant-colour read. |

A verdict is only *identified* when one car both clears an absolute score and
beats the runner-up by a clear margin; otherwise you are asked to choose. That
is deliberate — a confident wrong answer is worse than an honest shortlist.

## Adding cars

Append to `CARS` in `js/cars.js`. The fields are self-explanatory; `rarity` must
be one of the five tiers and `body` one of the keys in `BODIES`. If the car is
commonly known by a nickname the make and model do not contain — *Miata*,
*Hachi-Roku*, *Godzilla* — add it to `ALIASES` in `js/match.js` so Vision's
wording still finds it. `npm test` checks new entries are well formed.

## Privacy

Your photo is sent to Google Vision for identification and is not stored
anywhere but your own browser. Progress, photos and your API key live in local storage on
your device only. There is no server and no account.
