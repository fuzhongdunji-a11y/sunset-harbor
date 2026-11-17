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
  if (raw.car && typeof raw.car === 'object' && typeof raw.car.type === 'string' && Object.hasOwn(CAR_TYPES, raw.car.type) && raw.car.type !== 'patrol') {
    const paint = num(raw.car.paint, 0, 0xffffff);
    if (paint !== null) car = { type: raw.car.type, paint: Math.floor(paint) };
  }
  return { cash: Math.floor(cash), completed: Math.floor(completed), x, z, h, car, savedAt: num(raw.savedAt, 0, 1e15) ?? 0 };
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
    const car = p.vehicle ? { type: p.vehicle.typeKey, paint: p.vehicle.paint } : null;
    const data = { cash: world.cash, completed: world.missions.completed, x: p.px, z: p.pz, h: p.facing, car, savedAt: Date.now() };
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
