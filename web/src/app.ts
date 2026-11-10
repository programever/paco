// Paco crew page. Follows one runner: Paco writes, this page reads and answers.
// paco/{key} is the live record, chat/ the messages both ways
// (see ../../src/crew/protocol.ts). The key comes from the link: #<key>.

import { initializeApp } from 'firebase/app';
import {
  collection, doc, initializeFirestore, onSnapshot, orderBy, persistentLocalCache, query,
  serverTimestamp, setDoc, Timestamp, where, type Firestore, type Unsubscribe,
} from 'firebase/firestore';
import L from 'leaflet';

import { climbs, Climb } from '../../src/core/climbs';
import { bearing } from '../../src/core/geo';
import { atKm, elevationRangeM, slice } from '../../src/core/route';
import { checkpointLabel, clockText, Race, raceFromPlanFile } from '../../src/core/race';
import { delivered, isStale, stops } from '../../src/crew/follow';
import {
  ChatLine, firebaseConfig, keyLength, Live, maxMessageLength, randomId, readCrewLink,
} from '../../src/crew/protocol';
import { legendColour, readout, ticksOf } from '../../src/ui/legend';
import { clockOf, colors, kmValue, longDuration } from '../../src/ui/theme';

type LiveDoc = Live & { at: number | null };
/** A chat message as the page holds it: `at` is the server's time, null while on its way. */
type Line = Omit<ChatLine, 'at'> & { at: number | null };

/** A crew message typed here and not yet on the server. Firestore keeps the writes in order and retries them. */
type Outgoing = Line & { failed: string };

/** While stale, the page rings again this often. */
const ringAgainMs = 5 * 60_000;

const state = {
  key: readCrewLink(location.hash).key,
  pushover: readCrewLink(location.hash).pushover,
  live: null as LiveDoc | null,
  race: null as Race | null,
  climbs: [] as readonly Climb[],
  /** The finger on the profile, mirrored on the map, as in Paco. */
  cursorKm: null as number | null,
  chat: [] as Line[],
  outgoing: [] as Outgoing[],
  /** Runner messages already known when the page opened do not ring. */
  knownLines: null as Set<string> | null,
  /** Runner messages that came while the Message tab was not open. */
  unseen: 0,
  lastRing: 0,
  fitted: false,
};

// ---------- data ----------

const app = initializeApp(firebaseConfig);
let db: Firestore;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache() });
} catch {
  db = initializeFirestore(app, {});
}

let unsubRun: Unsubscribe[] = [];

function follow(): void {
  if (state.key.length < keyLength) {
    note('This link has no crew key. Ask the runner for the link from Paco (Crew tab, Share).');
    return;
  }
  onSnapshot(
    doc(db, 'paco', state.key),
    (snap) => {
      if (!snap.exists()) {
        note('Nothing from the runner yet. This page updates by itself.');
        return;
      }
      const d = snap.data();
      const previous = state.live;
      state.live = {
        race: String(d.race ?? ''),
        state: d.state === 'ended' ? 'ended' : 'running',
        start: Number(d.start ?? 0),
        km: Number(d.km ?? 0),
        lat: typeof d.lat === 'number' ? d.lat : undefined,
        lon: typeof d.lon === 'number' ? d.lon : undefined,
        acc: typeof d.acc === 'number' ? d.acc : undefined,
        fix: typeof d.fix === 'number' ? d.fix : undefined,
        got: String(d.got ?? ''),
        at: d.at instanceof Timestamp ? d.at.toMillis() : null,
      };
      if (previous?.start !== state.live.start) followRun(state.live.start);
      if (previous?.race !== state.live.race) void loadRace(state.live.race);
      render();
    },
    (e) => note('Cannot read the data: ' + e.message),
  );
}

