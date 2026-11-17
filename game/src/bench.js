// bench: ?bench=1 autopilot. Drives a car round a fixed loop of the city for N seconds, collecting frame time, CPU split and draw calls into window.__bench.
const KEYS = new Set();
const FAKE_INPUT = { down: (...c) => c.some((k) => KEYS.has(k)), pressed: () => false };
const NO_MOUSE = { dx: 0, dy: 0 };

function pct(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

export function startBench({ world, hud, ui, renderer, drawMinimap, seconds = 30 }) {
  ui.showTitle(false);
  hud.show(true);
  const L = world.layout;
  const car = world.vehicles.spawn('vesper', 0x17a398, L.xs[2], L.zs[1], Math.PI / 2);
  world.placeInCar(car);
  world.wanted.setHeat(6); // a three-star chase makes the worst case: cops, traffic and peds all active
  const route = [[2, 1], [6, 1], [6, 5], [2, 5]].map(([i, j]) => [L.xs[i], L.zs[j]]);
  let wp = 1;
  let stuck = 0, reverse = 0;

  const sim = [], ui2 = [];
  const frames = [], upd = [], ren = [], calls = [], tris = [];
  let last = performance.now();
  const t0 = last;
  const frame = (now) => {
    const wall = (now - t0) / 1000;
    if (wall > seconds) {
      const sorted = [...frames].sort((a, b) => a - b);
      const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
      window.__bench = {
        seconds, frames: frames.length,
        fps: frames.length / seconds,
        frameMsAvg: avg(frames), frameMsP95: pct(sorted, 0.95), frameMsWorst: sorted[sorted.length - 1],
        updateMsAvg: avg(upd), simMsAvg: avg(sim), hudMinimapMsAvg: avg(ui2), renderMsAvg: avg(ren),
        drawCallsAvg: avg(calls), drawCallsMax: Math.max(...calls), trianglesAvg: avg(tris),
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
        stars: world.wanted.stars, missions: world.stats.missions,
      };
      window.__benchDone = true;
      return;
    }
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    frames.push(now - last);
    last = now;

    // autopilot
    const v = world.player.vehicle;
    if (v) {
      v.health = 100;
      const [tx, tz] = route[wp];
      if (Math.hypot(tx - v.x, tz - v.z) < 28) wp = (wp + 1) % route.length;
      let err = Math.atan2(tx - v.x, tz - v.z) - v.h;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      KEYS.clear();
      if (reverse > 0) {
        reverse -= dt;
        KEYS.add('KeyS');
        KEYS.add(err > 0 ? 'KeyD' : 'KeyA');
      } else {
        if (Math.abs(v.speedF) < 17) KEYS.add('KeyW');
        if (err > 0.05) KEYS.add('KeyA');
        else if (err < -0.05) KEYS.add('KeyD');
        stuck = Math.abs(v.speedF) < 1.5 ? stuck + dt : 0;
        if (stuck > 1.5) {
          stuck = 0;
          reverse = 1.2;
        }
      }
    }
    const a = performance.now();
    world.update(dt, FAKE_INPUT, NO_MOUSE);
    world.events.length = 0;
    const a2 = performance.now();
    hud.update(dt, world);
    drawMinimap();
    const b = performance.now();
    renderer.render(world.scene, world.camera);
    const c = performance.now();
    sim.push(a2 - a);
    ui2.push(b - a2);
    upd.push(b - a);
    ren.push(c - b);
    calls.push(renderer.info.render.calls);
    tris.push(renderer.info.render.triangles);
  };
  requestAnimationFrame(frame);
}
