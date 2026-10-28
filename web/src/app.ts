// Paco crew page. Follows one runner: Paco writes, this page reads and answers.
// paco/{key} is the live record, taps/ the runner's taps, msgs/ the crew's messages
// (see ../../src/crew/protocol.ts). The key comes from the link: #<key>.

import { initializeApp } from 'firebase/app';
import {
  addDoc, collection, doc, initializeFirestore, onSnapshot, orderBy, persistentLocalCache, query,
  serverTimestamp, Timestamp, where, type Firestore, type Unsubscribe,
} from 'firebase/firestore';
import L from 'leaflet';

import { atKm, slice } from '../../src/core/route';
import { clockText, Race, raceFromPlanFile } from '../../src/core/race';
import { arrivals, delivered, isStale, latestStatus, seenIds, statusTone } from '../../src/crew/follow';
import {
  firebaseConfig, keyLength, Live, maxMessageLength, quickMessages, Tap, TapKind, tapKinds, tapLabel, urgentKinds, waitingAt,
} from '../../src/crew/protocol';
import { clockOf, kmValue, longDuration, signedDuration } from '../../src/ui/theme';

type LiveDoc = Live & { at: number | null };
type Message = { id: string; text: string; at: number | null };

/** While stale, the page rings again this often. */
const ringAgainMs = 5 * 60_000;

const state = {
  key: location.hash.slice(1),
  live: null as LiveDoc | null,
  race: null as Race | null,
  taps: [] as Tap[],
  messages: [] as Message[],
  /** Taps already known when the page opened do not ring. */
  knownTaps: null as Set<string> | null,
  banner: null as { text: string; key: string } | null,
  dismissed: new Set<string>(),
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

/** The banner: the most serious thing the crew has not dismissed yet. */
function pickBanner(now: number): { text: string; key: string } | null {
  const live = state.live;
  if (live === null) return null;
  const status = latestStatus(state.taps);
  if (status !== undefined && urgentKinds.includes(status.kind)) {
    const text = status.kind === 'sos' ? 'SOS from the runner' : `${tapLabel[status.kind]}${status.items.length ? ': ' + status.items.join(', ') : ''}`;
    const banner = { text, key: status.id };
    if (!state.dismissed.has(banner.key)) return banner;
  }
  if (live.state === 'running' && live.at !== null && isStale(live.at, now)) {
    const banner = { text: `No update for ${longDuration(now - live.at)}`, key: `stale-${live.at}` };
    if (!state.dismissed.has(banner.key)) return banner;
  }
  return null;
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

  const banner = pickBanner(now);
  if (banner?.key.startsWith('stale') && now - state.lastRing >= ringAgainMs) ring();
  state.banner = banner;
  $('banner').hidden = banner === null;
  $('banner-text').textContent = banner?.text ?? '';

  if (live === null || race === null) return;
  $('note').hidden = true;
  $('race').hidden = false;
  $('race-name').textContent = race.name;
  $('race-facts').textContent = `${kmValue(race.route.totalKm)} km · ↑${Math.round(race.route.totalAscentM)} m · started ${clockOf(live.start)}`;

  const at = live.fix ?? live.at ?? now;
  const status = latestStatus(state.taps);
  const tone = live.state === 'ended' ? 'ok' : status ? statusTone[status.kind] : 'ok';
  const left = Math.max(0, race.route.totalKm - live.km);
  const age = live.at === null ? null : now - live.at;
  $('status').className = `card status ${tone}`;
  $('status').innerHTML = `
    <div class="big">${live.state === 'ended' ? 'RACE ENDED' : esc(status ? tapLabel[status.kind].toUpperCase() : 'RUNNING')}</div>
    ${status && status.items.length ? `<div class="items">${esc(status.items.join(' · '))}</div>` : ''}
    ${status ? `<div class="label">tapped ${clockOf(status.t)}</div>` : ''}
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
       </div>`
    : `<div class="value">Finished</div>`;

  renderMap(race, live);
  renderProfile(race, live.km);
  renderMessages(race, live);

  $('table').innerHTML =
    `<tr><th>Checkpoint</th><th>km</th><th>Arrive</th><th>COT</th><th>Margin</th></tr>` +
    list
      .map(
        (a) => `<tr class="${a.passed ? 'passed' : ''}">
          <td>${esc(a.name)}</td><td>${kmValue(a.checkpoint.km)}</td>
          <td>${a.passed ? 'passed' : a.eta === null ? '—' : clockOf(a.eta)}</td>
          <td>${a.checkpoint.cutoff ? clockText(a.checkpoint.cutoff) : '—'}</td>
          <td class="${a.marginMs === null ? '' : a.marginMs < 0 ? 'minus' : a.marginMs < 30 * 60_000 ? 'close' : 'plus'}">${a.marginMs === null ? '—' : signedDuration(a.marginMs)}</td>
        </tr>`,
      )
      .join('');

  const events = [
    ...state.taps.map((t) => ({ at: t.t, text: t.kind === 'seen' ? `Runner: got "${messageText(t.msg)}"` : `Runner: ${[tapLabel[t.kind], ...t.items].join(' · ')}` })),
    ...state.messages.map((m) => ({ at: m.at ?? now, text: `You: ${m.text}` })),
  ].sort((a, b) => b.at - a.at);
  $('timeline').innerHTML = events.length
    ? events.map((e) => `<li><span>${esc(e.text)}</span><span class="when">${clockOf(e.at)}</span></li>`).join('')
    : '<li><span class="label">Nothing yet</span></li>';
}

const cell = (label: string, value: string, bad = false) =>
  `<div><div class="label">${label}</div><div class="value ${bad ? 'stale' : ''}">${esc(value)}</div></div>`;

const messageText = (id: string) => state.messages.find((m) => m.id === id)?.text ?? 'a message';

function renderMap(race: Race, live: LiveDoc): void {
  if (map === null) {
    map = L.map('map', { zoomControl: true });
    // Topo first: trails and height lines are what a crew needs in the mountains.
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      subdomains: 'abc',
      attribution: '&copy; OpenStreetMap, SRTM | &copy; OpenTopoMap (CC-BY-SA)',
    }).addTo(map);
    const streets = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    });
    L.control.layers({ Topo: topo, Streets: streets }, {}, { position: 'topright' }).addTo(map);
    layers = L.layerGroup().addTo(map);
  }
  layers!.clearLayers();
  const ll = (p: { position: { lat: number; lon: number } }) => L.latLng(p.position.lat, p.position.lon);
  const all = L.polyline(race.route.points.map(ll), { color: '#ff7a2f', weight: 4, opacity: 0.9 }).addTo(layers!);
  L.polyline(slice(race.route, 0, live.km).map(ll), { color: '#5a6b7d', weight: 7, opacity: 0.9 }).addTo(layers!);
  // Checkpoints at the same place (a loop's start and finish) share one label.
  const spots: { at: L.LatLng; names: string[] }[] = [];
  for (const c of race.checkpoints) {
    const at = ll(atKm(race.route, c.km));
    const name = `${c.name || c.role} · km ${kmValue(c.km)}`;
    const same = spots.find((s) => s.at.distanceTo(at) < 60);
    if (same) same.names.push(name);
    else spots.push({ at, names: [name] });
  }
  for (const s of spots) {
    L.circleMarker(s.at, { radius: 7, color: '#101823', weight: 2, fillColor: '#6ec1ff', fillOpacity: 1 })
      .bindTooltip(s.names.map(esc).join('<br>'), { permanent: true, direction: 'right', className: 'cp-label' })
      .addTo(layers!);
  }
  const runner =
    live.lat !== undefined && live.lon !== undefined ? L.latLng(live.lat, live.lon) : ll(atKm(race.route, live.km));
  if (live.acc !== undefined && live.acc < 1000) L.circle(runner, { radius: live.acc, color: '#35d0a5', weight: 1, fillOpacity: 0.1 }).addTo(layers!);
  L.circleMarker(runner, { radius: 10, color: '#fff', weight: 3, fillColor: '#35d0a5', fillOpacity: 1 }).addTo(layers!);
  if (!state.fitted) {
    map.fitBounds(all.getBounds(), { padding: [20, 20] });
    state.fitted = true;
  }
  toRunner = () => map!.setView(runner, Math.max(map!.getZoom(), 15));
  toRoute = () => map!.fitBounds(all.getBounds(), { padding: [20, 20] });
}
let toRunner = () => {};
let toRoute = () => {};

