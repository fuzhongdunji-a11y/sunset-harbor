// input: keyboard state with per-frame edge detection, mouse-look deltas and pointer-lock management.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edge = new Set();
    this.mx = 0;
    this.my = 0;
    this.locked = false;
    this.dragging = false;
    this.onLockChange = null;
    this.onEscape = null;

    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.edge.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', () => (this.dragging = true));
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) {
        this.mx += e.movementX;
        this.my += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  // True once per key press.
  pressed(...codes) {
    return codes.some((c) => this.edge.has(c));
  }

  takeMouse() {
    const m = { dx: this.mx, dy: this.my };
    this.mx = this.my = 0;
    return m;
  }

  endFrame() {
    this.edge.clear();
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* pointer lock unavailable: drag-to-look still works */
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear() {
    this.keys.clear();
    this.edge.clear();
    this.mx = this.my = 0;
  }
}
