/**
 * Acoustic Field Pro — app.js
 * UI controller and visualization engine
 * Powered by OrdoAudio.js
 */

'use strict';

// ============================================================================
// CONSTANTS & GLOBALS
// ============================================================================

const ordo = new OrdoAudio({
  fftSize: 4096,
  smoothingTimeConstant: 0.82,
  minDecibels: -100,
  maxDecibels: 0,
});

let isActive = false;
let peakDbHold = -Infinity;
let peakHoldTimer = 0;

// ============================================================================
// DOM REFERENCES
// ============================================================================

const dom = {
  powerBtn:        document.getElementById('power-btn'),
  powerBtnText:    document.getElementById('power-btn-text'),
  standbyOverlay:  document.getElementById('standby-overlay'),
  errorModal:      document.getElementById('error-modal'),
  errorMsg:        document.getElementById('error-msg'),
  errorDismiss:    document.getElementById('error-dismiss'),

  // Status pills
  ledStatus:  document.getElementById('led-status'),
  ledClip:    document.getElementById('led-clip'),
  ledFdbk:    document.getElementById('led-fdbk'),
  pillStatus: document.getElementById('pill-status'),
  pillClip:   document.getElementById('pill-clip'),
  pillFdbk:   document.getElementById('pill-fdbk'),

  // Canvases
  rtaCanvas:         document.getElementById('rta-canvas'),
  oscCanvas:         document.getElementById('osc-canvas'),
  spectrogramCanvas: document.getElementById('spectrogram-canvas'),

  // Metrics — row
  valLevel:   document.getElementById('val-level'),
  valPeak:    document.getElementById('val-peak'),
  meterLevel: document.getElementById('meter-level'),
  valFreq:    document.getElementById('val-freq'),
  valNote:    document.getElementById('val-note'),
  valNoteDetail: document.getElementById('val-note-detail'),
  valBpm:     document.getElementById('val-bpm'),
  valBpmConf: document.getElementById('val-bpm-conf'),
  valKey:     document.getElementById('val-key'),
  valKeyMode: document.getElementById('val-key-mode'),

  // LUFS
  lufsM:   document.getElementById('lufs-m'),
  lufsS:   document.getElementById('lufs-s'),
  lufsI:   document.getElementById('lufs-i'),
  lufsLra: document.getElementById('lufs-lra'),
  barLufsM: document.getElementById('bar-lufs-m'),
  barLufsS: document.getElementById('bar-lufs-s'),
  barLufsI: document.getElementById('bar-lufs-i'),

  // True peak & dynamics
  truePeakVal:  document.getElementById('true-peak-val'),
  crestVal:     document.getElementById('crest-val'),
  drVal:        document.getElementById('dr-val'),
  comprVal:     document.getElementById('compr-val'),
  truePeakLed:  document.getElementById('true-peak-led'),

  // Eq bars
  barLow:  document.getElementById('bar-low'),
  barMid:  document.getElementById('bar-mid'),
  barHigh: document.getElementById('bar-high'),

  // Chromagram
  chromaBars: document.querySelectorAll('.chroma-bar'),

  // MFCC
  mfccBars: document.querySelectorAll('.mfcc-bar'),

  // THD
  thdVal:     document.getElementById('thd-val'),
  harmonicBars: document.querySelectorAll('.harmonic-bar'),

  // SNR
  snrVal:      document.getElementById('snr-val'),
  noiseFloor:  document.getElementById('noise-floor'),

  // ZCR & DC
  zcrVal:     document.getElementById('zcr-val'),
  zcrType:    document.getElementById('zcr-type'),
  dcVal:      document.getElementById('dc-val'),
  dcSeverity: document.getElementById('dc-severity'),

  // Phase
  phaseNeedle: document.getElementById('phase-needle'),
  phaseStr:    document.getElementById('phase-str'),
  phaseCorr:   document.getElementById('phase-corr'),

  // Spectral
  centroidVal:  document.getElementById('centroid-val'),
  flatnessVal:  document.getElementById('flatness-val'),
  rolloffVal:   document.getElementById('rolloff-val'),
  bandwidthVal: document.getElementById('bandwidth-val'),

  // RT60
  rt60Val:    document.getElementById('rt60-val'),

  // Alerts
  alertClip:  document.getElementById('alert-clip'),
  alertFdbk:  document.getElementById('alert-fdbk'),
  alertFdbkFreq: document.getElementById('alert-fdbk-freq'),
  alertFdbkNote: document.getElementById('alert-fdbk-note'),
  alertDc:    document.getElementById('alert-dc'),

  // Standing waves
  modesContainer: document.getElementById('modes-container'),

  // Tabs
  tabBtns:     document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
};

