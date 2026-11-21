// hud: DOM overlay (speed, cash, wanted stars, mission panel, prompts, toasts). Only writes to the DOM when a value changes.
import * as THREE from '../vendor/three.module.min.js';
import { EVADE_TIME } from './wanted.js';
import { CREST_TOTAL, QUOTA, GROUP_NAME, MILESTONES, nextMilestone } from './crests.js';
import { CustomsHud } from './customsHud.js';
import { GpHud } from './gpHud.js';
import { S as MAP_S, X_MAX as MAP_X, Z_MAX as MAP_Z } from './minimap.js';

const $ = (id) => document.getElementById(id);
const HINT_DIM_AFTER = 14; // seconds of play before the control hints fade back

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      cash: $('cash'), stars: [...document.querySelectorAll('#stars span')],
      mTitle: $('m-title'), mObj: $('m-obj'), mDist: $('m-dist'), mReward: $('m-reward'),
      speed: $('speed-val'), speedo: $('speedo'), carName: $('car-name'), district: $('district'),
      prompt: $('prompt'), toast: $('toast'), hints: $('hints'), speedBar: $('speed-bar'),
      banner: $('banner'), bust: $('bust'), bustBar: $('bust-bar'), hpBar: $('hp-bar'), mTime: $('m-time'),
      mission: $('mission'), edge: $('edge'), speedfx: $('speedfx'), drift: $('drift'),
      cashDelta: $('cash-delta'), evade: $('evade'), evadeBar: $('evade-bar'), evadeTxt: $('evade-txt'),
      promptKey: $('prompt-key'), promptText: $('prompt-text'),
      icpt: $('icpt'), icptUp: $('icpt-up'), icptSus: $('icpt-sus'), icptUpPct: $('icpt-up-pct'), icptSusPct: $('icpt-sus-pct'), icptDist: $('icpt-dist'),
      crestN: $('crest-n'), crestToast: $('crest-toast'), ctTitle: $('ct-title'), ctTally: $('ct-tally'), ctFill: $('ct-fill'), ctNext: $('ct-next'),
      pauseCrests: $('pause-crests'), vouch: $('vouch'), promptBar: $('prompt-bar'), ambientCap: $('ambient-cap'),
      ams: $('ams'), amsPhase: $('ams-phase'), amsArmor: $('ams-armor'), amsFill: $('ams-fill'), amsPct: $('ams-pct'),
      amsClock: $('ams-clock'), amsTime: $('ams-time'), amsPlus: $('ams-plus'), amsWarn: $('ams-warn'), amsPop: $('ams-pop'),
      amsResult: $('ams-result'), arLines: $('ar-lines'), arTotal: $('ar-total'), arHead: $('ar-head'),
      speedUnit: $('speed-unit'), hullRow: $('hull-row'), hullPct: $('hull-pct'), hpTrack: $('hp-track'), trim: $('trim'),
      cbd: $('cbd'), cbdPips: [...document.querySelectorAll('#cbd-pips i')], cbdCount: $('cbd-count'), cbdTime: $('cbd-time'),
      cbdBonus: $('cbd-bonus'), cbdWarn: $('cbd-warn'), cbdLabel: $('cbd-label'),
      tow: $('tow'), towLabel: $('tow-label'), towPay: $('tow-pay'), towDist: $('tow-dist'),
      taxi: $('taxi'), taxiLabel: $('taxi-label'), taxiFare: $('taxi-fare'), taxiDist: $('taxi-dist'),
      photo: $('photo-tour'), photoLabel: $('photo-label'), photoPay: $('photo-pay'), photoDist: $('photo-dist'), photoFlash: $('photo-flash'),
      courier: $('courier'), courierLabel: $('courier-label'), courierPay: $('courier-pay'), courierChain: $('courier-chain'), courierTimer: $('courier-timer'), courierDist: $('courier-dist'),
      valet: $('valet'), valetLabel: $('valet-label'), valetPay: $('valet-pay'), valetParks: $('valet-parks'), valetTimer: $('valet-timer'), valetDist: $('valet-dist'),
      loop: $('loop-tour'), loopLabel: $('loop-label'), loopPay: $('loop-pay'), loopStops: $('loop-stops'), loopTimer: $('loop-timer'), loopDist: $('loop-dist'),
      cashPickup: $('cash-pickup'), cashLabel: $('cash-label'), cashPay: $('cash-pay'), cashBags: $('cash-bags'), cashDist: $('cash-dist'),
      medic: $('paramedic'), medicLabel: $('medic-label'), medicPay: $('medic-pay'), medicTimer: $('medic-timer'), medicDist: $('medic-dist'),
      fuel: $('fuel-run'), fuelLabel: $('fuel-label'), fuelPay: $('fuel-pay'), fuelTimer: $('fuel-timer'), fuelDist: $('fuel-dist'),
      buggy: $('buggy-roundup'), buggyLabel: $('buggy-label'), buggyPay: $('buggy-pay'), buggyCount: $('buggy-count'),buggyTimer: $('buggy-timer'), buggyDist: $('buggy-dist'),
      stunt: $('stunt-double'), stuntLabel: $('stunt-label'), stuntPay: $('stunt-pay'), stuntCount: $('stunt-count'), stuntTimer: $('stunt-timer'), stuntDist: $('stunt-dist'),
      rally: $('checkpoint-rally'), rallyLabel: $('rally-label'), rallyPay: $('rally-pay'), rallyCount: $('rally-count'), rallyTimer: $('rally-timer'), rallyDist: $('rally-dist'),
      repo: $('repo-man'), repoLabel: $('repo-label'), repoPay: $('repo-pay'), repoCount: $('repo-count'), repoDist: $('repo-dist'),
      escort: $('sunset-escort'), escortLabel: $('escort-label'), escortPay: $('escort-pay'), escortCount: $('escort-count'), escortTrust: $('escort-trust'), escortDist: $('escort-dist'),
      dking: $('drift-king'), dkingLabel: $('drift-label'), dkingPay: $('drift-pay'), dkingCount: $('drift-count'), dkingScore: $('drift-score'), dkingTimer: $('drift-timer'), dkingDist: $('drift-dist'),
    };
    this._buildAir();
    this.customsHud = new CustomsHud(this.root); // Solaris Customs panel, nitrous gauge, export pill
    this.gpHud = new GpHud(this.root); // Sunset GP rank badge, gap pills, telemetry, countdown and standings modal
    this.tmp = new THREE.Vector3();
    this.crestTimer = 0;
    this.resultTimer = 0;
    this.lastHits = 0;
    this.lastBonus = 0;
    this.cache = {};
    this.toastTimer = 0;
    this.toastQueue = [];
    this.playTime = 0;
    this.deltaTimer = 0;
    this.driftHold = 0;
  }

  // Restart a one-shot CSS animation class.
  _retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  _cash(world) {
    const e = this.el;
    const cash = world.cash;
    if (this.cache.cashRaw !== undefined && cash !== this.cache.cashRaw) {
      const d = cash - this.cache.cashRaw;
      if (Math.abs(d) >= 10) {
        this.cashDelta = (this.deltaTimer > 0 ? this.cashDelta : 0) + d;
        this.deltaTimer = 2;
        e.cashDelta.textContent = `${this.cashDelta >= 0 ? '+' : '-'}$${Math.abs(this.cashDelta).toLocaleString('en-US')}`;
        e.cashDelta.className = `show ${this.cashDelta >= 0 ? 'gain' : 'loss'}`;
        this._retrigger(e.cash, 'bump');
      }
    }
    this.cache.cashRaw = cash;
    this._set('cash', e.cash, `$${cash.toLocaleString('en-US')}`);
  }

  // Wanted block: star pop on a new level, evade meter while searching, red/blue screen edge that grows with the heat and the nearest cruiser.
  _wanted(world) {
    const e = this.el;
    const w = world.wanted;
    const stars = w.stars;
    if (this.cache.stars !== stars) {
      if (stars > (this.cache.stars ?? 0)) for (let i = this.cache.stars ?? 0; i < stars; i++) this._retrigger(e.stars[i], 'pop');
      this.cache.stars = stars;
      e.stars.forEach((s, i) => s.classList.toggle('on', i < stars));
      e.stars[0].parentElement.classList.toggle('hot', stars > 0);
      e.evade.classList.toggle('hidden', stars === 0);
    }
    const searching = w.searching;
    if (this.cache.search !== searching) {
      this.cache.search = searching;
      e.stars[0].parentElement.classList.toggle('search', searching);
      e.evade.classList.toggle('chased', !searching);
      this._set('evTxt', e.evadeTxt, searching ? 'EVADING...' : 'POLICE ON YOU');
    }
    if (stars > 0 && searching) e.evadeBar.style.width = `${Math.round(Math.min(1, w.evade / (EVADE_TIME * w.evadeScale)) * 100)}%`;

    let edge = 0;
    if (stars > 0 && !world.fx) {
      const near = Math.max(0, Math.min(1, (90 - world.police.nearest) / 70)); // cruiser close behind = stronger
      edge = searching ? 0.12 : 0.15 + stars * 0.07 + near * 0.35;
    }
    const q = Math.round(edge * 20) / 20;
    if (this.cache.edge !== q) {
      this.cache.edge = q;
      e.edge.style.opacity = String(q);
    }
  }

  // Signal Intercept: DATA UPLOAD over SUSPICION, plus the live distance to the target with its zone tag.
  _intercept(world) {
    const e = this.el;
    const v = world.intercept.view;
    e.icpt.classList.toggle('hidden', !v.active);
    if (!v.active) return;
    const up = Math.round(v.upload), sus = Math.round(v.susp);
    e.icptUp.style.width = `${v.upload.toFixed(1)}%`;
    e.icptSus.style.width = `${v.susp.toFixed(1)}%`;
    this._set('iup', e.icptUpPct, `${up}%`);
    this._set('isus', e.icptSusPct, `${sus}%`);
    let tag = v.zone;
    if (v.zone === 'SIGNAL LOSS' && !v.breaking) tag = `SIGNAL LOSS ${Math.ceil(v.lostLeft)}s`;
    if (v.breaking) tag = v.dist > 80 ? 'CLEAN BREAK' : 'BREAK AWAY';
    this._set('idist', e.icptDist, `${Math.round(v.dist)} m [${tag}]`);
    const cls = v.breaking ? '' : v.zone === 'TOO CLOSE' ? 'near' : v.zone === 'SIGNAL LOSS' ? 'far' : '';
    if (this.cache.icls !== cls) {
      this.cache.icls = cls;
      e.icptDist.className = cls;
    }
  }

  // Armored Shakedown: phase line, armor gauge (flashes and shakes on a hit), MM:SS clock, warnings, floating bonus texts and the payout card.
  _armored(world, dt) {
    const e = this.el;
    const v = world.armored.view;
    e.ams.classList.toggle('hidden', !v.active);
    for (const text of world.armoredPops.splice(0)) {
      e.amsPop.textContent = text;
      this._retrigger(e.amsPop, 'show');
    }
    const res = world.armoredResult;
    if (res) {
      world.armoredResult = null;
      this.resultTimer = 7.5;
      e.arLines.innerHTML = '';
      res.lines.forEach(([label, amount], i) => {
        const row = document.createElement('div');
        row.className = `ar-line${amount ? '' : ' zero'}`;
        row.style.animationDelay = `${0.25 + i * 0.4}s`;
        row.innerHTML = '<span></span><b></b>';
        row.firstChild.textContent = label;
        row.lastChild.textContent = `+$${amount.toLocaleString('en-US')}`;
        e.arLines.appendChild(row);
      });
      e.arHead.textContent = res.title ?? 'SHAKEDOWN COMPLETE';
      e.arTotal.innerHTML = '<span>TOTAL</span><span></span>';
      e.arTotal.lastChild.textContent = `$${res.total.toLocaleString('en-US')}`;
      e.arTotal.style.animation = 'none';
      void e.arTotal.offsetWidth;
      e.arTotal.style.animation = '';
      e.amsResult.classList.remove('hidden');
    }
    if (this.resultTimer > 0) {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) e.amsResult.classList.add('hidden');
    }
    if (!v.active) {
      this.lastHits = 0;
      this.lastBonus = 0;
      return;
    }
    this._set('amph', e.amsPhase, v.text);
    const pct = Math.max(0, Math.round((v.armor / v.armorMax) * 100));
    e.amsArmor.classList.toggle('hidden', v.phase === 'deliver');
    e.amsFill.style.width = `${(v.armor / v.armorMax) * 100}%`;
    this._set('ampct', e.amsPct, `${pct}%`);
    if (v.hits !== this.lastHits) {
      this.lastHits = v.hits;
      this._retrigger(e.amsArmor, 'hit');
    }
    const left = Math.max(0, v.timeLeft);
    this._set('amtime', e.amsTime, `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
    e.amsClock.classList.toggle('late', left <= 25);
    if (v.bonusT > 0 && this.lastBonus <= 0) this._retrigger(e.amsPlus, 'show');
    this.lastBonus = v.bonusT;
    this._set('amwarn', e.amsWarn, v.warn);
    e.amsWarn.style.color = v.locked ? '#ff4a3c' : v.phase === 'deliver' ? '#ffd23f' : '#ff8a70';
  }

  // Costa Cab: one line with the job label, the fare so far (+tip when it is on course) and the metres to the next ring.
  _taxi(world) {
    const e = this.el;
    const s = world.taxi ? world.taxi.hudState() : null;
    const show = !!s && s.visible;
    e.taxi.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('txl', e.taxiLabel, s.label);
    this._set('txf', e.taxiFare, s.fare > 0 ? `$${s.fare.toLocaleString('en-US')}${s.tip ? ` +$${s.tip}` : ''}` : '');
    this._set('txd', e.taxiDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Costa Tow Service: label, pay so far and the metres to the stranded car / drop-off ring.
  _tow(world) {
    const e = this.el;
    const s = world.tow ? world.tow.hudState() : null;
    const show = !!s && s.visible;
    e.tow.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('twl', e.towLabel, s.label);
    this._set('twp', e.towPay, `$${s.pay.toLocaleString('en-US')}`);
    this._set('twd', e.towDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Sunset Photo Tour: job label, pay so far (base + photos taken) and the metres to the next ring.
  _photoTour(world) {
    const e = this.el;
    const s = world.photoTour ? world.photoTour.hudState() : null;
    const show = !!s && s.visible;
    e.photo.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('ptl', e.photoLabel, s.label);
    this._set('ptp', e.photoPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    this._set('ptd', e.photoDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Costa Food Delivery: label, drop pay so far, drops done / total with the hot-chain count, the freshness timer (during delivery) and the metres to the next ring.
  _courier(world) {
    const e = this.el;
    const s = world.foodCourier ? world.foodCourier.hudState() : null;
    const show = !!s && s.visible;
    e.courier.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('cql', e.courierLabel, s.label);
    this._set('cqp', e.courierPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    this._set('cqc', e.courierChain, `${s.dropsDone}/${s.dropsTotal}${s.chain > 0 ? `  CHAIN x${s.chain}` : ''}`);
    const secs = Math.ceil(s.timeLeft);
    this._set('cqt', e.courierTimer, s.timeTotal > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${s.timeLeft > s.timeTotal / 2 ? ' HOT' : s.timeLeft > 0 ? '' : ' COLD'}` : '');
    e.courierTimer.classList.toggle('cold', s.timeTotal > 0 && s.timeLeft <= 0);
    this._set('cqd', e.courierDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Marina Hotel Valet: label, park pay so far, parks done / total, the leg timer (during TO_BAY, m:ss) and the metres to the next ring.
  _valet(world) {
    const e = this.el;
    const s = world.valetRush ? world.valetRush.hudState() : null;
    const show = !!s && s.visible;
    e.valet.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('vrl', e.valetLabel, s.label);
    this._set('vrp', e.valetPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    this._set('vrk', e.valetParks, `${s.parksDone}/${s.parksTotal}`);
    const secs = Math.ceil(s.timeLeft);
    this._set('vrt', e.valetTimer, s.timeTotal > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '');
    e.valetTimer.classList.toggle('cold', s.timeTotal > 0 && s.timeLeft < 15);
    this._set('vrd', e.valetDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Harbor Loop Tour: label, pay so far, stops done / 5, the leg par countdown (m:ss, TOURING only) and the metres to the stand / next ring.
  _loopTour(world) {
    const e = this.el;
    const s = world.loopTour ? world.loopTour.hudState() : null;
    const show = !!s && s.visible;
    e.loop.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('lpl', e.loopLabel, s.label);
    this._set('lpp', e.loopPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    this._set('lps', e.loopStops, `${s.stopsDone}/${s.stopsTotal}`);
    const secs = Math.ceil(s.timeLeft);
    this._set('lpt', e.loopTimer, s.timeTotal > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '');
    e.loopTimer.classList.toggle('cold', s.timeTotal > 0 && s.timeLeft < 10);
    this._set('lpd', e.loopDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Paramedic Rush: label, payout (only when > 0), patient countdown m:ss (cold under 10 s) and the metres to the scene / hospital.
  _paramedic(world) {
    const e = this.el;
    const s = world.paramedic ? world.paramedic.hudState() : null;
    const show = !!s && s.visible;
    e.medic.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('mdl', e.medicLabel, s.label);
    this._set('mdp', e.medicPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    const secs = Math.ceil(s.timeLeft);
    this._set('mdt', e.medicTimer, s.timeTotal > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '');
    e.medicTimer.classList.toggle('cold', s.timeTotal > 0 && s.timeLeft < 10);
    this._set('mdd', e.medicDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Buggy Roundup: label, returned pay so far (only when > 0), buggies returned n/4, return countdown m:ss (cold under 10 s) and the metres to the buggy / shop.
  _buggy(world) {
    const e = this.el;
    const s = world.buggyRoundup ? world.buggyRoundup.hudState() : null;
    const show = !!s && s.visible;
    e.buggy.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('bgl', e.buggyLabel, s.label);
    this._set('bgp', e.buggyPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    const secs = Math.ceil(s.timeLeft);
    this._set('bgc', e.buggyCount, `${s.buggiesDone}/${s.buggiesTotal}`);
    this._set('bgt', e.buggyTimer, s.timeTotal > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '');
    e.buggyTimer.classList.toggle('cold', s.timeTotal > 0 && s.timeLeft < 10);
    this._set('bgd', e.buggyDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Stunt Double: label, pay earned so far (only when > 0), stunts done n/3, round countdown m:ss (cold under 10 s) and the metres to the ramp / landing zone.
  _stunt(world) {
    const e = this.el;
    const s = world.stuntDouble ? world.stuntDouble.hudState() : null;
    const show = !!s && s.visible;
    e.stunt.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('sdl', e.stuntLabel, s.label);
    this._set('sdp', e.stuntPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    const secs = Math.ceil(s.timeLeft);
    this._set('sdc', e.stuntCount, `${s.stuntsDone}/${s.stuntsTotal}`);
    this._set('sdt', e.stuntTimer, s.timeTotal > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '');
    e.stuntTimer.classList.toggle('cold', s.timeTotal > 0 && s.timeLeft < 10);
    this._set('sdd', e.stuntDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Checkpoint Rally: label, pay earned so far (only when > 0), gates n/6, round countdown m:ss (cold under 10 s) and the metres to the current gate.
  _repo(world) {
    const e = this.el;
    const s = world.repoMan ? world.repoMan.hudState() : null;
    const show = !!s && s.visible;
    e.repo.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('rpl', e.repoLabel, s.label);
    this._set('rpp', e.repoPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    this._set('rpc', e.repoCount, `cars ${s.carsDone}/${s.carsTotal}`);
    this._set('rpd', e.repoDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Sunset Escort: label, pay earned so far (only when > 0), stops n/4, VIP trust % (red under 30) and the metres to the VIP / current waypoint.
  _escort(world) {
    const e = this.el;
    const s = world.sunsetEscort ? world.sunsetEscort.hudState() : null;
    const show = !!s && s.visible;
    e.escort.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('esl', e.escortLabel, s.label);
    this._set('esp', e.escortPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    this._set('esc', e.escortCount, `stops ${s.stopsDone}/${s.stopsTotal}`);
    this._set('est', e.escortTrust, `trust ${s.trust}`);
    e.escortTrust.classList.toggle('low', s.trust < 30);
    this._set('esd', e.escortDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Drift King: label, earnings so far, corners n/6, drift score, countdown m:ss (cold under 10 s) and metres to the next corner.
  _drift(world) {
    const e = this.el;
    const s = world.driftKing ? world.driftKing.hudState() : null;
    const show = !!s && s.visible;
    e.dking.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('dkl', e.dkingLabel, s.label);
    this._set('dkp', e.dkingPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    const secs = Math.ceil(s.timeLeft);
    this._set('dkc', e.dkingCount, `corners ${s.cornersDone}/${s.cornersTotal}`);
    this._set('dks', e.dkingScore, `score ${s.score}`);
    this._set('dkt', e.dkingTimer, s.timeTotal > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '');
    e.dkingTimer.classList.toggle('cold', s.timeTotal > 0 && s.timeLeft < 10);
    this._set('dkd', e.dkingDist, `${Math.round(s.distanceLeft)} m`);
  }

  _rally(world) {
    const e = this.el;
    const s = world.checkpointRally ? world.checkpointRally.hudState() : null;
    const show = !!s && s.visible;
    e.rally.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('rgl', e.rallyLabel, s.label);
    this._set('rgp', e.rallyPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    const secs = Math.ceil(s.timeLeft);
    this._set('rgc', e.rallyCount, `${s.gatesDone}/${s.gatesTotal}`);
    this._set('rgt', e.rallyTimer, s.timeTotal > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '');
    e.rallyTimer.classList.toggle('cold', s.timeTotal > 0 && s.timeLeft < 10);
    this._set('rgd', e.rallyDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Harbor Fuel Run: label, per-boat earnings so far (only when > 0), leg countdown m:ss (cold under 10 s) and the metres to the depot / berth.
  _fuelRun(world) {
    const e = this.el;
    const s = world.fuelRun ? world.fuelRun.hudState() : null;
    const show = !!s && s.visible;
    e.fuel.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('frl', e.fuelLabel, s.label);
    this._set('frp', e.fuelPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    const secs = Math.ceil(s.timeLeft);
    this._set('frt', e.fuelTimer, s.timeTotal > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '');
    e.fuelTimer.classList.toggle('cold', s.timeTotal > 0 && s.timeLeft < 10);
    this._set('frd', e.fuelDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Armored Cash Pickup: label, bag earnings so far, bags done / 4 and the metres to the next shop ring / the vault.
  _cashPickup(world) {
    const e = this.el;
    const s = world.cashPickup ? world.cashPickup.hudState() : null;
    const show = !!s && s.visible;
    e.cashPickup.classList.toggle('hidden', !show);
    if (!show) return;
    this._set('cpl', e.cashLabel, s.label);
    this._set('cpp', e.cashPay, s.pay > 0 ? `$${s.pay.toLocaleString('en-US')}` : '');
    this._set('cpb', e.cashBags, `${s.bagsDone}/${s.bagsTotal}`);
    this._set('cpd', e.cashDist, `${Math.round(s.distanceLeft)} m`);
  }

  // Camera flash: a brief white overlay. hold=true freezes it half-bright (used by ?shot=photo so the frame is deterministic).
  flash(hold = false) {
    const f = this.el.photoFlash;
    f.style.transition = 'none';
    f.classList.add('on');
    if (hold) { f.style.opacity = '0.4'; return; }
    void f.offsetWidth; // restart the transition
    f.style.transition = '';
    f.classList.remove('on');
    f.style.opacity = '';
  }

  // Harbor Contraband Run: crate pips, MM:SS clock (red under 20 s), the clean-hull bonus preview, an abandon-boat countdown, and the floating Pier 1 label.
  _contraband(world) {
    const e = this.el;
    const v = world.contraband.view;
    e.cbd.classList.toggle('hidden', !v.active);
    e.mission.classList.toggle('hidden', v.active); // the job has its own tracker
    const lp = world.contraband.labelPos;
    let show = false;
    if (lp && this.root && !this.root.classList.contains('hidden')) {
      const cam = world.camera;
      this.tmp.set(lp.x, lp.y, lp.z);
      const d = this.tmp.distanceTo(cam.position);
      this.tmp.project(cam);
      if (d < 90 && this.tmp.z < 1) {
        show = true;
        e.cbdLabel.style.left = `${((this.tmp.x * 0.5 + 0.5) * 100).toFixed(1)}%`;
        e.cbdLabel.style.top = `${((-this.tmp.y * 0.5 + 0.5) * 100).toFixed(1)}%`;
      }
    }
    e.cbdLabel.classList.toggle('hidden', !show);
    if (!v.active) return;
    e.cbdPips.forEach((pip, i) => pip.classList.toggle('on', i < v.collected));
    this._set('cbcount', e.cbdCount, `${v.collected}/${v.total}`);
    const left = Math.max(0, v.timeLeft);
    this._set('cbtime', e.cbdTime, `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
    e.cbdTime.classList.toggle('late', left < 20);
    e.cbdBonus.classList.toggle('lost', !v.clean);
    let warn = '';
    if (v.abandon !== null) warn = `RETURN TO YOUR BOAT  ${Math.ceil(v.abandon)}s`;
    else if (v.brief) warn = 'FIND THE BUOYS';
    this._set('cbwarn', e.cbdWarn, warn);
  }

  // Sun-Crests: running counter, the 4 s pickup card (count, district tally, bar to the next milestone) and the pause-screen total.
  _crests(world, dt) {
    const e = this.el;
    const c = world.crests;
    const n = c.count;
    if (this.cache.crestCount !== n) {
      this.cache.crestCount = n;
      const ty = c.tally();
      e.crestN.textContent = `${n} / ${CREST_TOTAL}`;
      e.pauseCrests.textContent = `Sun-Crests ${n} / ${CREST_TOTAL}  ·  City ${ty.city}/${QUOTA.city}  Beach ${ty.beach}/${QUOTA.beach}  Harbor ${ty.harbor}/${QUOTA.harbor}`;
    }
    const t = world.crestToast;
    if (t) {
      world.crestToast = null;
      this.crestTimer = t.t;
      const nm = nextMilestone(t.n);
      const prev = [...MILESTONES].reverse().find((m) => m.at <= t.n)?.at ?? 0;
      e.ctTitle.textContent = `SUN-CRESTS ${t.n} / ${CREST_TOTAL}`;
      e.ctTally.textContent = `${GROUP_NAME.city} ${t.tally.city}/${QUOTA.city}  ·  ${GROUP_NAME.beach} ${t.tally.beach}/${QUOTA.beach}  ·  ${GROUP_NAME.harbor} ${t.tally.harbor}/${QUOTA.harbor}`;
      e.ctFill.style.width = `${nm ? Math.round(((t.n - prev) / (nm.at - prev)) * 100) : 100}%`;
      if (t.milestone) {
        e.ctNext.className = 'hit';
        e.ctNext.textContent = `MILESTONE ${t.milestone.at}!  +$${t.milestone.cash.toLocaleString('en-US')}  ${t.milestone.perk}`;
      } else {
        e.ctNext.className = '';
        e.ctNext.textContent = nm ? `+$250   ·   next ${nm.at}: +$${nm.cash.toLocaleString('en-US')}` : '+$250';
      }
      this._retrigger(e.crestToast, 'show');
      e.crestToast.classList.remove('hidden');
    }
    if (this.crestTimer > 0) {
      this.crestTimer -= dt;
      if (this.crestTimer <= 0) e.crestToast.classList.add('hidden');
    }
  }

  // Ambient city events: the 3 s "[AMBIENT]" caption, the banked Police Vouch badge under the stars, and the hold-to-repair bar on the prompt.
  _ambient(world, dt) {
    const e = this.el;
    const cap = world.ambientCaption;
    if (cap) {
      world.ambientCaption = null;
      e.ambientCap.textContent = cap.text;
      e.ambientCap.style.color = cap.color ?? ''; // the Stunt Hauler's caption is magenta, the tuner's keeps the stylesheet cyan
      e.ambientCap.style.borderLeftColor = cap.color ?? '';
      e.ambientCap.classList.remove('hidden');
      void e.ambientCap.offsetWidth;
      e.ambientCap.classList.add('show');
      this.capTimer = cap.t;
    }
    if (this.capTimer > 0) {
      this.capTimer -= dt;
      if (this.capTimer <= 0) e.ambientCap.classList.remove('show');
    }
    const vouch = world.wanted.vouch > 0;
    if (this.cache.vouch !== vouch) {
      this.cache.vouch = vouch;
      e.vouch.classList.toggle('hidden', !vouch);
    }
    const bar = world.promptProgress;
    const q = bar < 0 ? -1 : Math.round(bar * 100);
    if (this.cache.pbar !== q) {
      this.cache.pbar = q;
      e.promptBar.style.width = q < 0 ? '0' : `${q}%`;
    }
  }

  // Costa Air-1 overlay, created here (no markup in index.html): the status pill under the stars, the spotlight glare vignette and the Scanner Ghost toast.
  _buildAir() {
    const mk = (id, css, parent, html = '') => {
      const d = document.createElement('div');
      d.id = id;
      d.style.cssText = css;
      d.innerHTML = html;
      parent.appendChild(d);
      return d;
    };
    this.air = {
      glare: mk('air-glare', 'position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse 70% 55% at 50% 0%,rgba(220,242,255,0.18),rgba(220,242,255,0.07) 45%,rgba(220,242,255,0) 75%);', this.root),
      pill: mk('air-pill', 'display:none;width:142px;height:22px;margin:6px 0 0 auto;position:relative;box-sizing:border-box;border-radius:4px;background:rgba(12,16,24,0.72);border-left:3px solid #fff;font:italic 800 11px/19px system-ui,sans-serif;letter-spacing:1px;color:#fff;text-align:center;overflow:hidden;white-space:nowrap;', this.el.vouch.parentElement, '<span></span><i style="position:absolute;left:0;bottom:0;height:3px;width:0;background:#fff"></i>'),
      cloak: mk('air-cloak', 'display:none;width:142px;margin:4px 0 0 auto;padding:2px 0;box-sizing:border-box;border-radius:4px;background:rgba(12,16,24,0.72);border-left:3px solid #4deeea;font:italic 800 11px/16px system-ui,sans-serif;letter-spacing:1px;color:#4deeea;text-align:center;', this.el.vouch.parentElement, 'DECOY CLOAK'),
      toast: mk('air-toast', 'display:none;position:absolute;left:50%;top:15%;transform:translateX(-50%);padding:10px 26px;border-radius:6px;background:linear-gradient(90deg,rgba(12,16,24,0.88),rgba(10,40,48,0.88));border:2px solid #ffd23f;box-shadow:0 0 18px rgba(77,238,234,0.55);font:italic 900 22px/1.2 system-ui,sans-serif;letter-spacing:2px;color:#ffe27a;text-shadow:0 0 10px rgba(77,238,234,0.7);white-space:nowrap;pointer-events:none;', this.root),
    };
    this.air.label = this.air.pill.firstChild;
    this.air.bar = this.air.pill.lastChild;
  }

  // Air-1 pill (state + lock / countdown bar), glare vignette and the 4 s Scanner Ghost banner.
  _air(world) {
    const a = this.air;
    const ap = world.air;
    if (!ap) return;
    const v = ap.view;
    const on = ap.active && !world.fx;
    const key = on ? v.label + v.color : '';
    if (this.cache.airKey !== key) {
      this.cache.airKey = key;
      a.pill.style.display = on ? 'block' : 'none';
      a.pill.style.borderLeftColor = v.color;
      a.pill.style.color = v.color;
      a.bar.style.background = v.color;
      a.label.textContent = v.label;
    }
    if (on) {
      a.bar.style.width = `${Math.round(v.fill * 100)}%`;
      a.pill.style.opacity = v.pulse ? (Math.floor(ap.time * 8) % 2 ? '1' : '0.6') : '1'; // 4 Hz pulse on VISUAL LOCK (driven by the air clock, so shots are deterministic)
    }
    const cloak = on && v.cloak;
    if (this.cache.airCloak !== cloak) {
      this.cache.airCloak = cloak;
      a.cloak.style.display = cloak ? 'block' : 'none';
    }
    const glare = on ? Math.round(v.glare * 20) / 20 : 0;
    if (this.cache.airGlare !== glare) {
      this.cache.airGlare = glare;
      a.glare.style.opacity = String(glare);
    }
    const t = ap.toast;
    const txt = t ? `SCANNER GHOST — AIR-1 EVADED +$${t.amount.toLocaleString('en-US')}` : '';
    if (this.cache.airToast !== txt) {
      this.cache.airToast = txt;
      a.toast.style.display = t ? 'block' : 'none';
      a.toast.textContent = txt;
    }
  }

  // Minimap overlay, drawn after Minimap.draw on the same canvas with the same transform (2 px per metre, camera heading up):
  // the searchlight disc, the rotor icon (chevron + spinning X in alternating red / blue) and a yellow-black tick per armed Spike-Pod.
  drawAirMinimap(minimap, world, camYaw) {
    const m = world.air?.mapView;
    if (!m) return;
    const g = minimap.ctx;
    const R = minimap.size / 2;
    const S = MAP_S; // same pixels-per-metre and origin as the pre-rendered map, imported so the overlay can never drift out of register
    const u = (x) => (MAP_X - x) * S, vv = (z) => (MAP_Z - z) * S;
    const zoom = minimap.zoom ?? 1;
    const p = world.player;
    const inv = 1 / zoom;
    g.save();
    g.beginPath();
    g.arc(R, R, R - 3, 0, Math.PI * 2);
    g.clip();
    g.translate(R, R);
    g.rotate(camYaw);
    g.scale(zoom, zoom);
    g.translate(-u(p.px), -vv(p.pz));
    const now = m.time;
    // spotlight ground disc
    g.fillStyle = m.locked ? 'rgba(255, 90, 80, 0.40)' : 'rgba(216, 242, 255, 0.28)';
    g.beginPath();
    g.arc(u(m.disc.x), vv(m.disc.z), m.disc.R * S, 0, Math.PI * 2);
    g.fill();
    // spike-pod ticks: 6 x 2 px bars along the strip, a pulsing ring while the pod is still falling
    for (const pod of m.pods) {
      g.save();
      g.translate(u(pod.tx), vv(pod.tz));
      g.scale(inv, inv);
      if (pod.state === 'drop') {
        g.strokeStyle = '#ffd23f';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, 5 + 3 * Math.abs(Math.sin(now * 6)), 0, Math.PI * 2);
        g.stroke();
      } else {
        g.rotate(-pod.hl); // the strip runs across the lane
        g.fillStyle = '#ffd23f';
        g.fillRect(-3, -1, 6, 2);
        g.fillStyle = '#15161a';
        g.fillRect(-1.5, -1, 1.5, 2);
        g.fillRect(1.5, -1, 1.5, 2);
      }
      g.restore();
    }
    // rotor icon
    const dx = (u(m.x) - u(p.px)) * zoom, dy = (vv(m.z) - vv(p.pz)) * zoom;
    g.restore();
    if (Math.hypot(dx, dy) < R - 12) {
      g.save();
      g.translate(R, R);
      g.rotate(camYaw);
      g.translate(dx, dy);
      g.scale(1.45, 1.45); // the 440 px canvas is shown at ~236 css px, so the briefed 9 px chevron is drawn 1.45x to stay legible next to the player arrow
      const col =Math.floor(now * 6) % 2 ? '#ff3b3b' : '#3b8dff';
      g.rotate(-m.yaw); // still in the map frame: the chevron points along the nose (map x = -x, y = -z)
      g.fillStyle = '#ffffff';
      g.strokeStyle = 'rgba(12,16,24,0.9)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, -9);
      g.lineTo(5.5, 5);
      g.lineTo(0, 2);
      g.lineTo(-5.5, 5);
      g.closePath();
      g.fill();
      g.stroke();
      g.rotate(m.yaw + now * 12); // spinning X of the rotor
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-8, -8);
      g.lineTo(8, 8);
      g.moveTo(8, -8);
      g.lineTo(-8, 8);
      g.stroke();
      g.restore();
    }
  }

  show(visible) {
    this.root.classList.toggle('hidden', !visible);
  }

  _set(key, el, value) {
    if (this.cache[key] !== value) {
      this.cache[key] = value;
      el.textContent = value;
    }
  }

  update(dt, world) {
    const p = world.player;
    const e = this.el;
    this._cash(world);
    this.deltaTimer -= dt;
    if (this.deltaTimer <= 0 && e.cashDelta.classList.contains('show')) e.cashDelta.classList.remove('show');
    this._wanted(world);
    this._intercept(world);
    this._armored(world, dt);
    this._crests(world, dt);
    this._ambient(world, dt);
    this._air(world);
    this.customsHud.update(world, this.root);
    this.gpHud.update(world);
    this.playTime += dt;
    e.hints.classList.toggle('dim', this.playTime > HINT_DIM_AFTER);
    const bust = Math.max(world.police.bustProgress, world.patrol.bustProgress);
    e.bust.classList.toggle('hidden', bust <= 0.01);
    if (bust > 0.01) e.bustBar.style.width = `${Math.round(bust * 100)}%`;
    const fx = world.fx ? world.fx.kind : '';
    if (this.cache.fx !== fx) {
      this.cache.fx = fx;
      e.banner.className = fx ? `banner-${fx}` : 'hidden';
      e.banner.textContent = fx.toUpperCase();
    }
    const m = world.missions.view;
    if (this.cache.mt !== undefined && (this.cache.mt !== m.title || this.cache.mo !== m.objective)) this._retrigger(e.mission, 'flash');
    this._set('mt', e.mTitle, m.title);
    this._set('mo', e.mObj, m.objective);
    this._set('md', e.mDist, `${Math.round(m.dist)} m`);
    const left = m.time === null ? null : Math.max(0, m.time);
    this._set('mti', e.mTime, left === null ? `Step ${m.step}` : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
    e.mTime.classList.toggle('late', left !== null && left < 20);
    this._set('mr', e.mReward, `Reward ${m.rewardText ?? `$${m.reward}`}`);
    const inCar = p.inCar;
    const boat = inCar && !!p.vehicle.isBoat;
    if (this.cache.inCar !== inCar || this.cache.boat !== boat) {
      this.cache.inCar = inCar;
      this.cache.boat = boat;
      e.speedo.classList.toggle('hidden', !inCar);
      e.hints.textContent = boat
        ? 'W/S throttle   A/D steer   Space trim boost   F step onto dock or shore   M sound   Esc pause'
        : inCar
          ? 'W/S gas & brake   A/D steer   Space handbrake   F get out   M sound   Esc pause'
          : 'WASD move   Shift sprint   Space jump   F drive nearby car or board a boat   M sound   Esc pause';
      e.speedUnit.textContent = boat ? 'KTS' : 'km/h';
      e.hullRow.classList.toggle('hidden', !boat);
      e.trim.classList.toggle('hidden', !boat);
      e.hpTrack.classList.toggle('boat', boat);
      this.cache.sfx = undefined;
    }
    this._contraband(world);
    this._taxi(world);
    this._tow(world);
    this._photoTour(world);
    this._courier(world);
    this._valet(world);
    this._loopTour(world);
    this._cashPickup(world);
    this._paramedic(world);
    this._fuelRun(world);
    this._buggy(world);
    this._stunt(world);
    this._rally(world);
    this._repo(world);
    this._escort(world);
    this._drift(world);
    if (boat) {
      const b = p.vehicle;
      this._set('speed', e.speed, String(Math.round(b.knots)));
      this._set('car', e.carName, b.type.name);
      const pct = Math.round(b.health);
      e.hpBar.style.width = `${pct}%`;
      this._set('hullpct', e.hullPct, `${pct}%`);
      e.hpTrack.classList.toggle('warn', pct < 35 && pct >= 15);
      e.hpTrack.classList.toggle('crit', pct < 15);
      const ratio = Math.min(1, Math.abs(b.speedF) / 42.5);
      e.speedBar.style.width = `${(ratio * 100).toFixed(0)}%`;
      e.speedBar.classList.toggle('redline', b.boostT > 0);
      e.trim.classList.toggle('ready', b.boostReady);
      e.drift.classList.add('hidden');
      const fx = Math.max(0, Math.min(0.55, (Math.abs(b.speedF) / 34 - 0.78) * 2.4)) * (b.boostT > 0 ? 1 : 0.6);
      const q = Math.round(fx * 20) / 20;
      if (this.cache.sfx !== q) {
        this.cache.sfx = q;
        e.speedfx.style.opacity = String(q);
      }
    } else if (inCar) {
      const kmh = Math.round(p.vehicle.speedKmh);
      this._set('speed', e.speed, String(kmh));
      this._set('car', e.carName, p.vehicle.type.name);
      e.hpBar.style.width = `${Math.round(p.vehicle.health)}%`;
      const ratio = Math.min(1, p.vehicle.speedKmh / (p.vehicle.topSpeed * 3.6));
      e.speedBar.style.width = `${(ratio * 100).toFixed(0)}%`;
      e.speedBar.classList.toggle('redline', ratio > 0.92);
      // DRIFT tag: held briefly so it does not flicker while the slide fades
      const v = p.vehicle;
      this.driftHold = v.slip > 3.2 && Math.abs(v.speedF) > 8 ? 0.35 : Math.max(0, this.driftHold - dt);
      e.drift.classList.toggle('hidden', this.driftHold <= 0);
      // speed lines only in the last stretch of top speed
      const fx = Math.max(0, Math.min(0.55, (ratio - 0.72) * 2.2));
      const q = Math.round(fx * 20) / 20;
      if (this.cache.sfx !== q) {
        this.cache.sfx = q;
        e.speedfx.style.opacity = String(q);
      }
    }
    if (!inCar && this.cache.sfx) {
      this.cache.sfx = 0;
      e.speedfx.style.opacity = '0';
    }
    this._set('district', e.district, world.district);
    if (this.cache.prompt !== world.prompt) {
      this.cache.prompt = world.prompt;
      const m2 = /^\[(\w+)\]\s*(.*)$/.exec(world.prompt);
      e.promptKey.textContent = m2 ? m2[1] : '';
      e.promptText.textContent = m2 ? m2[2] : world.prompt;
      e.prompt.classList.toggle('hidden', !world.prompt);
    }

    for (const msg of world.messages) this.toastQueue.push(msg);
    world.messages.length = 0;
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) {
      const next = this.toastQueue.shift();
      if (next) {
        e.toast.textContent = next.text;
        e.toast.className = `toast-${next.kind} show`;
        this.toastTimer = next.kind === 'mission' || next.kind === 'stunt' ? 3.2 : 2.2;
      } else {
        e.toast.classList.remove('show');
      }
    }
  }
}
