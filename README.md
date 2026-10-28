# Paco

Paco is an iPhone app for trail races, made for one runner (Iker). It is a React Native rewrite of
[easy-pacer](https://github.com/programever/easy-pacer). It keeps GPS on with the screen locked, places the
runner on the race route, and says short voice alerts: km to the next checkpoint, poles on or off, off route.
When the runner is lost, a big arrow turned by the phone compass points back to the route.

Races are bundled in `races/` (see `races/README.md`).

```
src/core/    pure race logic (route, position, climbs, alerts), tested with vitest
src/crew/    what Paco and the crew page say to each other (shared by both)
src/app/     GPS task, stored run, notifications, the crew link
src/ui/      screens
web/         the crew page (a website)
tests/       npm test
```

## Crew page

https://programever.github.io/paco/#KEY shows a friend (the crew) where the runner is, on a map and on the
route, the runner's status, the next checkpoints with a guessed arrival time and the COT margin. The crew can
send short messages to the runner.

How it works:

- Paco makes a random key once and keeps it. The Crew tab shows the link with the key and a Share button.
- **Position** (the newest only): Paco writes `paco/{key}` at most every 5 minutes. A new position replaces
  the old one. Without signal, only the newest position is sent when the signal comes back.
- **Taps** (OK, Tired, Resting, Injured, Need, Quit, SOS, Got it): each tap is saved in a queue file on the
  phone and written as one record in `paco/{key}/taps/`. Nothing is lost without signal.
- **Messages**: the page writes `paco/{key}/msgs/`. Paco fetches them on the same trips as the position (and
  every 30 s while the Crew tab is on screen), then shows an alert and says "Message from crew". There is no
  push: a free Apple account cannot receive push, so a message reaches the phone within about 5 minutes.
- The page rings and shows a red banner for Injured, Need, Quit, SOS, and after 30 minutes without an update.
  The "last update" time is the server's clock.

Paco uses Firestore over plain HTTPS (`src/crew/rest.ts`), not the Firebase package: one short request
per trip costs less battery than an open connection. The page uses the Firebase package and listens.

### Firestore rules

The data lives in the same Firestore project as Haba, Trani and Cismo (`habits-433f8`). The rules cover all
of them, so **always paste the whole block** (Firebase console, Firestore Database, Rules tab). Haba, Trani
and Cismo keep the same block in their READMEs; keep them all the same:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /records/{id} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasOnly(['t', 'item'])
        && request.resource.data.t is string
        && request.resource.data.t.size() == 25
        && request.resource.data.item in ['core', 'jog', 'read', 'meditate', 'kid', 'wife', 'spend', 'drink', 'work', 'problem', 'happy', 'normal', 'sad'];
      allow delete: if true;
      allow update: if false;
    }
    match /trani/{day} {
      allow read: if true;
      allow create, update: if day.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        && request.resource.data.keys().hasOnly(['day', 'feel'])
        && request.resource.data.day == day
        && (!('feel' in request.resource.data) || request.resource.data.feel in ['easy', 'ok', 'hard', 'cramp']);
      allow delete: if true;
    }
    match /cismo/{key}/events/{id} {
      allow read, delete: if key.size() >= 20;
      allow create: if key.size() >= 20
        && request.resource.data.keys().hasOnly(['t', 'kind'])
        && request.resource.data.t is string
        && request.resource.data.t.size() == 25
        && request.resource.data.kind in ['won', 'smoked'];
      allow update: if false;
    }
    match /cismo/{key}/reasons/{id} {
      allow read, delete: if key.size() >= 20;
      allow create: if key.size() >= 20
        && request.resource.data.keys().hasOnly(['text', 'n'])
        && request.resource.data.text is string
        && request.resource.data.text.size() <= 300
        && request.resource.data.n is int;
      allow update: if false;
    }
    match /paco/{key} {
      allow read: if key.size() >= 20;
      allow create, update: if key.size() >= 20
        && request.resource.data.keys().hasOnly(['race', 'state', 'start', 'km', 'lat', 'lon', 'acc', 'fix', 'got', 'at'])
        && request.resource.data.race is string
        && request.resource.data.race.size() <= 80
        && request.resource.data.state in ['running', 'ended']
        && request.resource.data.start is int
        && request.resource.data.km is number
        && request.resource.data.got is string
        && request.resource.data.got.size() <= 40
        && request.resource.data.at == request.time;
      allow delete: if false;
    }
    match /paco/{key}/taps/{id} {
      allow read: if key.size() >= 20;
      allow create: if key.size() >= 20
        && request.resource.data.keys().hasOnly(['kind', 'items', 'msg', 't', 'sent'])
        && request.resource.data.kind in ['ok', 'tired', 'resting', 'injured', 'need', 'quit', 'sos', 'seen']
        && request.resource.data.items is list
        && request.resource.data.items.size() <= 12
        && request.resource.data.items.hasOnly(['knee', 'ankle', 'foot', 'cramp', 'stomach', 'other', 'water', 'food', 'gel', 'salt', 'medicine', 'socks', 'warm clothes', 'headlamp', 'power bank'])
        && request.resource.data.msg is string
        && request.resource.data.msg.size() <= 40
        && request.resource.data.t is int
        && request.resource.data.sent == request.time;
      allow update, delete: if false;
    }
    match /paco/{key}/msgs/{id} {
      allow read: if key.size() >= 20;
      allow create: if key.size() >= 20
        && request.resource.data.keys().hasOnly(['text', 'at'])
        && request.resource.data.text is string
        && request.resource.data.text.size() > 0
        && request.resource.data.text.size() <= 200
        && request.resource.data.at == request.time;
      allow update, delete: if false;
    }
  }
}
```

In plain words for `paco/`: whoever has the key (20 characters or more) can read; records must have the right
shape; times named `at` and `sent` must be the server's own time; nothing can be deleted, and only the live
record can be changed.

### Build

```
cd web
npm install
npm run check
npm run build      # makes web/dist
npm run serve      # http://127.0.0.1:8766/#KEY
```

Every push to `main` runs `.github/workflows/crew-page.yml`: Paco's tests, then the page build, then
`web/dist` goes to the `gh-pages` branch. GitHub Pages serves that branch.
