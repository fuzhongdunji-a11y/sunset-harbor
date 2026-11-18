// customsCatalog: Solaris Customs' pure data and arithmetic (no three.js, no DOM): paint / rim / engine / chassis / N2O catalog and prices, Hot Respray cost,
// tuned top speed, the Nitrous state stepper, the Export Board shuffle and the export payout formula, plus save sanitising for the signature build.
import { makeRng } from './rng.js';

export const CUSTOMS_SEED = 0x534f4c52; // "SOLR"
export const ENTRY_MAX_SPEED = 16.0; // m/s: faster than this the bay refuses (no trap)
export const POLICE_GATE = 38.0; // m: a cruiser or Air-1 this close at 1-4 stars keeps the shutter up
export const HEAT_WIPE_COOLDOWN = 90.0; // s after a Hot Respray that cleared >= 1 star
export const RECALL_COOLDOWN = 60.0;
export const FIT_FEE = 200; // installing the signature tuning on another car
export const SPEED_CAP = 39.0; // m/s: tuning never lifts a car above this (a car that is already faster keeps its stock top speed)

export const SWATCHES = [
  { name: 'Serena Coral', hex: 0xff5e5b },
  { name: 'Tidepool Teal', hex: 0x00d2b8 },
  { name: 'Solar Gold', hex: 0xffb833 },
  { name: 'Midnight Marina', hex: 0x1d2b53 },
  { name: 'Hibiscus Magenta', hex: 0xe83a82 },
  { name: 'Palm Lime', hex: 0x7ce639 },
  { name: 'Pearl Foam', hex: 0xf4f6f8 },
  { name: 'Obsidian Matte', hex: 0x1e2026 },
];
export const PAINT_PRICE = 350;

// the brief's table leaves style 3 as a placeholder: Chrome Spoke is the invented third finish
export const RIMS = [
  { name: 'Stock Alloy', hex: 0xb8c0c8, price: 0 },
  { name: 'Gold Mesh', hex: 0xf5c242, price: 450 },
  { name: 'Chrome Spoke', hex: 0xeef3f8, price: 500 },
  { name: 'Neon Seafoam Lip', hex: 0x00f5d4, price: 600 },
];

export const ENGINE_TIERS = [
  { name: 'Stage 1 Street ECU', price: 900, top: 0.08, accel: 0.10 },
  { name: 'Stage 2 Twin-Scroll', price: 1800, top: 0.15, accel: 0.20 },
  { name: 'Stage 3 Solaris Spec', price: 3000, top: 0.22, accel: 0.30 },
];
export const CHASSIS_TIERS = [
  { name: 'Stage 1 Strut Brace', price: 750, dmg: 0.80, grip: 0.12, ram: 1 },
  { name: 'Stage 2 Kevlar Bulkhead', price: 1600, dmg: 0.60, grip: 0.12, ram: 0.75 },
];
export const N2O_TIERS = [
  { name: 'Street N2O Bottle', short: 'STREET N2O', price: 1200, burn: 1.8, thrust: 9.5, ceil: 8.0, delay: 1.2, recharge: 0.10, drift: 0.12 },
  { name: 'Pro Twin-Bottle', short: 'PRO N2O', price: 2400, burn: 2.8, thrust: 11.4, ceil: 10.5, delay: 1.0, recharge: 1 / 7.5, drift: 0.15 },
];

export const emptySpec = () => ({ paint: -1, rim: 0, engine: 0, chassis: 0, n2o: 0 });
export const hasTuning = (s) => !!s && (s.engine > 0 || s.chassis > 0 || s.n2o > 0 || s.rim > 0 || s.paint >= 0);

// Cash for the 1-4 star service: $400 + $250 per star (first one on a save is free); a 0 star repair is $250.
export const hotRespray = (stars) => 400 + 250 * stars;
export const repairCost = () => 250;

// Stock top speed with the engine tier applied: +8/15/22%, but never beyond SPEED_CAP (or the car's own stock top, if that is already higher).
export function tunedTop(base, engine) {
  const g = engine > 0 ? ENGINE_TIERS[engine - 1].top : 0;
  return Math.min(base * (1 + g), Math.max(base, SPEED_CAP));
}
export const accelBonus = (engine) => (engine > 0 ? ENGINE_TIERS[engine - 1].accel : 0);

