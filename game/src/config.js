// World dimensions and tuning constants shared across modules (all lengths in metres).
export const WORLD = {
  period: 80, // distance between road centre lines
  road: 18, // road width
  sidewalk: 3.5, // sidewalk strip inside each block edge
  blocksX: 8,
  blocksZ: 7,
  shoreZ: 345, // land ends here, the sea starts
  sandZ: 290, // sand starts here
};
WORLD.blockSize = WORLD.period - WORLD.road;
WORLD.halfX = (WORLD.blocksX * WORLD.period) / 2;
WORLD.halfZ = (WORLD.blocksZ * WORLD.period) / 2;

export const HEIGHTS = { ground: 0, road: 0.04, mark: 0.08, sidewalk: 0.16 };

export const START_CASH = 1250;
// Sunlit palette: warm cream haze at the horizon, clear blue overhead; fog matches the horizon so distance dissolves into gold.
export const SKY = { horizon: 0xf7e0bd, mid: 0x8cc8f0, zenith: 0x2f7fd6, fog: 0xf0dcc0 };
