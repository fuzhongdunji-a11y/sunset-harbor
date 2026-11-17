// main: thin bootstrap. Creates the renderer, wires input/UI/HUD to the World and runs the frame loop (or a single ?shot= frame).
import * as THREE from '../vendor/three.module.min.js';
import { World } from './world.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Minimap } from './minimap.js';
import { Ui } from './ui.js';
import { prepareShot } from './shots.js';

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
const ui = new Ui(input, {
  onStart() {
    world.rig.snap(world.player, world.collision);
    hud.show(true);
  },
  onPause() {},
  onResume() {},
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function drawMinimap() {
  const m = world.missions.active;
  minimap.draw(world.player, world.vehicles, m ? { x: m.x, z: m.z } : null, world.rig.yaw);
}

if (shot) {
  prepareShot(shot, { world, hud, ui });
  drawMinimap();
  renderer.render(scene, camera);
  window.__ready = true;
} else {
  let last = performance.now();
  let clock = 0;
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
      drawMinimap();
    }
    input.endFrame();
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
}