/** The chat of this run only: an older race's messages mean nothing now. */
function followRun(start: number): void {
  for (const u of unsubRun) u();
  state.chat = [];
  state.knownLines = null;
  state.unseen = 0;
  unsubRun = [
    onSnapshot(query(collection(db, 'paco', state.key, 'chat'), where('at', '>=', Timestamp.fromMillis(start)), orderBy('at')), (snap) => {
      state.chat = snap.docs.flatMap((d): Line[] => {
        const x = d.data({ serverTimestamps: 'estimate' });
        if (x.from !== 'runner' && x.from !== 'crew') return [];
        const at = d.metadata.hasPendingWrites ? null : x.at instanceof Timestamp ? x.at.toMillis() : null;
        return [{ id: d.id, from: x.from, text: String(x.text ?? ''), t: Number(x.t ?? 0), at }];
      });
      // On the server now: no longer "sending".
      state.outgoing = state.outgoing.filter((o) => !state.chat.some((l) => l.id === o.id && l.at !== null));
      ringForNewLines();
      render();
    }),
  ];
}

async function loadRace(id: string): Promise<void> {
  state.race = null;
  state.fitted = false;
  try {
    const response = await fetch(`races/${encodeURIComponent(id)}.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.race = raceFromPlanFile(id, await response.json());
    state.climbs = climbs(state.race.route);
    state.cursorKm = null;
  } catch (e) {
    note(`Cannot load the race "${id}": ${(e as Error).message}`);
  }
  render();
}

/**
 * Firestore sends writes in the order they were made and keeps retrying them,
 * also after the page is closed and opened again. A write the server refuses
 * for good is marked failed, with a Retry that sends it again at the end of the line.
 */
function send(text: string): void {
  const clean = text.trim().slice(0, maxMessageLength);
  if (clean === '' || state.key.length < keyLength) return;
  const line: Outgoing = { id: randomId(20), from: 'crew', text: clean, t: Date.now(), at: null, failed: '' };
  state.outgoing.push(line);
  render();
  setDoc(doc(db, 'paco', state.key, 'chat', line.id), { from: 'crew', text: clean, t: line.t, at: serverTimestamp() })
    .then(() => pushToRunner())
    .catch((e: Error) => {
      line.failed = e.message;
      render();
    });
}

function retry(id: string): void {
  const line = state.outgoing.find((o) => o.id === id);
  if (line === undefined) return;
  state.outgoing = state.outgoing.filter((o) => o.id !== id);
  send(line.text);
}

/**
 * Pushover is only a doorbell: it rings the runner's phone within seconds,
 * locked or not, and says "open Paco". The message itself is read in Paco.
 * Always the same text, so the phone stacks the doorbells into one pile.
 */
async function pushToRunner(): Promise<void> {
  if (state.pushover === null) return;
  const body = new URLSearchParams({
    token: state.pushover.token,
    user: state.pushover.user,
    title: 'Paco',
    message: 'New message from your crew. Open Paco.',
    priority: '1',
    url: 'com.programever.paco://',
    url_title: 'Open Paco',
  });
  try {
    const response = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', body });
    if (!response.ok) throw new Error(`Pushover said ${response.status}`);
  } catch (e) {
    alert('Saved, but the doorbell failed: ' + (e as Error).message + '. The runner gets it within about 2 minutes.');
  }
}

// ---------- alerts ----------

let audio: AudioContext | null = null;

/** Three high beeps for urgent news, two lower ones for the rest. */
function ring(urgent = true): void {
  state.lastRing = Date.now();
  navigator.vibrate?.(urgent ? [300, 150, 300, 150, 300] : [200, 120, 200]);
  if (audio === null) return;
  void audio.resume();
  const now = audio.currentTime;
  for (let i = 0; i < (urgent ? 3 : 2); i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = urgent ? 880 : 660;
    gain.gain.setValueAtTime(0.0001, now + i * 0.45);
    gain.gain.exponentialRampToValueAtTime(0.6, now + i * 0.45 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.45 + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + i * 0.45);
    osc.stop(now + i * 0.45 + 0.4);
  }
}

/** Every new message from the runner rings: the crew may not be looking. */
function ringForNewLines(): void {
  const runner = state.chat.filter((l) => l.from === 'runner');
  if (state.knownLines === null) {
    state.knownLines = new Set(runner.map((l) => l.id));
    return;
  }
  const fresh = runner.filter((l) => !state.knownLines!.has(l.id));
  for (const l of fresh) state.knownLines.add(l.id);
  if (fresh.length === 0) return;
  ring();
  if (!onMessageTab()) state.unseen += fresh.length;
  if (document.hidden) document.title = '🔴 News from the runner';
}

const onMessageTab = () => !document.querySelector<HTMLElement>('[data-pane="message"]')!.hidden;

// ---------- rendering ----------

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing element #' + id);
  return el as T;
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function note(text: string): void {
  $('note').hidden = false;
  $('note').textContent = text;
}

let map: L.Map | null = null;
let layers: L.LayerGroup | null = null;

function render(): void {
  const now = Date.now();
  const { live, race } = state;

  // No banner to dismiss (Iker): the status card shows it, and the page rings while the news is old.
  if (live !== null && live.state === 'running' && live.at !== null && isStale(live.at, now) && now - state.lastRing >= ringAgainMs) ring();

  if (live === null || race === null) return;
  $('note').hidden = true;
  $('race').hidden = false;
  $('race-name').textContent = race.name;
  $('race-facts').textContent = `${kmValue(race.route.totalKm)} km · ↑${Math.round(race.route.totalAscentM)} m · started ${clockOf(live.start)}`;

  const at = live.fix ?? live.at ?? now;
  // Race numbers only. The runner's messages are read in the Message tab (Iker).
  const left = Math.max(0, race.route.totalKm - live.km);
  const age = live.at === null ? null : now - live.at;
  $('status').className = 'card status ok';
  $('status').innerHTML = `
    <div class="big">${live.state === 'ended' ? 'RACE ENDED' : 'RUNNING'}</div>
    <div class="grid">
      ${cell('km', `${kmValue(live.km)} / ${kmValue(race.route.totalKm)}`)}
      ${cell('km left', kmValue(left))}
      ${cell('running for', longDuration(at - live.start))}
      ${cell('last update', age === null ? '—' : age < 60_000 ? 'just now' : `${longDuration(age)} ago`, age !== null && isStale(live.at!, now))}
      ${cell('GPS', live.acc === undefined ? 'no fix yet' : `±${Math.round(live.acc)} m`)}
    </div>`;

  const list = stops(race, live.km);
  const next = list.find((a) => !a.passed);
  $('next').innerHTML = next
    ? `<div class="label">NEXT</div><div class="value">${esc(next.name)} · ${kmValue(next.checkpoint.km - live.km)} km</div>
       <div class="grid">
         ${cell('COT', next.checkpoint.cutoff ? clockText(next.checkpoint.cutoff) : 'none')}
       </div>
       <a class="mini link" href="${rideTo(race, next.checkpoint.km)}" target="_blank" rel="noopener">Ride there ↗</a>`
    : `<div class="value">Finished</div>`;

  renderMap(race, live);
  renderProfile(race, live.km);
  renderMessages(live);

  $('table').innerHTML =
    `<tr><th>Checkpoint</th><th>km</th><th>COT</th><th></th></tr>` +
    list
      .map(
        (a) => `<tr class="${a.passed ? 'passed' : ''}">
          <td>${esc(a.name)}</td><td>${kmValue(a.checkpoint.km)}</td>
          <td>${a.checkpoint.cutoff ? clockText(a.checkpoint.cutoff) : '—'}</td>
          <td><a class="ride" href="${rideTo(race, a.checkpoint.km)}" target="_blank" rel="noopener">Ride ↗</a></td>
        </tr>`,
      )
      .join('');
}

// Google Maps through its public links: no key and no card. On a phone they open the Google Maps app.
const googlePlace = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
function rideTo(race: Race, km: number): string {
  const p = atKm(race.route, km).position;
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lon.toFixed(6)}&travelmode=two-wheeler`;
}

const cell = (label: string, value: string, bad = false) =>
  `<div><div class="label">${label}</div><div class="value ${bad ? 'stale' : ''}">${esc(value)}</div></div>`;

/** How far past the runner the direction arrows reach, and how far apart they are, as in Paco. */
const arrowsAheadKm = 1;
const arrowEveryKm = 0.08;

let cursorLayer: L.LayerGroup | null = null;

function renderMap(race: Race, live: LiveDoc): void {
  if (map === null) {
    map = L.map('map', { zoomControl: true });
    // "Route" is Paco's own map: the course drawn on a plain ground, no tiles,
    // so it also works on one bar of signal. Topo and Streets add the real world.
    const plain = L.layerGroup().addTo(map);
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      subdomains: 'abc',
      attribution: '&copy; OpenStreetMap, SRTM | &copy; OpenTopoMap (CC-BY-SA)',
    });
    const streets = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    });
    L.control.layers({ Route: plain, Topo: topo, Streets: streets }, {}, { position: 'topright' }).addTo(map);
    layers = L.layerGroup().addTo(map);
    cursorLayer = L.layerGroup().addTo(map);
  }
  layers!.clearLayers();
  const ll = (p: { position: { lat: number; lon: number } }) => L.latLng(p.position.lat, p.position.lon);
  const { route } = race;
  // Behind the runner first, then ahead on top, as in Paco: where the course uses
  // the same ground twice, the part still to run wins.
  const all = L.polyline(route.points.map(ll), { opacity: 0, weight: 1 }).addTo(layers!);
  L.polyline(slice(route, 0, live.km).map(ll), { color: colors.passed, weight: 7, opacity: 1 }).addTo(layers!);
  L.polyline(slice(route, live.km, route.totalKm).map(ll), { color: colors.route, weight: 3.5, opacity: 1 }).addTo(layers!);
  for (let k = live.km + arrowEveryKm / 2; k < Math.min(route.totalKm, live.km + arrowsAheadKm); k += arrowEveryKm) {
    const from = atKm(route, k).position;
    const to = atKm(route, Math.min(route.totalKm, k + 0.01)).position;
    const turn = bearing(from, to) - 90;
    L.marker(L.latLng(from.lat, from.lon), {
      interactive: false,
      icon: L.divIcon({
        className: 'arrow',
        iconSize: [14, 14],
        html: `<svg viewBox="-7 -7 14 14" style="transform: rotate(${turn}deg)"><path d="M-3.5 -3.5 L1.5 0 L-3.5 3.5" fill="none" stroke="${colors.paper}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      }),
    }).addTo(layers!);
  }
  // Checkpoints in Paco's legend colours. Two at the same place (a loop's start and finish) share one label.
  const spots: { at: L.LatLng; colour: string; names: string[] }[] = [];
  for (const c of race.checkpoints) {
    const at = ll(atKm(route, c.km));
    const colour = legendColour(race.checkpoints, c);
    const name = `<span style="color:${colour}">${esc(checkpointLabel(c))} · km ${kmValue(c.km)}</span>`;
    const same = spots.find((s) => s.at.distanceTo(at) < 60);
    if (same) same.names.push(name);
    else spots.push({ at, colour, names: [name] });
  }
  for (const s of spots) {
    L.circleMarker(s.at, { radius: 7, color: colors.ink, weight: 2, fillColor: s.colour, fillOpacity: 1 })
      .bindTooltip(s.names.join('<br>'), { permanent: true, direction: 'right', className: 'cp-label' })
      .addTo(layers!);
  }
  const runner = live.lat !== undefined && live.lon !== undefined ? L.latLng(live.lat, live.lon) : ll(atKm(route, live.km));
  if (live.acc !== undefined && live.acc < 1000) L.circle(runner, { radius: live.acc, color: colors.you, weight: 1, fillOpacity: 0.1 }).addTo(layers!);
  L.circleMarker(runner, { radius: 9, color: colors.ink, weight: 3, fillColor: colors.you, fillOpacity: 1 }).addTo(layers!);
  if (!state.fitted) {
    map.fitBounds(all.getBounds(), { padding: [20, 20] });
    state.fitted = true;
  }
  $<HTMLAnchorElement>('runner-google').href = googlePlace(runner.lat, runner.lng);
  toRunner = () => map!.setView(runner, Math.max(map!.getZoom(), 15));
  toRoute = () => map!.fitBounds(all.getBounds(), { padding: [20, 20] });
  drawCursor(race);
}
let toRunner = () => {};
let toRoute = () => {};

/** Only the cursor, so dragging along the profile does not redraw the whole map. */
function drawCursor(race: Race): void {
  cursorLayer?.clearLayers();
  const km = state.cursorKm;
  if (cursorLayer !== null && km !== null) {
    const p = atKm(race.route, km).position;
    L.circleMarker(L.latLng(p.lat, p.lon), { radius: 7, color: colors.ink, weight: 2, fillColor: colors.scrub, fillOpacity: 1 })
      .bindTooltip(`km ${kmValue(km)}`, { permanent: true, direction: 'top', className: 'cursor-label' })
      .addTo(cursorLayer);
  }
  $('readout').hidden = km === null;
  $('readout').textContent = km === null ? '' : readout(race.route, km);
  const marker = $('profile').querySelector<SVGGElement>('#cursor');
  if (marker !== null) marker.innerHTML = km === null ? '' : profileMarker(race, km, colors.scrub, 5);
}

/** Paco's profile, same size: the chart is 320 x 96 and stretches to the card. */
const chartW = 320;
const chartH = 96;
const chartPad = 6;

function profileScales(race: Race) {
  const { low, high } = elevationRangeM(race.route);
  const total = Math.max(0.001, race.route.totalKm);
  return {
    x: (k: number) => (k / total) * chartW,
    y: (m: number) => chartH - chartPad - ((m - low) / (high - low)) * (chartH - chartPad * 2),
  };
}

function profileMarker(race: Race, km: number, colour: string, radius: number): string {
  const { x, y } = profileScales(race);
  const at = x(km);
  return `<line x1="${at}" x2="${at}" y1="0" y2="${chartH}" stroke="${colour}" stroke-width="1.3"/>
    <circle cx="${at}" cy="${y(atKm(race.route, km).elevationM)}" r="${radius}" fill="${colour}" stroke="${colors.ink}" stroke-width="1.5"/>`;
}

function renderProfile(race: Race, km: number): void {
  const { route } = race;
  const { x, y } = profileScales(race);
  const samples = 160;
  const outline = Array.from({ length: samples + 1 }, (_, step) => atKm(route, (route.totalKm * step) / samples))
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.km).toFixed(1)} ${y(p.elevationM).toFixed(1)}`)
    .join(' ');
  const ticks = ticksOf(race.checkpoints);
  $('profile').setAttribute('viewBox', `0 0 ${chartW} ${chartH}`);
  $('profile').innerHTML = `
    ${state.climbs.map((c) => `<rect x="${x(c.startKm)}" y="0" width="${x(c.endKm) - x(c.startKm)}" height="${chartH}" fill="rgba(255,122,47,.12)"/>`).join('')}
    <path d="${outline} L${chartW} ${chartH} L0 ${chartH} Z" fill="rgba(255,122,47,.16)"/>
    <path d="${outline}" fill="none" stroke="${colors.route}" stroke-width="1.6"/>
    ${ticks.map(({ colour, checkpoint }) => `<line x1="${x(checkpoint.km)}" x2="${x(checkpoint.km)}" y1="0" y2="${chartH}" stroke="${colour}" stroke-width="1" stroke-dasharray="3 3" opacity=".6"/>`).join('')}
    ${ticks.map(({ colour, checkpoint }) => `<circle cx="${x(checkpoint.km)}" cy="${chartH - 3}" r="3" fill="${colour}"/>`).join('')}
    ${profileMarker(race, km, colors.paper, 4.5)}
    <g id="cursor"></g>`;
  $('profile-legend').innerHTML = `<span>Start</span><span>Runner at km ${kmValue(km)}</span><span>Finish km ${kmValue(route.totalKm)}</span>`;
  $('profile-captions').innerHTML = ticks
    .map(({ colour, checkpoint }) => `<span><i style="background:${colour}"></i>${esc(checkpointLabel(checkpoint))} · km ${kmValue(checkpoint.km)}</span>`)
    .join('');
  drawCursor(race);
}

/** Dragging a finger along the profile moves a cursor there and on the map, as in Paco. */
function scrub(e: PointerEvent): void {
  const race = state.race;
  if (race === null) return;
  const box = $('profile').getBoundingClientRect();
  state.cursorKm = Math.min(1, Math.max(0, (e.clientX - box.left) / Math.max(1, box.width))) * race.route.totalKm;
  drawCursor(race);
}

/** The box is fixed to the screen, so the page itself scrolls to its end to show the newest message. */
const scrollToNewest = () => window.scrollTo({ top: document.documentElement.scrollHeight });

/** Oldest at the top, newest at the bottom by the box, as in any messenger. */
function renderMessages(live: LiveDoc): void {
  $('unseen').hidden = state.unseen === 0;
  $('unseen').textContent = String(state.unseen);
  const box = $('history');
  const atBottom = box.getBoundingClientRect().bottom <= window.innerHeight + 160;
  const sending = state.outgoing.filter((o) => !state.chat.some((l) => l.id === o.id && l.at !== null));
  const lines: (Line & { failed?: string })[] = [
    ...state.chat.filter((l) => l.at !== null),
    ...state.chat.filter((l) => l.at === null && !sending.some((o) => o.id === l.id)),
    ...sending,
  ];
  box.innerHTML =
    lines
      .map((l) => {
        const when = `<span class="when">${clockOf(l.at ?? l.t)}</span>`;
        if (l.from === 'runner') return `<li class="bubble runner"><div>${esc(l.text)}</div>${when}</li>`;
        const tick = l.failed
          ? `<button class="tick failed" data-retry="${l.id}">not sent · Retry</button>`
          : l.at === null
            ? `<span class="tick">${navigator.onLine ? 'sending…' : 'no signal · will send'}</span>`
            : delivered(l.at, live.got)
              ? '<span class="tick">✓✓ on phone</span>'
              : '<span class="tick">✓ sent</span>';
        return `<li class="bubble crew"><div>${esc(l.text)}</div>${when} ${tick}</li>`;
      })
      .join('') || '<li class="empty">No messages</li>';
  if (atBottom && onMessageTab()) scrollToNewest();
}

// ---------- wiring ----------

$('free').addEventListener('submit', (e) => {
  e.preventDefault();
  send($<HTMLTextAreaElement>('text').value);
  $<HTMLTextAreaElement>('text').value = '';
});
// Enter sends, Shift+Enter makes a new line, as in a messenger.
$('text').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  $<HTMLFormElement>('free').requestSubmit();
});
$('history').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).dataset.retry;
  if (id) retry(id);
});
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    document.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('on', t === tab));
    document.querySelectorAll<HTMLElement>('.pane').forEach((p) => (p.hidden = p.dataset.pane !== name));
    // Leaflet measures its box when shown; a map drawn while hidden has the wrong size.
    if (name === 'status') map?.invalidateSize();
    if (name === 'message') {
      state.unseen = 0;
      render();
      scrollToNewest();
    }
  }),
);
$('to-runner').addEventListener('click', () => toRunner());
$('to-route').addEventListener('click', () => toRoute());
$('profile').addEventListener('pointerdown', (e) => {
  $('profile').setPointerCapture(e.pointerId);
  scrub(e);
});
$('profile').addEventListener('pointermove', (e) => {
  if ($('profile').hasPointerCapture(e.pointerId)) scrub(e);
});

// Sound is always on. A browser keeps a page silent until the first touch on it,
// whatever the page does; the first touch anywhere wakes the sound, and the
// muted mark in the corner shows until then.
audio = new AudioContext();
const showMute = () => ($('mute').hidden = audio?.state === 'running');
audio.addEventListener('statechange', showMute);
showMute();
for (const event of ['pointerdown', 'keydown', 'touchend'] as const) {
  document.addEventListener(event, () => void audio?.resume(), { capture: true, passive: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  document.title = 'Paco Crew';
  void audio?.resume();
});
window.addEventListener('hashchange', () => location.reload());
window.addEventListener('online', render);
window.addEventListener('offline', render);

setInterval(render, 15_000);
follow();
