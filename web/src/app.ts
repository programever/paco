// Paco crew page. Follows one runner: Paco writes, this page reads and answers.
// paco/{key} is the live record, taps/ the runner's taps, msgs/ the crew's messages
// (see ../../src/crew/protocol.ts). The key comes from the link: #<key>.

import { initializeApp } from 'firebase/app';
import {
  addDoc, collection, doc, initializeFirestore, onSnapshot, orderBy, persistentLocalCache, query,
  serverTimestamp, Timestamp, where, type Firestore, type Unsubscribe,
} from 'firebase/firestore';
import L from 'leaflet';

import { climbs, Climb } from '../../src/core/climbs';
import { bearing } from '../../src/core/geo';
import { atKm, elevationRangeM, slice } from '../../src/core/route';
import { checkpointLabel, clockText, Race, raceFromPlanFile } from '../../src/core/race';
import { arrivals, delivered, isStale, seenIds, statusTone } from '../../src/crew/follow';
import {
  firebaseConfig, keyLength, Live, readCrewLink, maxMessageLength, quickMessages, Tap, TapKind, tapKinds, tapLabel, urgentKinds, waitingAt,
} from '../../src/crew/protocol';
import { legendColour, readout, ticksOf } from '../../src/ui/legend';
import { clockOf, colors, kmValue, longDuration, signedDuration } from '../../src/ui/theme';

type LiveDoc = Live & { at: number | null };
type Message = { id: string; text: string; at: number | null };

/** History entries per page. */
const historyPageSize = 10;

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
  taps: [] as Tap[],
  messages: [] as Message[],
  /** Taps already known when the page opened do not ring. */
  knownTaps: null as Set<string> | null,
  /** 0 is the newest page. */
  historyPage: 0,
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

