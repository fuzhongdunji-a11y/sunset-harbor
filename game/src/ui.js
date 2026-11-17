// ui: title and pause screens plus the game-state machine ('title' | 'playing' | 'paused').
const $ = (id) => document.getElementById(id);

export class Ui {
  constructor(input, hooks) {
    this.input = input;
    this.hooks = hooks; // {onStart, onResume, onPause}
    this.state = 'title';
    this.title = $('title');
    this.pauseEl = $('pause');
    this.hasSave = false;
    $('start-btn').addEventListener('click', () => this.start('new'));
    $('continue-btn').addEventListener('click', () => this.start('continue'));
    this.pauseEl.addEventListener('click', () => this.resume());
    window.addEventListener('keydown', (e) => {
      if (this.state === 'title' && (e.code === 'Enter' || e.code === 'Space')) this.start(this.hasSave ? 'continue' : 'new');
      else if (this.state === 'title' && e.code === 'KeyN') this.start('new');
      else if (this.state === 'paused' && (e.code === 'Enter' || e.code === 'KeyP' || e.code === 'Escape')) this.resume();
      else if (this.state === 'playing' && (e.code === 'KeyP' || e.code === 'Escape')) this.pause();
    });
    input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
  }

  // Show the CONTINUE button when a valid save exists.
  setSave(save) {
    this.hasSave = !!save;
    $('continue-btn').classList.toggle('hidden', !save);
    const info = $('save-info');
    info.classList.toggle('hidden', !save);
    if (save) info.textContent = `Saved game: $${save.cash.toLocaleString('en-US')}  \u00b7  ${save.completed} job${save.completed === 1 ? '' : 's'} done   (Enter = continue, N = new game)`;
    $('start-btn').textContent = save ? 'NEW GAME' : 'PRESS ENTER TO START';
  }

  start(mode = 'new') {
    if (this.state !== 'title') return;
    this.state = 'playing';
    this.title.classList.add('hidden');
    this.input.requestLock();
    this.hooks.onStart(mode);
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
