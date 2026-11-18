// main: thin bootstrap. Creates the renderer, wires input/UI/HUD to the World and runs the frame loop (or a single ?shot= frame).
import * as THREE from '../vendor/three.module.min.js';
import { World } from './world.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Minimap } from './minimap.js';
import { Ui } from './ui.js';
import { prepareShot } from './shots.js';
import { loadSave, writeSave, clearSave } from './save.js';
import { GameAudio } from './audio.js';
import { startBench } from './bench.js';
import { R_NEAR, R_FAR } from './signalIntercept.js';

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const seed = Number(params.get('seed')) || 1;

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!shot, powerPreference: 'high-performance' });
renderer.setPixelRatio(shot ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, 1, 0.4, 3600);

const input = new Input(canvas);
const world = new World(scene, camera, seed);
window.__game = { world, renderer };
const hud = new Hud();
const minimap = new Minimap(document.getElementById('minimap'), world.layout);
const audio = new GameAudio();
window.__game.audio = audio;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) {
    audio.toggleMute();
    ui.setMuted(audio.muted);
    world.notify(audio.muted ? 'Sound off' : 'Sound on', 'info');
  }
});
const ui = new Ui(input, {
  onStart(mode) {
    audio.start(); // runs inside the click / key press that left the title screen
    if (mode === 'continue') {
      const save = loadSave();
      if (save) world.applySave(save);
    } else {
      clearSave();
    }
    world.rig.snap(world.player, world.collision);
    hud.show(true);
  },
  onPause() {
    writeSave(world);
    audio.setPaused(true);
  },
  onResume() {
    audio.setPaused(false);
  },
});
ui.setMuted(audio.muted);
if (!shot) ui.setSave(loadSave());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let mapFrame = 0;
function drawMinimap() {
  if (!shot && (mapFrame++ & 1)) return; // the minimap redraws at half the frame rate (it is the costliest 2D job)
  const ic = world.intercept;
  const q = ic.active ? ic.position : null;
  minimap.draw(world.player, world.vehicles, world.missions.target, world.rig.yaw, {
    peds: world.peds.list,
    crests: world.crests.near,
    armored: world.armored.mapView,
    intercept: q && { x: q.x, z: q.z, h: q.h, dist: ic.dist, near: R_NEAR, far: R_FAR, outside: ic.dist > R_FAR && ic.upload < 100 },
  });
}

if (shot) {
  prepareShot(shot, { world, hud, ui });
  drawMinimap();
  renderer.render(scene, camera);
  window.__ready = true;
} else if (params.get('bench')) {
  startBench({ world, hud, ui, renderer, drawMinimap, seconds: Number(params.get('secs')) || 30 });
} else {
  let last = performance.now();
  let clock = 0;
  let saveClock = 0;
  const saveNow = () => {
    if (ui.state !== 'title' && !world.fx) writeSave(world);
  };
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => document.hidden && saveNow());
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (ui.state === 'title') {
      clock += dt;
      world.updateTitle(dt, clock);
    } else if (ui.state === 'playing') {
      const mouse = input.takeMouse();
      world.update(dt, input, mouse);
      hud.update(dt, world);
      audio.update(dt, world);
      drawMinimap();
      saveClock += dt;
      if (world.saveRequested || saveClock > 10) {
        world.saveRequested = false;
        saveClock = 0;
        saveNow();
      }
    }
    input.endFrame();
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
}
