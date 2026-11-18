// save: localStorage persistence (cash, missions, position, current car). Anything unreadable or out of range is ignored, never thrown.
import { CAR_TYPES } from './vehicleModels.js';
import { sanitizeCustoms } from './customsCatalog.js';

const KEY = 'sunsetHarbor.save.v2';
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

// Sunset GP progress: every field is range-checked, anything missing or odd falls back to a fresh championship (older saves have no `gp`).
export function sanitizeGp(raw) {
  const out = { tourActive: false, currentRound: 0, points: { player: 0, cruz: 0, takahashi: 0, bellini: 0 }, toursWon: 0, unlockedVentoApex: false, bestTimesMs: [null, null, null] };
  if (!raw || typeof raw !== 'object') return out;
  const round = num(raw.currentRound, 0, 2);
  out.currentRound = round === null ? 0 : Math.floor(round);
  out.tourActive = raw.tourActive === true && out.currentRound > 0;
  for (const k of Object.keys(out.points)) out.points[k] = Math.floor(num(raw.points?.[k], 0, 1000) ?? 0);
  out.toursWon = Math.floor(num(raw.toursWon, 0, 1000) ?? 0);
  out.unlockedVentoApex = raw.unlockedVentoApex === true;
  if (Array.isArray(raw.bestTimesMs)) out.bestTimesMs = [0, 1, 2].map((i) => { const t = num(raw.bestTimesMs[i], 1000, 3.6e6); return t === null ? null : Math.floor(t); });
  return out;
}

// Validate raw data from storage; returns a clean save object or null.
export function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cash = num(raw.cash, 0, 1e9);
  const completed = num(raw.completed, 0, 1e5);
  const x = num(raw.x, -400, 400);
  const z = num(raw.z, -400, 470);
  const h = num(raw.h, -50, 50);
  if (cash === null || completed === null || x === null || z === null || h === null) return null;
  let car = null;
  if (raw.car && typeof raw.car === 'object' && typeof raw.car.type === 'string' && Object.hasOwn(CAR_TYPES, raw.car.type) && raw.car.type !== 'patrol' && raw.car.type !== 'shade') {
    const paint = num(raw.car.paint, 0, 0xffffff);
    if (paint !== null) {
      car = { type: raw.car.type, paint: Math.floor(paint) };
      const cc = sanitizeCustoms({ build: { type: raw.car.type, ...raw.car.custom } }).build; // tuning fitted to the saved car (Solaris Customs)
      if (raw.car.custom && cc) car.custom = { paint: cc.paint, rim: cc.rim, engine: cc.engine, chassis: cc.chassis, n2o: cc.n2o };
    }
  }
  const customs = sanitizeCustoms(raw.customs); // signature build, export progress, first free Hot Respray
  // collected Sun-Crest ids: only integers 0..49, no duplicates (an older save simply has none)
  const crests = Array.isArray(raw.crests) ? [...new Set(raw.crests.filter((i) => Number.isInteger(i) && i >= 0 && i < 50))] : [];
  const vouch = raw.vouch === 1 ? 1 : 0; // banked Police Vouch from a Roadside Tuner repair (older saves have none)
  return { cash: Math.floor(cash), completed: Math.floor(completed), x, z, h, car, crests, vouch, customs, gp: sanitizeGp(raw.gp), savedAt: num(raw.savedAt, 0, 1e15) ?? 0 };
}

export function loadSave() {
  try {
    const text = localStorage.getItem(KEY);
    return text ? sanitize(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export function writeSave(world) {
  try {
    const p = world.player;
    const boat = !!p.vehicle?.isBoat; // a boat is never saved: the player comes back on Pier 1's deck
    const cu = p.vehicle?.custom;
    const car = p.vehicle && !boat ? { type: p.vehicle.typeKey, paint: p.vehicle.paint, custom: cu ? { paint: cu.paint, rim: cu.rim, engine: cu.engine, chassis: cu.chassis, n2o: cu.n2o } : undefined } : null;
    const pier = world.layout.marina.piers[0];
    const data = { cash: world.cash, completed: world.missions.completed, x: boat ? pier.ring.x : p.px, z: boat ? pier.z0 + 8 : p.pz, h: boat ? 0 : p.facing, car, crests: world.crests.ids(), vouch: world.wanted.vouch, customs: world.customs.serialize(), gp: world.gp?.serialize(), savedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
}
