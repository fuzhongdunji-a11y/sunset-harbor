// ui: title and pause screens plus the game-state machine ('title' | 'playing' | 'paused').
const $ = (id) => document.getElementById(id);

export class Ui {
  constructor(input, hooks) {
    this.input = input;
    this.hooks = hooks; // {onStart, onResume, onPause}
    this.state = 'title';
    this.title = $('title');
    this.pauseEl = $('pause');
    const start = () => this.start();
    $('start-btn').addEventListener('click', start);
    this.pauseEl.addEventListener('click', () => this.resume());
    window.addEventListener('keydown', (e) => {
      if (this.state === 'title' && (e.code === 'Enter' || e.code === 'Space')) start();
      else if (this.state === 'paused' && (e.code === 'Enter' || e.code === 'KeyP' || e.code === 'Escape')) this.resume();
      else if (this.state === 'playing' && (e.code === 'KeyP' || e.code === 'Escape')) this.pause();
    });
    input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
  }

  start() {
    if (this.state !== 'title') return;
    this.state = 'playing';
    this.title.classList.add('hidden');
    this.input.requestLock();
    this.hooks.onStart();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.releaseLock();
    this.input.clear();
    this.pauseEl.classList.remove('hidden');
    this.hooks.onPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.pauseEl.classList.add('hidden');
    this.input.requestLock();
    this.hooks.onResume();
  }

  // Shot mode: hide or show the title screen without starting the game.
  showTitle(visible) {
    this.title.classList.toggle('hidden', !visible);
  }
}