function renderProfile(race: Race, km: number): void {
  const points = race.route.points;
  const low = Math.min(...points.map((p) => p.elevationM));
  const high = Math.max(...points.map((p) => p.elevationM), low + 1);
  const x = (k: number) => (k / race.route.totalKm) * 1000;
  const y = (e: number) => 170 - ((e - low) / (high - low)) * 150;
  const step = Math.max(1, Math.floor(points.length / 500));
  const line = points.filter((_, i) => i % step === 0).map((p) => `${x(p.km).toFixed(1)},${y(p.elevationM).toFixed(1)}`);
  const ticks = race.checkpoints.map((c) => `<line x1="${x(c.km)}" x2="${x(c.km)}" y1="0" y2="180" stroke="#6ec1ff" stroke-width="2" opacity=".5"/>`);
  $('profile').innerHTML = `
    <polygon points="0,180 ${line.join(' ')} 1000,180" fill="rgba(255,122,47,.18)"/>
    <polyline points="${line.join(' ')}" fill="none" stroke="#ff7a2f" stroke-width="3" vector-effect="non-scaling-stroke"/>
    ${ticks.join('')}
    <line x1="${x(km)}" x2="${x(km)}" y1="0" y2="180" stroke="#35d0a5" stroke-width="4"/>`;
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
  $('sent').innerHTML = [...state.messages]
    .reverse()
    .map((m) => {
      const tick = seen.has(m.id) ? '<span class="tick seen">✓✓ seen</span>' : m.at !== null && delivered(m.at, live.got) ? '<span class="tick">✓✓ on phone</span>' : m.at === null ? '<span class="tick">sending</span>' : '<span class="tick">✓ sent</span>';
      return `<li><span>${esc(m.text)} <span class="when">${m.at ? clockOf(m.at) : ''}</span></span>${tick}</li>`;
    })
    .join('') || '<li><span class="label">None</span></li>';
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
$('banner-ok').addEventListener('click', () => {
  if (state.banner) state.dismissed.add(state.banner.key);
  render();
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
$('to-runner').addEventListener('click', () => toRunner());
$('to-route').addEventListener('click', () => toRoute());
// Browsers only play sound after a tap on the page, so the page opens behind a big "tap" button.
function soundOn(): void {
  audio = new AudioContext();
  $('sound').textContent = 'Sound on';
  $('sound').classList.add('on');
  $('start').hidden = true;
  ring(false);
}
$('start').addEventListener('click', soundOn);
$('sound').addEventListener('click', () => {
  if (audio === null) soundOn();
  else {
    void audio.close();
    audio = null;
    $('sound').textContent = 'Sound off';
    $('sound').classList.remove('on');
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  document.title = 'Paco Crew';
  void audio?.resume();
});
window.addEventListener('hashchange', () => location.reload());

setInterval(render, 15_000);
follow();
