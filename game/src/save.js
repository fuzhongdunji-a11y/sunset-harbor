// save: localStorage persistence (cash, missions, position, current car). Anything unreadable or out of range is ignored, never thrown.
import { CAR_TYPES } from './vehicleModels.js';

const KEY = 'sunsetHarbor.save.v2';
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

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
    if (paint !== null) car = { type: raw.car.type, paint: Math.floor(paint) };
  }
  // collected Sun-Crest ids: only integers 0..49, no duplicates (an older save simply has none)
  const crests = Array.isArray(raw.crests) ? [...new Set(raw.crests.filter((i) => Number.isInteger(i) && i >= 0 && i < 50))] : [];
  const vouch = raw.vouch === 1 ? 1 : 0; // banked Police Vouch from a Roadside Tuner repair (older saves have none)
  return { cash: Math.floor(cash), completed: Math.floor(completed), x, z, h, car, crests, vouch, savedAt: num(raw.savedAt, 0, 1e15) ?? 0 };
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
    const car = p.vehicle && !boat ? { type: p.vehicle.typeKey, paint: p.vehicle.paint } : null;
    const pier = world.layout.marina.piers[0];
    const data = { cash: world.cash, completed: world.missions.completed, x: boat ? pier.ring.x : p.px, z: boat ? pier.z0 + 8 : p.pz, h: boat ? 0 : p.facing, car, crests: world.crests.ids(), vouch: world.wanted.vouch, savedAt: Date.now() };
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
