// missions: the Stage 1 mission chain (reach-the-waypoint jobs with cash rewards) and its world marker.
import * as THREE from '../vendor/three.module.min.js';

export const MISSIONS = [
  { id: 'garage', title: 'First Day in Costa', objective: 'Drive to the Harbor Line Garage', x: -160, z: 200, needs: 'car', reward: 500 },
  { id: 'dock', title: 'Dock Run', objective: 'Take a car to the container crane at Harbor Docks', x: 178, z: 350, needs: 'car', reward: 800 },
  { id: 'lighthouse', title: 'Last Light', objective: 'Walk out to the Lantern Pier lighthouse', x: -110, z: 408, needs: 'foot', reward: 1200 },
];

export class MissionTracker {
  constructor(scene) {
    this.index = 0;
    this.completed = 0;
    this.marker = this._buildMarker();
    scene.add(this.marker);
    this._syncMarker();
  }

  get active() {
    return MISSIONS[this.index] ?? null;
  }

  _buildMarker() {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 90, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    beam.position.y = 45;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.22, 6, 20).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    ring.position.y = 0.4;
    g.add(beam, ring);
    this.ring = ring;
    return g;
  }

  _syncMarker() {
    const m = this.active;
    this.marker.visible = !!m;
    if (m) this.marker.position.set(m.x, 0.1, m.z);
  }

  distanceTo(x, z) {
    const m = this.active;
    return m ? Math.hypot(m.x - x, m.z - z) : 0;
  }

  // Returns the mission that was just completed, or null.
  update(dt, player) {
    this.ring.rotation.y += dt * 1.5;
    this.ring.position.y = 0.5 + Math.sin(performance.now() / 300) * 0.15;
    const m = this.active;
    if (!m) return null;
    const ok = m.needs === 'car' ? player.inCar : !player.inCar;
    if (ok && this.distanceTo(player.px, player.pz) < 6) {
      this.index++;
      this.completed++;
      this._syncMarker();
      return m;
    }
    return null;
  }
}