// Nitrous: hold boost (Left Shift) with throttle, >= 4 m/s and >= 20% charge to start. Drains 1/burn per second, refills after `delay` seconds of release.
// Returns {thrust, ceil} (m/s^2, m/s) for this step; mutates the spec's n2oCharge / n2oCooldown / isBoosting.
export function stepNitrous(c, dt, want, speed, throttle, drifting) {
  const T = c.n2o > 0 ? N2O_TIERS[c.n2o - 1] : null;
  c.released = false;
  if (!T) {
    c.isBoosting = false;
    return null;
  }
  const can = want && throttle > 0 && speed >= 4;
  if (c.isBoosting && (!can || c.n2oCharge <= 0)) {
    c.isBoosting = false;
    c.released = true;
  } else if (!c.isBoosting && can && c.n2oCharge >= 0.2) c.isBoosting = true;
  if (c.isBoosting) {
    c.n2oCharge = Math.max(0, c.n2oCharge - dt / T.burn);
    c.n2oCooldown = T.delay;
    if (c.n2oCharge <= 0) {
      c.isBoosting = false;
      c.released = true;
    }
    return { thrust: T.thrust, ceil: T.ceil };
  }
  if (c.n2oCooldown > 0) c.n2oCooldown = Math.max(0, c.n2oCooldown - dt);
  else c.n2oCharge = Math.min(1, c.n2oCharge + (T.recharge + (drifting ? T.drift : 0)) * dt);
  return null;
}

// ---- Export Board
// Six car types cycle through the board: the five civilian cars plus the Kestrel Street Tuner (the sports slot).
export const EXPORT_TYPES = ['marlin', 'pico', 'harborVan', 'dune', 'tuner', 'vesper'];
export const BASE_VALUE = { marlin: 1500, pico: 1500, harborVan: 1950, dune: 1950, tuner: 2350, vesper: 2750 };
export const PRISTINE_BONUS = 250;
export const SWATCH_BONUS = 350;
export const SET_BONUS = 600;
export const RESTOCK_TIME = 45.0;
export const EXPORT_NAMES = { marlin: 'COASTAL SEDAN', pico: 'COMPACT COUPE', harborVan: 'HARBOR VAN', dune: 'DUNE PICKUP', tuner: 'BOULEVARD MUSCLE', vesper: 'HARBOR GT' };

const round10 = (n) => Math.round(n / 10) * 10;
// round10(Base * (0.50 + 0.50 * HP / MaxHP)) + $250 if the hull is >= 95% + $350 for the Featured Swatch.
export function exportPayout(type, hp, maxHp, swatchMatch) {
  const frac = Math.max(0, Math.min(1, hp / maxHp));
  const base = round10(BASE_VALUE[type] * (0.5 + 0.5 * frac));
  const pristine = frac >= 0.95 ? PRISTINE_BONUS : 0;
  const swatch = swatchMatch ? SWATCH_BONUS : 0;
  return { base, pristine, swatch, total: base + pristine + swatch };
}

// Deterministic board for a cycle: a shuffled order of the six types and a Featured Swatch for each slot.
export function exportCycle(cycle) {
  const rng = makeRng((CUSTOMS_SEED ^ (cycle * 2654435761)) >>> 0);
  const order = [...EXPORT_TYPES];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { order, swatches: order.map(() => Math.floor(rng() * SWATCHES.length)) };
}

// Saved signature build: only small integers survive; anything else becomes the empty build.
export function sanitizeCustoms(raw) {
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : lo);
  const out = { build: null, exportCount: 0, firstResprayUsed: false };
  if (!raw || typeof raw !== 'object') return out;
  const b = raw.build;
  if (b && typeof b === 'object' && typeof b.type === 'string') {
    out.build = { type: b.type, paint: int(b.paint, -1, SWATCHES.length - 1), rim: int(b.rim, 0, RIMS.length - 1), engine: int(b.engine, 0, 3), chassis: int(b.chassis, 0, 2), n2o: int(b.n2o, 0, 2) };
  }
  out.exportCount = int(raw.exportCount, 0, 1e6);
  out.firstResprayUsed = raw.firstResprayUsed === true;
  return out;
}