/** Taps and messages of this run only: an older race's "Injured" means nothing now. */
function followRun(start: number): void {
  for (const u of unsubRun) u();
  state.taps = [];
  state.messages = [];
  state.knownTaps = null;
  unsubRun = [
    onSnapshot(query(collection(db, 'paco', state.key, 'taps'), where('t', '>=', start), orderBy('t')), (snap) => {
      state.taps = snap.docs.flatMap((d) => {
        const x = d.data();
        if (!(tapKinds as readonly string[]).includes(x.kind)) return [];
        return [{ id: d.id, kind: x.kind as TapKind, items: Array.isArray(x.items) ? x.items.map(String) : [], msg: String(x.msg ?? ''), t: Number(x.t) }];
      });
      ringForNewTaps();
      render();
    }),
    onSnapshot(query(collection(db, 'paco', state.key, 'msgs'), where('at', '>=', Timestamp.fromMillis(start)), orderBy('at')), (snap) => {
      state.messages = snap.docs.map((d) => {
        const at = d.data({ serverTimestamps: 'estimate' }).at;
        return { id: d.id, text: String(d.data().text ?? ''), at: at instanceof Timestamp ? at.toMillis() : null };
      });
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

function send(text: string): void {
  const clean = text.trim().slice(0, maxMessageLength);
  if (clean === '' || state.key.length < keyLength) return;
  addDoc(collection(db, 'paco', state.key, 'msgs'), { text: clean, at: serverTimestamp() }).catch((e: Error) =>
    alert('Could not send: ' + e.message),
  );
  void pushToRunner();
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
    alert('Saved, but the doorbell failed: ' + (e as Error).message + '. The runner gets it within 5 minutes.');
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

/** Every new tap from the runner rings, "Got it" included: the crew may not be looking. */
function ringForNewTaps(): void {
  if (state.knownTaps === null) {
    state.knownTaps = new Set(state.taps.map((t) => t.id));
    return;
  }
  const fresh = state.taps.filter((t) => !state.knownTaps!.has(t.id));
  for (const t of fresh) state.knownTaps.add(t.id);
  if (fresh.length === 0) return;
  ring(fresh.some((t) => urgentKinds.includes(t.kind)));
  if (document.hidden) document.title = '🔴 News from the runner';
}

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
  // Race numbers only. The runner's taps (Injured, Need, ...) are read in the Message tab (Iker).
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

  const list = arrivals(race, live.start, live.km, at);
  const next = list.find((a) => !a.passed);
  $('next').innerHTML = next
    ? `<div class="label">NEXT</div><div class="value">${esc(next.name)} · ${kmValue(next.checkpoint.km - live.km)} km</div>
       <div class="grid">
         ${cell('arrives about', next.eta === null ? '—' : clockOf(next.eta))}
         ${cell('COT', next.checkpoint.cutoff ? clockText(next.checkpoint.cutoff) : 'none')}
         ${cell('margin', next.marginMs === null ? '—' : signedDuration(next.marginMs))}
       </div>
       <a class="mini link" href="${rideTo(race, next.checkpoint.km)}" target="_blank" rel="noopener">Ride there ↗</a>`
    : `<div class="value">Finished</div>`;

  renderMap(race, live);
  renderProfile(race, live.km);
  renderMessages(race, live);

  $('table').innerHTML =
    `<tr><th>Checkpoint</th><th>km</th><th>Arrive</th><th>COT</th><th>Margin</th><th></th></tr>` +
    list
      .map(
        (a) => `<tr class="${a.passed ? 'passed' : ''}">
          <td>${esc(a.name)}</td><td>${kmValue(a.checkpoint.km)}</td>
          <td>${a.passed ? 'passed' : a.eta === null ? '—' : clockOf(a.eta)}</td>
          <td>${a.checkpoint.cutoff ? clockText(a.checkpoint.cutoff) : '—'}</td>
          <td class="${a.marginMs === null ? '' : a.marginMs < 0 ? 'minus' : a.marginMs < 30 * 60_000 ? 'close' : 'plus'}">${a.marginMs === null ? '—' : signedDuration(a.marginMs)}</td>
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

function renderMessages(race: Race, live: LiveDoc): void {
  const select = $<HTMLSelectElement>('cp');
  const names = race.checkpoints.filter((c) => c.role !== 'start').map((c) => c.name || 'Finish');
  if (select.options.length !== names.length) {
    const next = race.checkpoints.find((c) => c.km > live.km && c.role !== 'start');
    select.innerHTML = names.map((n) => `<option ${n === (next?.name || 'Finish') ? 'selected' : ''}>${esc(n)}</option>`).join('');
  }
  const seen = seenIds(state.taps);
  const waiting = state.messages.filter((m) => !seen.has(m.id)).length;
  $('unseen').hidden = waiting === 0;
  $('unseen').textContent = String(waiting);
  // One chat: the runner's taps on the left, the crew's messages on the right, newest on top.
  // "Got it" is not a bubble of its own: it is the tick on the message it answers.
  const bubbles = [
    ...state.taps
      .filter((t) => t.kind !== 'seen')
      .map((t) => ({
        at: t.t,
        html: `<li class="bubble runner ${statusTone[t.kind]}"><div>${esc([tapLabel[t.kind], ...t.items].join(' · '))}</div><span class="when">${clockOf(t.t)}</span></li>`,
      })),
    ...state.messages.map((m) => {
      const tick = seen.has(m.id) ? '<span class="tick seen">✓✓ seen</span>' : m.at !== null && delivered(m.at, live.got) ? '<span class="tick">✓✓ on phone</span>' : m.at === null ? '<span class="tick">sending</span>' : '<span class="tick">✓ sent</span>';
      return { at: m.at ?? Date.now(), html: `<li class="bubble crew"><div>${esc(m.text)}</div><span class="when">${m.at ? clockOf(m.at) : ''}</span> ${tick}</li>` };
    }),
  ].sort((a, b) => b.at - a.at);
  const pages = Math.max(1, Math.ceil(bubbles.length / historyPageSize));
  state.historyPage = Math.min(state.historyPage, pages - 1);
  const shown = bubbles.slice(state.historyPage * historyPageSize, (state.historyPage + 1) * historyPageSize);
  $('history').innerHTML = shown.map((b) => b.html).join('') || '<li class="empty">Nothing yet</li>';
  $('history-pages').hidden = pages === 1;
  $('history-page').textContent = `${state.historyPage + 1} / ${pages}`;
  $<HTMLButtonElement>('newer').disabled = state.historyPage === 0;
  $<HTMLButtonElement>('older').disabled = state.historyPage >= pages - 1;
}

// ---------- wiring ----------

$('quick').innerHTML = quickMessages.map((m) => `<button class="mini" data-text="${esc(m)}">${esc(m)}</button>`).join('');
$('quick').addEventListener('click', (e) => {
  const text = (e.target as HTMLElement).dataset.text;
  if (text) send(text);
});
$('waiting').addEventListener('click', () => send(waitingAt($<HTMLSelectElement>('cp').value)));
$('free').addEventListener('submit', (e) => {
  e.preventDefault();
  send($<HTMLInputElement>('text').value);
  $<HTMLInputElement>('text').value = '';
});
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    document.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('on', t === tab));
    document.querySelectorAll<HTMLElement>('.pane').forEach((p) => (p.hidden = p.dataset.pane !== name));
    // Leaflet measures its box when shown; a map drawn while hidden has the wrong size.
    if (name === 'status') map?.invalidateSize();
  }),
);
$('newer').addEventListener('click', () => {
  state.historyPage = Math.max(0, state.historyPage - 1);
  render();
});
$('older').addEventListener('click', () => {
  state.historyPage += 1;
  render();
});
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

setInterval(render, 15_000);
follow();
