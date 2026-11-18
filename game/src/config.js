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
// Golden-hour palette: apricot haze at the horizon, rose-lilac band, clear blue overhead; fog sits between horizon and sun glow so distance dissolves into peach.
export const SKY = { horizon: 0xffc99a, mid: 0x9cc4ee, zenith: 0x2f6fc8, fog: 0xf3c9a6, band: 0xf2a9a0, glow: 0xff9a52 };