// ============================================================================
// CANVAS SETUP — DPI-aware
// ============================================================================

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

function getLogicalSize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  return {
    w: canvas.width / dpr,
    h: canvas.height / dpr,
  };
}

// Spectrogram scroll buffer
let spectrogramCtx = null;
const SPECT_HISTORY = 400;

function initCanvases() {
  setupCanvas(dom.rtaCanvas);
  setupCanvas(dom.oscCanvas);
  const sc = setupCanvas(dom.spectrogramCanvas);
  if (sc) {
    spectrogramCtx = sc;
    const { w, h } = getLogicalSize(dom.spectrogramCanvas);
    sc.fillStyle = '#080c10';
    sc.fillRect(0, 0, w, h);
  }
}

window.addEventListener('resize', () => {
  initCanvases();
});

// ============================================================================
// VISUALIZATIONS
// ============================================================================

// Color for RTA bars based on frequency band
function rtaBandColor(center) {
  if (center < 250)  return '#00aaff';
  if (center < 4000) return '#00ff88';
  return '#a855f7';
}

// Draw RTA (1/3 octave bars)
function drawRta(rtaData) {
  const canvas = dom.rtaCanvas;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx || w === 0) return;

  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const gridLines = [0.75, 0.5, 0.25];
  gridLines.forEach((ratio) => {
    const y = h * (1 - ratio);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });

  const bands = rtaData.bands;
  const numBands = bands.length;
  const totalGap = numBands * 2;
  const barW = Math.max(2, (w - totalGap) / numBands);

  bands.forEach((band, i) => {
    const x = i * (barW + 2);
    const barH = band.normalized * (h - 4);
    const y = h - barH;

    // Bar gradient
    const grad = ctx.createLinearGradient(0, y, 0, h);
    const col = rtaBandColor(band.center);
    grad.addColorStop(0, col);
    grad.addColorStop(1, col + '44');

    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, barH);

    // Top cap glow
    if (band.normalized > 0.01) {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, barW, 2);
    }
  });
}

// Draw Oscilloscope waveform
function drawOscilloscope(timeData) {
  const canvas = dom.oscCanvas;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx || w === 0) return;

  ctx.clearRect(0, 0, w, h);

  // Center line
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // Waveform
  ctx.beginPath();
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = '#00ff88';
  ctx.shadowBlur = 4;

  const step = w / timeData.length;
  for (let i = 0; i < timeData.length; i++) {
    const x = i * step;
    const y = (1 - (timeData[i] + 1) / 2) * h;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// Update Spectrogram (scrolling waterfall)
function updateSpectrogram(freqData, sampleRate, fftSize) {
  const canvas = dom.spectrogramCanvas;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const ctx = spectrogramCtx;
  if (!ctx || w === 0) return;

  // Scroll left
  const imgData = ctx.getImageData(dpr, 0, canvas.width - dpr, canvas.height);
  ctx.putImageData(imgData, 0, 0);

  // Draw new column on right edge
  const colW = 1;
  const numBins = freqData.length;

  for (let y = 0; y < h; y++) {
    // Map y-pixel to frequency (log scale)
    const freqRatio = 1 - y / h;
    const freq = Math.pow(20000 / 20, freqRatio) * 20;
    const bin = Math.round((freq / (sampleRate / 2)) * numBins);
    const db = bin < numBins ? freqData[bin] : -100;

    // Map dB to color: -100=black, -60=blue, -30=green, -10=yellow, 0=red
    const norm = Math.max(0, Math.min(1, (db + 100) / 100));
    const [r, g, b] = spectrogramColor(norm);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(w - colW, y, colW, 1);
  }
}

function spectrogramColor(norm) {
  // Deep space → blue → green → amber → red
  if (norm < 0.2) {
    const t = norm / 0.2;
    return [Math.round(t * 0), Math.round(t * 30), Math.round(t * 120)];
  } else if (norm < 0.5) {
    const t = (norm - 0.2) / 0.3;
    return [0, Math.round(30 + t * 200), Math.round(120 - t * 90)];
  } else if (norm < 0.8) {
    const t = (norm - 0.5) / 0.3;
    return [Math.round(t * 255), Math.round(230 - t * 100), 30];
  } else {
    const t = (norm - 0.8) / 0.2;
    return [255, Math.round(130 - t * 130), 0];
  }
}

// ============================================================================
// UI UPDATE — runs every frame
// ============================================================================

function updateUI(data) {
  // ------ Level Meter ------
  const dbfs = data.dynamics ? data.dynamics.rmsDb : -100;
  const levelNorm = Math.max(0, Math.min(1, (dbfs + 60) / 60));

  dom.valLevel.textContent = isFinite(dbfs) ? dbfs.toFixed(1) : '-∞';
  dom.valLevel.className = 'metric-value ' + (dbfs > -6 ? 'red' : dbfs > -18 ? 'amber' : 'green');

  // Peak hold
  if (data.clipping) {
    const pk = data.clipping.peakDb;
    if (pk > peakDbHold) { peakDbHold = pk; peakHoldTimer = 90; }
    else if (peakHoldTimer-- <= 0) { peakDbHold -= 0.05; }
    dom.valPeak.textContent = isFinite(peakDbHold) ? peakDbHold.toFixed(1) : '-∞';
  }

  dom.meterLevel.style.width = (levelNorm * 100) + '%';
  dom.meterLevel.className = 'level-bar ' + (levelNorm > 0.9 ? 'danger' : levelNorm > 0.7 ? 'warn' : '');

  // ------ Pitch ------
  if (data.pitch) {
    const f = data.pitch.frequency;
    const n = data.pitch.note;
    dom.valFreq.textContent = f > 0 ? f.toFixed(1) : '--';
    dom.valNote.textContent = n.name !== '--' ? n.name : '--';
    dom.valNoteDetail.textContent = n.cents !== 0 ? `${n.cents > 0 ? '+' : ''}${n.cents}¢` : '';
  }

  // ------ BPM ------
  if (data.onset) {
    dom.valBpm.textContent = data.onset.bpm > 0 ? data.onset.bpm : '--';
    dom.valBpmConf.textContent = data.onset.bpm > 0
      ? `${Math.round(data.onset.confidence * 100)}% conf`
      : 'tracking...';
  }

  // ------ Key / Chroma ------
  if (data.chroma) {
    dom.valKey.textContent = data.chroma.key;
    dom.valKeyMode.textContent = data.chroma.mode;
    // Chromagram bars
    data.chroma.chroma.forEach((val, i) => {
      if (dom.chromaBars[i]) {
        dom.chromaBars[i].style.height = (val * 100) + '%';
        dom.chromaBars[i].style.background = i === noteIndex(data.chroma.key) ? '#00ff88' : '#a855f7';
      }
    });
  }

  // ------ LUFS ------
  if (data.lufs) {
    const { momentary, shortTerm, integrated, lra } = data.lufs;
    dom.lufsM.textContent   = isFinite(momentary)   ? momentary.toFixed(1) : '-∞';
    dom.lufsS.textContent   = isFinite(shortTerm)   ? shortTerm.toFixed(1) : '-∞';
    dom.lufsI.textContent   = isFinite(integrated)  ? integrated.toFixed(1): '-∞';
    dom.lufsLra.textContent = lra > 0 ? lra.toFixed(1) + ' LU' : '--';

    const lufsNorm = (l) => Math.max(0, Math.min(1, (l + 50) / 50));
    dom.barLufsM.style.width = (lufsNorm(momentary)  * 100) + '%';
    dom.barLufsS.style.width = (lufsNorm(shortTerm)  * 100) + '%';
    dom.barLufsI.style.width = (lufsNorm(integrated) * 100) + '%';
  }

  // ------ True Peak & Dynamics ------
  if (data.truePeak) {
    const tp = data.truePeak.truePeakHold;
    dom.truePeakVal.textContent = isFinite(tp) ? tp.toFixed(1) : '-∞';
    dom.truePeakVal.className   = 'metric-value ' + (data.truePeak.isOver ? 'red' : '');
    setLed(dom.truePeakLed, data.truePeak.isOver ? 'red' : '');
  }

  if (data.dynamics) {
    dom.crestVal.textContent = data.dynamics.crestFactor.toFixed(1);
    dom.drVal.textContent    = data.dynamics.dynamicRange.toFixed(1);
    dom.comprVal.textContent = (data.dynamics.compressionAmount * 100).toFixed(0) + '%';
  }

  // ------ EQ Profile ------
  if (data.spectral && data.rta) {
    const bands = data.rta.bands;
    const avgBand = (from, to) => {
      const b = bands.filter(b => b.center >= from && b.center <= to);
      return b.length ? b.reduce((s, b) => s + b.normalized, 0) / b.length : 0;
    };
    const low  = avgBand(20,   300);
    const mid  = avgBand(300,  4000);
    const high = avgBand(4000, 20000);
    dom.barLow.style.height  = (low  * 100) + '%';
    dom.barMid.style.height  = (mid  * 100) + '%';
    dom.barHigh.style.height = (high * 100) + '%';
  }

  // ------ Spectral Features ------
  if (data.spectral) {
    const { centroid, flatness, rolloff, bandwidth } = data.spectral;
    dom.centroidVal.textContent  = centroid  > 0 ? (centroid / 1000).toFixed(2) + ' kHz' : '--';
    dom.flatnessVal.textContent  = (flatness * 100).toFixed(1) + '%';
    dom.rolloffVal.textContent   = rolloff   > 0 ? (rolloff  / 1000).toFixed(2) + ' kHz' : '--';
    dom.bandwidthVal.textContent = bandwidth > 0 ? (bandwidth/ 1000).toFixed(2) + ' kHz' : '--';
  }

  // ------ MFCC ------
  if (data.mfcc) {
    const coeffs = data.mfcc.mfcc;
    const maxAbs  = Math.max(...coeffs.map(Math.abs), 1);
    dom.mfccBars.forEach((bar, i) => {
      if (i < coeffs.length) {
        const norm = coeffs[i] / maxAbs;
        const height = Math.abs(norm) * 50;
        bar.style.height = height + '%';
        bar.style.top    = norm > 0 ? (50 - height) + '%' : '50%';
        const hue = Math.round((i / 13) * 200 + 160);
        bar.style.background = `hsl(${hue}, 80%, 55%)`;
      }
    });
  }

  // ------ THD ------
  if (data.thd) {
    dom.thdVal.textContent = data.thd.thdString;
    dom.thdVal.className   = 'metric-value ' + (data.thd.thd > 5 ? 'red' : data.thd.thd > 1 ? 'amber' : '');
    dom.harmonicBars.forEach((bar, i) => {
      if (i < data.thd.harmonics.length) {
        const h = data.thd.harmonics[i];
        const norm = Math.max(0, Math.min(1, (h.db + 80) / 60));
        bar.style.height = (norm * 100) + '%';
      }
    });
  }

  // ------ SNR ------
  if (data.snr) {
    if (data.snr.calibrating) {
      dom.snrVal.textContent    = 'CALIB';
      dom.noiseFloor.textContent = '--';
    } else {
      dom.snrVal.textContent    = data.snr.snrString;
      dom.noiseFloor.textContent = data.snr.noiseFloor ? data.snr.noiseFloor.toFixed(1) + ' dB' : '--';
    }
  }

  // ------ ZCR & DC ------
  if (data.zcr) {
    dom.zcrVal.textContent  = (data.zcr.zcr / 1000).toFixed(1) + ' kHz';
    dom.zcrType.textContent = data.zcr.type;
  }
  if (data.dcOffset) {
    dom.dcVal.textContent      = (data.dcOffset.dcOffset * 1000).toFixed(2) + ' mV';
    dom.dcSeverity.textContent = data.dcOffset.severity.toUpperCase();
    dom.dcSeverity.className   = 'metric-value ' + (
      data.dcOffset.severity === 'critical' ? 'red' :
      data.dcOffset.severity === 'warning'  ? 'amber' : ''
    );
    setAlert(dom.alertDc, data.dcOffset.hasIssue, 'amber');
  }

  // ------ Phase ------
  if (data.phase) {
    const corr = data.phase.correlation;
    dom.phaseNeedle.style.left = ((corr + 1) / 2 * 100) + '%';
    dom.phaseStr.textContent   = data.phase.phaseString;
    dom.phaseCorr.textContent  = corr.toFixed(2);
  }

  // ------ RT60 ------
  if (data.rt60) {
    dom.rt60Val.textContent = data.rt60.rt60String;
  }

  // ------ Clipping LED ------
  if (data.clipping) {
    const clip = data.clipping.clipLedActive;
    setLed(dom.ledClip, clip ? 'red' : '');
    setPill(dom.pillClip, clip ? 'danger' : '');
    setAlert(dom.alertClip, clip, 'red');
  }

  // ------ Feedback LED ------
  if (data.feedback) {
    const fdbk = data.feedback.isFeedbackRisk;
    setLed(dom.ledFdbk, fdbk ? 'amber' : '');
    setPill(dom.pillFdbk, fdbk ? 'warn' : '');
    setAlert(dom.alertFdbk, fdbk, 'amber');
    if (fdbk && data.feedback.notchSuggestion) {
      const ns = data.feedback.notchSuggestion;
      dom.alertFdbkFreq.textContent = ns.frequency.toFixed(1) + ' Hz';
      dom.alertFdbkNote.textContent = ns.note.name || '--';
    }
  }

  // ------ Standing Waves ------
  if (data.standingWaves && dom.modesContainer) {
    const modes = data.standingWaves.modes;
    dom.modesContainer.innerHTML = '';
    if (modes.length === 0) {
      dom.modesContainer.innerHTML = '<div class="text-dim font-mono" style="font-size:10px;padding:4px">No room modes detected</div>';
    } else {
      modes.forEach((mode, i) => {
        const div = document.createElement('div');
        div.className = `mode-item ${i === 0 ? 'critical' : 'warning'}`;
        div.innerHTML = `
          <span class="mode-freq">${mode.freq.toFixed(0)} Hz</span>
          <span class="mode-db">${mode.db.toFixed(1)} dB</span>
        `;
        dom.modesContainer.appendChild(div);
      });
    }
  }

  // ------ Draw Canvases ------
  if (data.rta) drawRta(data.rta);
  drawOscilloscope(data.raw.timeData);
  updateSpectrogram(data.raw.freqData, data.sampleRate, data.fftSize);
}

// ============================================================================
// HELPERS
// ============================================================================

function setLed(el, state) {
  if (!el) return;
  el.className = 'led ' + (state || '');
}

function setPill(el, state) {
  if (!el) return;
  el.className = 'status-pill ' + (state || '');
}

function setAlert(el, active, type) {
  if (!el) return;
  el.className = 'alert-box ' + (active ? `active-${type}` : '');
}

function noteIndex(noteName) {
  return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(noteName);
}

function showError(msg) {
  if (dom.errorMsg) dom.errorMsg.textContent = msg;
  if (dom.errorModal) dom.errorModal.classList.add('open');
}

// ============================================================================
// ENGINE CONTROL
// ============================================================================

async function startEngine() {
  try {
    dom.powerBtnText.textContent = 'STARTING...';
    dom.powerBtn.disabled = true;

    // Enable all modules
    ordo.use(...OrdoAudio.modules);

    await ordo.init('microphone');

    ordo.on('frame', (data) => {
      updateUI(data);
    });

    ordo.on('error', (err) => {
      showError('Audio engine error: ' + err.message);
      stopEngine();
    });

    ordo.start();
    isActive = true;

    // Update UI state
    dom.powerBtn.classList.add('active');
    dom.powerBtnText.textContent = 'STOP';
    dom.powerBtn.disabled = false;
    dom.standbyOverlay.classList.add('hidden');

    setLed(dom.ledStatus, 'green');
    setPill(dom.pillStatus, 'active');
    dom.pillStatus.querySelector('span:last-child').textContent = 'LIVE';

    // Init canvases now that they're visible
    setTimeout(initCanvases, 100);

  } catch (err) {
    dom.powerBtn.disabled = false;
    dom.powerBtnText.textContent = 'INIT ENG';
    let msg = 'Microphone access is required to analyze the acoustic field.';
    if (err.name === 'NotAllowedError') msg = 'Microphone permission was denied. Please allow microphone access and try again.';
    else if (err.name === 'NotFoundError') msg = 'No microphone device found. Please connect a microphone and try again.';
    showError(msg);
  }
}

function stopEngine() {
  ordo.destroy();
  isActive = false;
  peakDbHold = -Infinity;

  dom.powerBtn.classList.remove('active');
  dom.powerBtnText.textContent = 'INIT ENG';
  dom.standbyOverlay.classList.remove('hidden');

  setLed(dom.ledStatus, '');
  setLed(dom.ledClip, '');
  setLed(dom.ledFdbk, '');
  setPill(dom.pillStatus, '');
  dom.pillStatus.querySelector('span:last-child').textContent = 'STANDBY';

  // Clear canvases
  [dom.rtaCanvas, dom.oscCanvas, dom.spectrogramCanvas].forEach((c) => {
    const ctx = c.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, c.width, c.height);
  });

  // Reset metrics
  dom.valLevel.textContent = '-∞';
  dom.valFreq.textContent  = '--';
  dom.valNote.textContent  = '--';
  dom.valBpm.textContent   = '--';
  dom.valKey.textContent   = '--';
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

dom.powerBtn.addEventListener('click', () => {
  if (isActive) stopEngine();
  else startEngine();
});

dom.errorDismiss.addEventListener('click', () => {
  dom.errorModal.classList.remove('open');
});

// Tab switching
dom.tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    dom.tabBtns.forEach((b)    => b.classList.remove('active'));
    dom.tabContents.forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById('tab-' + btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});

// ============================================================================
// INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize canvas sizes once DOM is ready
  requestAnimationFrame(() => {
    initCanvases();
  });
});
