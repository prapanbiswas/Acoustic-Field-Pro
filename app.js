/**
 * Acoustic Field Pro v2 — app.js
 * UI controller, visualization engine, recording, logging, exports
 * Powered by OrdoAudio.js v2.0
 */
'use strict';

// ============================================================================
// ENGINE INSTANCE
// ============================================================================

const ordo = new OrdoAudio({
  fftSize: 4096,
  smoothingTimeConstant: 0.82,
  minDecibels: -100,
  maxDecibels: 0,
  windowType: 'hann',
  useAWeighting: false,
});

// ============================================================================
// STATE
// ============================================================================

let isActive        = false;
let peakDbHold      = -Infinity;
let peakHoldFrames  = 0;

// RTA peak-hold per band
let rtaPeakHold     = new Float32Array(31).fill(0);
let rtaPeakHoldFrames = new Float32Array(31).fill(0);

// Recording state
let mediaRecorder   = null;
let recordedChunks  = [];
let isRecording     = false;
let recStartTime    = 0;
let recTimerInterval = null;

// Metric logger state
let isLogging       = false;
let metricLog       = [];       // Array of {ts, ...metrics}
let eventLog        = [];       // Array of {ts, type, msg}
let logStartTime    = 0;

// Test tone state
let toneOscillator  = null;
let toneNoiseNode   = null;
let toneGain        = null;
let activeToneType  = 'off';

// Canvas contexts (persistent refs after init)
let rtaCtx          = null;
let oscCtx          = null;
let spectCtx        = null;
let lufsHistCtx     = null;

// LUFS history ring buffer (60s at ~30fps = 1800 entries, but we subsample to 60)
const LUFS_HIST_MAX = 120;
let lufsHistory     = [];

// ============================================================================
// DOM REFS
// ============================================================================

const $ = id => document.getElementById(id);
const dom = {
  powerBtn:         $('power-btn'),
  powerBtnText:     $('power-btn-text'),
  standbyOverlay:   $('standby-overlay'),
  errorModal:       $('error-modal'),
  errorMsg:         $('error-msg'),
  errorDismiss:     $('error-dismiss'),

  // Status
  ledStatus:  $('led-status'),  pillStatus: $('pill-status'),  pillStatusLabel: $('pill-status-label'),
  ledClip:    $('led-clip'),    pillClip:   $('pill-clip'),
  ledFdbk:    $('led-fdbk'),    pillFdbk:   $('pill-fdbk'),
  ledTp:      $('led-tp'),      pillTp:     $('pill-tp'),
  ledRec:     $('led-rec'),     pillRec:    $('pill-rec'),
  recTimer:   $('rec-timer'),

  // Canvases
  rtaCanvas:   $('rta-canvas'),
  oscCanvas:   $('osc-canvas'),
  spectCanvas: $('spectrogram-canvas'),
  lufsHistCanvas: $('lufs-history-canvas'),

  // Metrics row
  valLevel:      $('val-level'),
  valPeak:       $('val-peak'),
  meterLevel:    $('meter-level'),
  valFreq:       $('val-freq'),
  valNote:       $('val-note'),
  valNoteDetail: $('val-note-detail'),
  valBpm:        $('val-bpm'),
  valBpmConf:    $('val-bpm-conf'),
  valKey:        $('val-key'),
  valKeyMode:    $('val-key-mode'),

  // LUFS
  lufsM: $('lufs-m'), lufsS: $('lufs-s'), lufsI: $('lufs-i'), lufsLra: $('lufs-lra'),
  barLufsM: $('bar-lufs-m'), barLufsS: $('bar-lufs-s'), barLufsI: $('bar-lufs-i'),

  // True peak & dynamics
  truePeakVal: $('true-peak-val'), ledTpInline: $('led-tp-inline'),
  crestVal: $('crest-val'), drVal: $('dr-val'), comprVal: $('compr-val'),

  // EQ
  barLow: $('bar-low'), barMid: $('bar-mid'), barHigh: $('bar-high'),

  // Chroma
  chromaBars: document.querySelectorAll('.chroma-bar'),

  // MFCC
  mfccBars: document.querySelectorAll('.mfcc-bar'),

  // THD
  thdVal: $('thd-val'),
  harmonicBars: document.querySelectorAll('.harmonic-bar'),

  // SNR / ZCR / DC
  snrVal: $('snr-val'), noiseFloor: $('noise-floor'),
  zcrVal: $('zcr-val'), zcrType: $('zcr-type'),
  dcVal: $('dc-val'), dcSeverity: $('dc-severity'),

  // Phase / RT60
  phaseNeedle: $('phase-needle'), phaseStr: $('phase-str'), phaseCorr: $('phase-corr'),
  rt60Val: $('rt60-val'),

  // Spectral
  centroidVal: $('centroid-val'), flatnessVal: $('flatness-val'),
  rolloffVal: $('rolloff-val'), bandwidthVal: $('bandwidth-val'),

  // Alerts
  alertClip: $('alert-clip'), alertFdbk: $('alert-fdbk'),
  alertFdbkFreq: $('alert-fdbk-freq'), alertFdbkNote: $('alert-fdbk-note'),
  alertDc: $('alert-dc'),

  // Standing waves
  modesContainer: $('modes-container'),

  // RTA controls
  rtaAweightBtn:   $('rta-aweight-btn'),
  rtaSnapshotBtn:  $('rta-snapshot-btn'),
  rtaTooltip:      $('rta-tooltip'),

  // Tabs
  tabBtns:     document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Session / Recording
  sessionRecBtn:    $('session-rec-btn'),
  sessionRecIcon:   $('session-rec-icon'),
  sessionRecLabel:  $('session-rec-label'),
  sessionRecStatus: $('session-rec-status'),
  logToggleBtn:     $('log-toggle-btn'),
  logResetBtn:      $('log-reset-btn'),
  logCount:         $('log-count'),
  eventCount:       $('event-count'),
  eventLogBox:      $('event-log'),
  exportCsvBtn:     $('export-csv-btn'),
  exportReportBtn:  $('export-report-btn'),
  exportRtaBtn:     $('export-rta-btn'),
  statDur:          $('stat-dur'), statPeak: $('stat-peak'),
  statLufsAvg:      $('stat-lufs-avg'), statClips: $('stat-clips'),

  // Tools
  toneFreqSlider:   $('tone-freq-slider'),
  toneFreqDisplay:  $('tone-freq-display'),
  toneVolSlider:    $('tone-vol-slider'),
  toneVolDisplay:   $('tone-vol-display'),
  toneControls:     $('tone-controls'),
  winDescription:   $('win-description'),
  toneBtns:         document.querySelectorAll('.tone-btn'),
  winBtns:          document.querySelectorAll('.win-btn[data-win]'),
  awBtns:           document.querySelectorAll('.win-btn[data-aw]'),
};

// ============================================================================
// CANVAS SETUP — DPI-aware, preserves context refs
// ============================================================================

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

function logW(canvas) { return Math.round(canvas.width  / (window.devicePixelRatio || 1)); }
function logH(canvas) { return Math.round(canvas.height / (window.devicePixelRatio || 1)); }

function initCanvases() {
  rtaCtx   = setupCanvas(dom.rtaCanvas);
  oscCtx   = setupCanvas(dom.oscCanvas);

  const sc = setupCanvas(dom.spectCanvas);
  if (sc) {
    spectCtx = sc;
    const w = logW(dom.spectCanvas), h = logH(dom.spectCanvas);
    sc.fillStyle = '#080c10';
    sc.fillRect(0, 0, w, h);
  }

  if (dom.lufsHistCanvas) {
    lufsHistCtx = setupCanvas(dom.lufsHistCanvas);
  }
}

window.addEventListener('resize', () => {
  // Re-init without wiping spectrogram history image
  rtaCtx  = setupCanvas(dom.rtaCanvas);
  oscCtx  = setupCanvas(dom.oscCanvas);
  if (dom.lufsHistCanvas) lufsHistCtx = setupCanvas(dom.lufsHistCanvas);
  // Spectrogram: re-init and fill bg (we accept the wipe on resize)
  const sc = setupCanvas(dom.spectCanvas);
  if (sc) {
    spectCtx = sc;
    sc.fillStyle = '#080c10';
    sc.fillRect(0, 0, logW(dom.spectCanvas), logH(dom.spectCanvas));
  }
});

// ============================================================================
// DRAW: RTA WITH PEAK-HOLD
// ============================================================================

function rtaBandColor(center) {
  if (center < 250)  return '#00aaff';
  if (center < 4000) return '#00ff88';
  return '#a855f7';
}

function drawRta(rtaData) {
  if (!rtaCtx) return;
  const w = logW(dom.rtaCanvas), h = logH(dom.rtaCanvas);
  rtaCtx.clearRect(0, 0, w, h);

  // Grid lines at -25, -50, -75 dB equivalent
  rtaCtx.strokeStyle = 'rgba(255,255,255,0.025)';
  rtaCtx.lineWidth   = 1;
  [0.75, 0.5, 0.25].forEach(r => {
    const y = h * (1 - r);
    rtaCtx.beginPath(); rtaCtx.moveTo(0, y); rtaCtx.lineTo(w, y); rtaCtx.stroke();
  });

  const bands  = rtaData.bands;
  const nb     = bands.length;
  const gap    = 2;
  const barW   = Math.max(2, (w - nb * gap) / nb);

  bands.forEach((band, i) => {
    const x    = i * (barW + gap);
    const barH = band.normalized * (h - 4);
    const y    = h - barH;
    const col  = rtaBandColor(band.center);

    // Bar gradient
    const grad = rtaCtx.createLinearGradient(0, y, 0, h);
    grad.addColorStop(0, col);
    grad.addColorStop(1, col + '33');
    rtaCtx.fillStyle = grad;
    rtaCtx.fillRect(x, y, barW, barH);

    // Top cap bright pixel
    if (band.normalized > 0.008) {
      rtaCtx.fillStyle = col;
      rtaCtx.fillRect(x, y, barW, 2);
    }

    // Peak hold ghost line — update hold
    if (band.normalized > rtaPeakHold[i]) {
      rtaPeakHold[i]       = band.normalized;
      rtaPeakHoldFrames[i] = 120; // hold ~4s at 30fps
    } else if (rtaPeakHoldFrames[i] > 0) {
      rtaPeakHoldFrames[i]--;
    } else {
      rtaPeakHold[i] = Math.max(0, rtaPeakHold[i] - 0.003); // slow fall
    }

    // Draw peak tick
    if (rtaPeakHold[i] > 0.01) {
      const py = h - rtaPeakHold[i] * (h - 4);
      rtaCtx.fillStyle = '#ffffff44';
      rtaCtx.fillRect(x, py, barW, 1);
    }
  });
}

// ============================================================================
// DRAW: OSCILLOSCOPE WITH ZERO-CROSSING TRIGGER SYNC
// ============================================================================

function drawOscilloscope(timeData) {
  if (!oscCtx) return;
  const w = logW(dom.oscCanvas), h = logH(dom.oscCanvas);
  oscCtx.clearRect(0, 0, w, h);

  // Center line
  oscCtx.strokeStyle = 'rgba(255,255,255,0.04)';
  oscCtx.lineWidth   = 1;
  oscCtx.beginPath(); oscCtx.moveTo(0, h / 2); oscCtx.lineTo(w, h / 2); oscCtx.stroke();

  // Zero-crossing trigger: find first upward zero-crossing after 10% buffer offset
  const minStart  = Math.floor(timeData.length * 0.1);
  const maxSearch = Math.floor(timeData.length * 0.6);
  let triggerIndex = minStart;
  for (let i = minStart; i < maxSearch - 1; i++) {
    if (timeData[i] < 0 && timeData[i + 1] >= 0) { triggerIndex = i; break; }
  }

  // Draw triggered waveform
  oscCtx.beginPath();
  oscCtx.strokeStyle = '#00ff88';
  oscCtx.lineWidth   = 1.5;
  oscCtx.shadowColor = '#00ff88';
  oscCtx.shadowBlur  = 3;

  const drawLen = Math.min(timeData.length - triggerIndex, timeData.length);
  const step    = w / drawLen;

  for (let i = 0; i < drawLen; i++) {
    const sample = timeData[triggerIndex + i];
    const x = i * step;
    const y = (1 - (sample + 1) / 2) * h;
    i === 0 ? oscCtx.moveTo(x, y) : oscCtx.lineTo(x, y);
  }
  oscCtx.stroke();
  oscCtx.shadowBlur = 0;
}

// ============================================================================
// DRAW: SPECTROGRAM WATERFALL
// ============================================================================

function updateSpectrogram(freqData, sampleRate, fftSize) {
  if (!spectCtx) return;
  const w   = logW(dom.spectCanvas);
  const h   = logH(dom.spectCanvas);
  const dpr = window.devicePixelRatio || 1;

  // Shift existing image one pixel left
  const img = spectCtx.getImageData(dpr, 0, dom.spectCanvas.width - dpr, dom.spectCanvas.height);
  spectCtx.putImageData(img, 0, 0);

  // Draw new column on right edge
  const numBins = freqData.length;
  for (let y = 0; y < h; y++) {
    const ratio  = 1 - y / h;
    const freq   = Math.pow(20000 / 20, ratio) * 20;
    const bin    = Math.min(numBins - 1, Math.round((freq / (sampleRate / 2)) * numBins));
    const db     = freqData[bin] || -100;
    const norm   = Math.max(0, Math.min(1, (db + 100) / 100));
    const [r, g, b] = spectColor(norm);
    spectCtx.fillStyle = `rgb(${r},${g},${b})`;
    spectCtx.fillRect(w - 1, y, 1, 1);
  }
}

function spectColor(n) {
  if (n < 0.2) { const t = n / 0.2;            return [0,            Math.round(t * 30),           Math.round(t * 120)]; }
  if (n < 0.5) { const t = (n - 0.2) / 0.3;   return [0,            Math.round(30 + t * 200),      Math.round(120 - t * 90)]; }
  if (n < 0.8) { const t = (n - 0.5) / 0.3;   return [Math.round(t * 255), Math.round(230 - t * 100), 30]; }
                 const t = (n - 0.8) / 0.2;    return [255,          Math.round(130 - t * 130),     0];
}

// ============================================================================
// DRAW: LUFS HISTORY GRAPH
// ============================================================================

function drawLufsHistory() {
  if (!lufsHistCtx || lufsHistory.length < 2) return;
  const w = logW(dom.lufsHistCanvas), h = logH(dom.lufsHistCanvas);
  lufsHistCtx.clearRect(0, 0, w, h);

  // Reference lines at -23 LUFS (EBU R128 target) and -18 LUFS (streaming)
  const lufsToY = l => {
    const norm = Math.max(0, Math.min(1, (l + 50) / 40)); // -50 to -10 range
    return h - norm * h;
  };

  // -23 LUFS target line
  lufsHistCtx.strokeStyle = 'rgba(34,211,238,0.3)';
  lufsHistCtx.lineWidth = 1;
  lufsHistCtx.setLineDash([4, 4]);
  lufsHistCtx.beginPath();
  const y23 = lufsToY(-23);
  lufsHistCtx.moveTo(0, y23); lufsHistCtx.lineTo(w, y23); lufsHistCtx.stroke();

  // -18 LUFS line
  const y18 = lufsToY(-18);
  lufsHistCtx.beginPath();
  lufsHistCtx.moveTo(0, y18); lufsHistCtx.lineTo(w, y18); lufsHistCtx.stroke();
  lufsHistCtx.setLineDash([]);

  // LUFS line
  lufsHistCtx.beginPath();
  lufsHistCtx.strokeStyle = '#00aaff';
  lufsHistCtx.lineWidth   = 1.5;
  const step = w / LUFS_HIST_MAX;

  lufsHistory.forEach((val, i) => {
    if (!isFinite(val)) return;
    const x = i * step;
    const y = lufsToY(val);
    i === 0 ? lufsHistCtx.moveTo(x, y) : lufsHistCtx.lineTo(x, y);
  });
  lufsHistCtx.stroke();
}

// ============================================================================
// MAIN UI UPDATE — runs every frame
// ============================================================================

let frameSkip = 0; // skip every-other LUFS history update to reduce load

function updateUI(data) {
  // ---- Level ----
  const db = data.dynamics ? data.dynamics.rmsDb : -100;
  const levelNorm = Math.max(0, Math.min(1, (db + 60) / 60));
  dom.valLevel.textContent = isFinite(db) ? db.toFixed(1) : '-∞';
  dom.valLevel.className   = 'metric-value ' + (db > -6 ? 'red' : db > -18 ? 'amber' : 'green');

  if (data.clipping) {
    const pk = data.clipping.peakDb;
    if (pk > peakDbHold) { peakDbHold = pk; peakHoldFrames = 90; }
    else if (peakHoldFrames-- <= 0) peakDbHold -= 0.04;
    dom.valPeak.textContent = isFinite(peakDbHold) ? peakDbHold.toFixed(1) : '-∞';
  }
  dom.meterLevel.style.width = (levelNorm * 100) + '%';
  dom.meterLevel.className   = 'level-bar ' + (levelNorm > 0.9 ? 'danger' : levelNorm > 0.7 ? 'warn' : '');

  // ---- Pitch ----
  if (data.pitch) {
    const f = data.pitch.frequency, n = data.pitch.note;
    dom.valFreq.textContent       = f > 0 ? f.toFixed(1) : '--';
    dom.valNote.textContent       = n.name !== '--' ? n.name : '--';
    dom.valNoteDetail.textContent = n.cents !== 0 && f > 0 ? `${n.cents > 0 ? '+' : ''}${n.cents}¢` : '';
  }

  // ---- BPM ----
  if (data.onset) {
    dom.valBpm.textContent     = data.onset.bpm > 0 ? data.onset.bpm : '--';
    dom.valBpmConf.textContent = data.onset.bpm > 0
      ? `${Math.round(data.onset.confidence * 100)}% conf`
      : 'tracking...';
  }

  // ---- Key ----
  if (data.chroma) {
    dom.valKey.textContent     = data.chroma.key;
    dom.valKeyMode.textContent = data.chroma.mode;
    const keyIdx = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].indexOf(data.chroma.key);
    data.chroma.chroma.forEach((val, i) => {
      if (dom.chromaBars[i]) {
        dom.chromaBars[i].style.height     = (val * 100) + '%';
        dom.chromaBars[i].style.background = i === keyIdx ? 'var(--green)' : 'var(--purple)';
      }
    });
  }

  // ---- LUFS ----
  if (data.lufs) {
    const { momentary, shortTerm, integrated, lra } = data.lufs;
    dom.lufsM.textContent   = isFinite(momentary)   ? momentary.toFixed(1)  : '-∞';
    dom.lufsS.textContent   = isFinite(shortTerm)   ? shortTerm.toFixed(1)  : '-∞';
    dom.lufsI.textContent   = isFinite(integrated)  ? integrated.toFixed(1) : '-∞';
    dom.lufsLra.textContent = lra > 0 ? lra.toFixed(1) + ' LU' : '--';
    const lufsN = l => Math.max(0, Math.min(1, (l + 50) / 50));
    dom.barLufsM.style.width = (lufsN(momentary)  * 100) + '%';
    dom.barLufsS.style.width = (lufsN(shortTerm)  * 100) + '%';
    dom.barLufsI.style.width = (lufsN(integrated) * 100) + '%';

    // LUFS history ring buffer — add every 2 frames
    if (frameSkip++ % 2 === 0 && isFinite(momentary)) {
      lufsHistory.push(momentary);
      if (lufsHistory.length > LUFS_HIST_MAX) lufsHistory.shift();
      drawLufsHistory();
    }
  }

  // ---- True Peak ----
  if (data.truePeak) {
    const tp = data.truePeak.truePeakHold;
    dom.truePeakVal.textContent = (isFinite(tp) ? tp.toFixed(1) : '-∞') + ' dBTP';
    dom.truePeakVal.className   = 'diag-cell-value' + (data.truePeak.isOver ? ' text-red' : '');
    setLed(dom.ledTpInline, data.truePeak.isOver ? 'red' : '');
    setLed(dom.ledTp,       data.truePeak.isOver ? 'red' : '');
    setPill(dom.pillTp,     data.truePeak.isOver ? 'danger' : '');
  }

  // ---- Dynamics ----
  if (data.dynamics) {
    dom.crestVal.textContent = data.dynamics.crestFactor.toFixed(1) + ' dB';
    dom.drVal.textContent    = data.dynamics.dynamicRange.toFixed(1) + ' dB';
    dom.comprVal.textContent = (data.dynamics.compressionAmount * 100).toFixed(0) + '%';
  }

  // ---- EQ Profile ----
  if (data.rta) {
    const bands = data.rta.bands;
    const avg = (a, b) => {
      const s = bands.filter(x => x.center >= a && x.center <= b);
      return s.length ? s.reduce((acc, x) => acc + x.normalized, 0) / s.length : 0;
    };
    dom.barLow.style.height  = (avg(20,   300)  * 100) + '%';
    dom.barMid.style.height  = (avg(300,  4000) * 100) + '%';
    dom.barHigh.style.height = (avg(4000, 20000)* 100) + '%';
  }

  // ---- Spectral Features ----
  if (data.spectral) {
    const { centroid, flatness, rolloff, bandwidth } = data.spectral;
    dom.centroidVal.textContent  = centroid  > 0 ? (centroid  / 1000).toFixed(2) + ' kHz' : '--';
    dom.flatnessVal.textContent  = (flatness * 100).toFixed(1) + '%';
    dom.rolloffVal.textContent   = rolloff   > 0 ? (rolloff   / 1000).toFixed(2) + ' kHz' : '--';
    dom.bandwidthVal.textContent = bandwidth > 0 ? (bandwidth / 1000).toFixed(2) + ' kHz' : '--';
  }

  // ---- MFCC ----
  if (data.mfcc) {
    const coeffs = data.mfcc.mfcc;
    const maxAbs  = Math.max(...coeffs.map(Math.abs), 1);
    dom.mfccBars.forEach((bar, i) => {
      if (i >= coeffs.length) return;
      const norm = coeffs[i] / maxAbs;
      const h    = Math.abs(norm) * 50;
      bar.style.height     = h + '%';
      bar.style.top        = norm > 0 ? (50 - h) + '%' : '50%';
      bar.style.background = `hsl(${Math.round((i / 13) * 200 + 160)}, 80%, 55%)`;
    });
  }

  // ---- THD ----
  if (data.thd) {
    dom.thdVal.textContent = data.thd.thdString;
    dom.thdVal.className   = 'metric-value ' + (data.thd.thd > 5 ? 'red' : data.thd.thd > 1 ? 'amber' : '');
    dom.harmonicBars.forEach((bar, i) => {
      if (i < data.thd.harmonics.length) {
        bar.style.height = (Math.max(0, Math.min(1, (data.thd.harmonics[i].db + 80) / 60)) * 100) + '%';
      }
    });
  }

  // ---- SNR ----
  if (data.snr) {
    dom.snrVal.textContent    = data.snr.calibrating ? 'CALIB...' : data.snr.snrString;
    dom.noiseFloor.textContent = data.snr.noiseFloor != null ? data.snr.noiseFloor.toFixed(1) + ' dB' : '--';
  }

  // ---- ZCR ----
  if (data.zcr) {
    dom.zcrVal.textContent  = (data.zcr.zcr / 1000).toFixed(1) + ' kHz';
    dom.zcrType.textContent = data.zcr.type;
  }

  // ---- DC Offset ----
  if (data.dcOffset) {
    dom.dcVal.textContent      = (data.dcOffset.dcOffset * 1000).toFixed(2) + ' mV';
    dom.dcSeverity.textContent = data.dcOffset.severity.toUpperCase();
    dom.dcSeverity.className   = 'metric-value ' + (data.dcOffset.severity === 'critical' ? 'red' : data.dcOffset.severity === 'warning' ? 'amber' : '');
    setAlert(dom.alertDc, data.dcOffset.hasIssue, 'amber');
    if (data.dcOffset.hasIssue) addEvent('dc', `DC offset: ${(data.dcOffset.dcOffset * 1000).toFixed(2)} mV (${data.dcOffset.severity})`);
  }

  // ---- Phase ----
  if (data.phase) {
    dom.phaseNeedle.style.left = ((data.phase.correlation + 1) / 2 * 100) + '%';
    dom.phaseStr.textContent   = data.phase.phaseString;
    dom.phaseCorr.textContent  = data.phase.correlation.toFixed(2);
  }

  // ---- RT60 ----
  if (data.rt60) dom.rt60Val.textContent = data.rt60.rt60String;

  // ---- Clipping ----
  if (data.clipping) {
    const c = data.clipping.clipLedActive;
    setLed(dom.ledClip, c ? 'red blink' : '');
    setPill(dom.pillClip, c ? 'danger' : '');
    setAlert(dom.alertClip, c, 'red');
    if (data.clipping.isClipping) addEvent('clip', `Clip at ${data.clipping.peakDb.toFixed(1)} dBFS`);
  }

  // ---- Feedback ----
  if (data.feedback) {
    const f = data.feedback.isFeedbackRisk;
    setLed(dom.ledFdbk, f ? 'amber' : '');
    setPill(dom.pillFdbk, f ? 'warn' : '');
    setAlert(dom.alertFdbk, f, 'amber');
    if (f && data.feedback.notchSuggestion) {
      const ns = data.feedback.notchSuggestion;
      dom.alertFdbkFreq.textContent = ns.frequency.toFixed(1) + ' Hz';
      dom.alertFdbkNote.textContent = ns.note.name || '--';
      addEvent('feedback', `Feedback ring @ ${ns.frequency.toFixed(1)} Hz (${ns.note.name})`);
    }
  }

  // ---- Standing Waves ----
  if (data.standingWaves && dom.modesContainer) {
    const modes = data.standingWaves.modes;
    dom.modesContainer.innerHTML = '';
    if (!modes.length) {
      dom.modesContainer.innerHTML = '<div class="font-mono" style="font-size:10px;padding:4px;color:var(--text-dim)">No room modes detected</div>';
    } else {
      modes.forEach((mode, i) => {
        const div = document.createElement('div');
        div.className = `mode-item ${i === 0 ? 'critical' : 'warning'}`;
        div.innerHTML = `<span class="mode-freq">${mode.freq.toFixed(0)} Hz</span><span class="mode-db">${mode.db.toFixed(1)} dB</span>`;
        dom.modesContainer.appendChild(div);
      });
    }
  }

  // ---- Session Stats (sidebar) ----
  const ss = ordo.session;
  const fmt = s => { const m = Math.floor(s/60); return `${m}:${String(Math.floor(s%60)).padStart(2,'0')}`; };
  dom.statDur.textContent     = fmt(ss.durationSeconds);
  dom.statPeak.textContent    = isFinite(ss.peakDbfs) ? ss.peakDbfs.toFixed(1) + ' dB' : '--';
  dom.statLufsAvg.textContent = isFinite(ss.averageLufs) ? ss.averageLufs.toFixed(1) + ' L' : '--';
  dom.statClips.textContent   = ss.totalClipEvents;

  // ---- Metric Logger ----
  if (isLogging && data.dynamics && data.lufs) {
    const entry = {
      ts:         ((Date.now() - logStartTime) / 1000).toFixed(1),
      rmsDb:      data.dynamics.rmsDb.toFixed(2),
      peakDb:     data.clipping ? data.clipping.peakDb.toFixed(2) : '',
      lufsM:      isFinite(data.lufs.momentary) ? data.lufs.momentary.toFixed(2) : '',
      lufsS:      isFinite(data.lufs.shortTerm) ? data.lufs.shortTerm.toFixed(2) : '',
      lufsI:      isFinite(data.lufs.integrated)? data.lufs.integrated.toFixed(2): '',
      lra:        data.lufs.lra.toFixed(2),
      thd:        data.thd ? data.thd.thd.toFixed(2) : '',
      snr:        data.snr && !data.snr.calibrating ? data.snr.snr.toFixed(1) : '',
      pitch:      data.pitch && data.pitch.frequency > 0 ? data.pitch.frequency.toFixed(1) : '',
      note:       data.pitch ? data.pitch.note.name : '',
      bpm:        data.onset ? data.onset.bpm : '',
      key:        data.chroma ? data.chroma.keyString : '',
      crestFactor: data.dynamics.crestFactor.toFixed(2),
      clipping:   data.clipping && data.clipping.isClipping ? '1' : '0',
      feedback:   data.feedback && data.feedback.isFeedbackRisk ? '1' : '0',
    };
    // Sub-sample: only log ~1 entry per second
    if (!metricLog.length || parseFloat(entry.ts) - parseFloat(metricLog[metricLog.length-1].ts) >= 1.0) {
      metricLog.push(entry);
      dom.logCount.textContent = metricLog.length;
    }
  }

  // ---- Draw canvases ----
  if (data.rta) drawRta(data.rta);
  drawOscilloscope(data.raw.timeData);
  updateSpectrogram(data.raw.freqData, data.sampleRate, data.fftSize);
}

// ============================================================================
// HELPERS
// ============================================================================

function setLed(el, state)    { if (el) el.className = 'led ' + (state || ''); }
function setPill(el, state)   { if (el) el.className = 'status-pill ' + (state || ''); }
function setAlert(el, on, t)  { if (el) el.className = 'alert-box ' + (on ? `active-${t}` : ''); }

function showError(msg) {
  dom.errorMsg.textContent = msg;
  dom.errorModal.classList.add('open');
}

// Add to event log (deduplicate within 2s)
const lastEventTimes = {};
function addEvent(type, msg) {
  const now = Date.now();
  if (lastEventTimes[type] && now - lastEventTimes[type] < 2000) return;
  lastEventTimes[type] = now;

  const elapsed = isActive ? ((now - (logStartTime || now)) / 1000).toFixed(1) : '0.0';
  eventLog.push({ ts: elapsed, type, msg, wallTime: new Date().toTimeString().slice(0,8) });
  if (eventLog.length > 200) eventLog.shift();

  dom.eventCount.textContent = eventLog.length;
  renderEventLog();
}

function renderEventLog() {
  dom.eventLogBox.innerHTML = '';
  const entries = eventLog.slice(-30).reverse();
  entries.forEach(e => {
    const div = document.createElement('div');
    div.className = `log-entry ${e.type}`;
    div.innerHTML = `<span class="log-time">${e.wallTime}</span><span class="log-type">[${e.type.toUpperCase()}]</span><span class="log-msg">${e.msg}</span>`;
    dom.eventLogBox.appendChild(div);
  });
}

// ============================================================================
// ENGINE CONTROL
// ============================================================================

async function startEngine() {
  try {
    dom.powerBtnText.textContent = 'STARTING';
    dom.powerBtn.disabled = true;

    ordo.use(...OrdoAudio.modules);
    await ordo.init('microphone');

    ordo.on('frame', updateUI);
    ordo.on('error', err => { showError('Engine error: ' + err.message); stopEngine(); });

    ordo.start();
    isActive      = true;
    lufsHistory   = [];
    peakDbHold    = -Infinity;
    peakHoldFrames = 0;
    rtaPeakHold   = new Float32Array(31).fill(0);
    rtaPeakHoldFrames = new Float32Array(31).fill(0);

    dom.powerBtn.classList.add('active');
    dom.powerBtnText.textContent = 'STOP';
    dom.powerBtn.disabled = false;
    dom.standbyOverlay.classList.add('hidden');

    setLed(dom.ledStatus, 'green');
    setPill(dom.pillStatus, 'active');
    dom.pillStatusLabel.textContent = 'LIVE';

    addEvent('info', 'Engine started');
    setTimeout(initCanvases, 80);

  } catch (err) {
    dom.powerBtn.disabled = false;
    dom.powerBtnText.textContent = 'INIT ENG';
    const msg =
      err.name === 'NotAllowedError' ? 'Microphone permission denied. Please allow access and retry.' :
      err.name === 'NotFoundError'   ? 'No microphone found. Please connect one and retry.' :
      'Could not initialize audio engine: ' + err.message;
    showError(msg);
  }
}

function stopEngine() {
  if (isRecording) stopRecording();
  if (isLogging)   stopLogging();
  stopTestTone();

  ordo.destroy();
  isActive = false;

  dom.powerBtn.classList.remove('active');
  dom.powerBtnText.textContent = 'INIT ENG';
  dom.standbyOverlay.classList.remove('hidden');

  setLed(dom.ledStatus, ''); setLed(dom.ledClip, ''); setLed(dom.ledFdbk, '');
  setLed(dom.ledTp, ''); setLed(dom.ledTpInline, '');
  setPill(dom.pillStatus, ''); setPill(dom.pillClip, '');
  setPill(dom.pillFdbk, ''); setPill(dom.pillTp, '');
  dom.pillStatusLabel.textContent = 'STANDBY';

  // Clear canvases
  [dom.rtaCanvas, dom.oscCanvas, dom.spectCanvas].forEach(c => {
    const ctx = c.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, c.width, c.height);
  });
  lufsHistory = [];
  if (lufsHistCtx) lufsHistCtx.clearRect(0, 0, logW(dom.lufsHistCanvas), logH(dom.lufsHistCanvas));

  // Reset displays
  dom.valLevel.textContent = '-∞';
  dom.valFreq.textContent  = '--'; dom.valNote.textContent = '--';
  dom.valBpm.textContent   = '--'; dom.valKey.textContent  = '--';

  addEvent('info', 'Engine stopped');
}

// ============================================================================
// AUDIO RECORDING
// ============================================================================

async function startRecording() {
  if (!isActive) { showError('Start the engine first before recording.'); return; }
  if (!ordo.stream) { showError('No audio stream available.'); return; }

  recordedChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  try {
    mediaRecorder = new MediaRecorder(ordo.stream, { mimeType });
  } catch (e) {
    try { mediaRecorder = new MediaRecorder(ordo.stream); }
    catch (e2) { showError('MediaRecorder not supported in this browser.'); return; }
  }

  mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => downloadRecording();

  mediaRecorder.start(100); // 100ms timeslice
  isRecording  = true;
  recStartTime = Date.now();

  dom.sessionRecBtn.classList.add('recording');
  dom.sessionRecIcon.textContent  = '⏹';
  dom.sessionRecLabel.textContent = 'Stop Recording';
  dom.sessionRecStatus.textContent = 'Recording...';
  setLed(dom.ledRec, 'red blink');
  setPill(dom.pillRec, 'rec');

  recTimerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - recStartTime) / 1000);
    const m = Math.floor(s / 60);
    dom.recTimer.textContent = `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
    dom.sessionRecStatus.textContent = `Recording — ${dom.recTimer.textContent}`;
  }, 500);

  addEvent('info', 'Audio recording started');
}

function stopRecording() {
  if (!mediaRecorder || !isRecording) return;
  mediaRecorder.stop();
  isRecording = false;
  clearInterval(recTimerInterval);

  dom.sessionRecBtn.classList.remove('recording');
  dom.sessionRecIcon.textContent  = '⏺';
  dom.sessionRecLabel.textContent = 'Start Recording';
  dom.sessionRecStatus.textContent = 'Saving...';
  setLed(dom.ledRec, '');
  setPill(dom.pillRec, '');
  dom.recTimer.textContent = 'REC';
  addEvent('info', 'Recording saved');
}

function downloadRecording() {
  const blob = new Blob(recordedChunks, { type: 'audio/webm' });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  triggerDownload(URL.createObjectURL(blob), `acoustic-field-pro_${ts}.webm`);
  dom.sessionRecStatus.textContent = `Saved — ${(blob.size / 1024).toFixed(0)} KB`;
}

// ============================================================================
// METRIC LOGGER
// ============================================================================

function startLogging() {
  metricLog    = [];
  isLogging    = true;
  logStartTime = Date.now();
  dom.logToggleBtn.textContent = 'STOP LOG';
  dom.logToggleBtn.classList.add('active');
  dom.logCount.textContent = '0';
  addEvent('info', 'Metric logging started');
}

function stopLogging() {
  isLogging = false;
  dom.logToggleBtn.textContent = 'START LOG';
  dom.logToggleBtn.classList.remove('active');
  addEvent('info', `Metric logging stopped (${metricLog.length} entries)`);
}

// ============================================================================
// EXPORT: CSV
// ============================================================================

function exportCsv() {
  if (!metricLog.length) { alert('No metric data logged yet. Start logging first.'); return; }
  const keys = Object.keys(metricLog[0]);
  const rows = [
    keys.join(','),
    ...metricLog.map(r => keys.map(k => r[k]).join(','))
  ];
  const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  triggerDownload('data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n')), `acoustic-field-pro_${ts}.csv`);
  addEvent('info', `CSV exported (${metricLog.length} rows)`);
}

// ============================================================================
// EXPORT: HTML REPORT
// ============================================================================

function exportHtmlReport() {
  const ss = ordo.session.toObject();
  const fmt  = v => isFinite(v) ? v.toFixed(1) : '--';
  const fmt2 = v => isFinite(v) ? v.toFixed(2) : '--';
  const fmtDur = s => { const m=Math.floor(s/60); return `${m}m ${Math.floor(s%60)}s`; };

  const rtaBandSnapshot = (rtaPeakHold && dom.rtaCanvas)
    ? (() => {
        try { return dom.rtaCanvas.toDataURL('image/png'); }
        catch { return ''; }
      })()
    : '';

  const eventRows = eventLog.map(e =>
    `<tr><td>${e.wallTime}</td><td class="${e.type}">${e.type.toUpperCase()}</td><td>${e.msg}</td></tr>`
  ).join('');

  const metricRows = metricLog.slice(-50).map(r =>
    `<tr>${Object.values(r).map(v=>`<td>${v}</td>`).join('')}</tr>`
  ).join('');

  const metricHeaders = metricLog.length
    ? Object.keys(metricLog[0]).map(k=>`<th>${k}</th>`).join('')
    : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Acoustic Field Pro — Session Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#080c10;color:#c8d6e5;font-family:'Courier New',monospace;font-size:12px;padding:24px}
  h1{font-family:Georgia,serif;font-size:22px;color:#00ff88;margin-bottom:4px;letter-spacing:2px}
  h2{font-size:13px;color:#00aaff;margin:24px 0 10px;text-transform:uppercase;letter-spacing:2px;border-bottom:1px solid #1a2a35;padding-bottom:6px}
  .meta{color:#3a5060;font-size:11px;margin-bottom:24px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:8px}
  .stat{background:#0d1117;border:1px solid #1a2a35;border-radius:6px;padding:12px}
  .stat-label{font-size:10px;color:#3a5060;text-transform:uppercase;letter-spacing:1px}
  .stat-value{font-size:20px;font-weight:700;color:#ddeeff;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#0d1117;color:#3a5060;padding:5px 8px;text-align:left;font-size:10px;text-transform:uppercase;border-bottom:1px solid #1a2a35}
  td{padding:4px 8px;border-bottom:1px solid #111820;color:#8aa0b8}
  tr:hover td{background:#0d1117}
  .clip{color:#ff3b3b} .feedback{color:#ffb300} .dc{color:#ffb300} .info{color:#00ff88}
  .rta-img{width:100%;max-height:200px;object-fit:contain;background:#0d1117;border-radius:6px;border:1px solid #1a2a35}
  .footer{margin-top:32px;color:#1a2a35;font-size:10px;border-top:1px solid #1a2a35;padding-top:12px}
</style></head>
<body>
<h1>Acoustic Field Pro</h1>
<div class="meta">Session Report — Generated ${new Date().toLocaleString()} · OrdoAudio DSP Engine v2.0</div>

<h2>Session Summary</h2>
<div class="stats">
  <div class="stat"><div class="stat-label">Duration</div><div class="stat-value">${fmtDur(ss.durationSeconds)}</div></div>
  <div class="stat"><div class="stat-label">Peak dBFS</div><div class="stat-value">${fmt(ss.peakDbfs)}</div></div>
  <div class="stat"><div class="stat-label">True Peak</div><div class="stat-value">${fmt(ss.truePeakDbtp)} dBTP</div></div>
  <div class="stat"><div class="stat-label">Avg LUFS</div><div class="stat-value">${fmt(ss.averageLufs)}</div></div>
  <div class="stat"><div class="stat-label">Clip Events</div><div class="stat-value">${ss.totalClipEvents}</div></div>
  <div class="stat"><div class="stat-label">Feedback Events</div><div class="stat-value">${ss.totalFeedbackEvents}</div></div>
  <div class="stat"><div class="stat-label">Est. Key</div><div class="stat-value">${ss.dominantKey || '--'}</div></div>
  <div class="stat"><div class="stat-label">Est. BPM</div><div class="stat-value">${ss.dominantBpm || '--'}</div></div>
</div>

${rtaBandSnapshot ? `<h2>RTA Snapshot</h2><img class="rta-img" src="${rtaBandSnapshot}" alt="RTA">` : ''}

<h2>Event Log (${eventLog.length} events)</h2>
<table><thead><tr><th>Time</th><th>Type</th><th>Detail</th></tr></thead>
<tbody>${eventRows || '<tr><td colspan="3">No events recorded</td></tr>'}</tbody></table>

${metricLog.length ? `<h2>Metric Log — Last 50 Entries of ${metricLog.length} total</h2>
<div style="overflow-x:auto"><table><thead><tr>${metricHeaders}</tr></thead><tbody>${metricRows}</tbody></table></div>` : ''}

<div class="footer">Acoustic Field Pro · Fully client-side · No data sent to any server · OrdoAudio.js v2.0</div>
</body></html>`;

  const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  triggerDownload('data:text/html;charset=utf-8,' + encodeURIComponent(html), `acoustic-field-pro-report_${ts}.html`);
  addEvent('info', 'HTML report exported');
}

// ============================================================================
// EXPORT: RTA PNG SNAPSHOT
// ============================================================================

function exportRtaSnapshot() {
  if (!rtaCtx) { alert('RTA not active.'); return; }
  dom.rtaCanvas.toBlob(blob => {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    triggerDownload(URL.createObjectURL(blob), `rta-snapshot_${ts}.png`);
    addEvent('info', 'RTA snapshot exported');
  }, 'image/png');
}

// ============================================================================
// DOWNLOAD HELPER
// ============================================================================

function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); if (href.startsWith('blob:')) URL.revokeObjectURL(href); }, 1000);
}

// ============================================================================
// TEST TONE GENERATOR
// ============================================================================

function startTestTone(type, freqHz, gainDb) {
  stopTestTone();
  if (!isActive || !ordo.audioContext) {
    alert('Start the engine first to use the test tone generator.');
    return;
  }
  const ctx = ordo.audioContext;
  toneGain = ctx.createGain();
  toneGain.gain.value = Math.pow(10, gainDb / 20);
  toneGain.connect(ordo.analyser);

  if (type === 'sine') {
    toneOscillator = ctx.createOscillator();
    toneOscillator.type = 'sine';
    toneOscillator.frequency.value = freqHz;
    toneOscillator.connect(toneGain);
    toneOscillator.start();
  } else if (type === 'white' || type === 'pink') {
    const bufferSize  = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data        = noiseBuffer.getChannelData(0);

    if (type === 'white') {
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    } else {
      // Pink noise via Voss-McCartney algorithm
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < bufferSize; i++) {
        const w = Math.random() * 2 - 1;
        b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759; b2=0.96900*b2+w*0.1538520;
        b3=0.86650*b3+w*0.3104856; b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
        data[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11;
        b6=w*0.115926;
      }
    }

    toneNoiseNode = ctx.createBufferSource();
    toneNoiseNode.buffer  = noiseBuffer;
    toneNoiseNode.loop    = true;
    toneNoiseNode.connect(toneGain);
    toneNoiseNode.start();
  }
  activeToneType = type;
  addEvent('info', `Test tone: ${type}${type === 'sine' ? ` @ ${freqHz} Hz` : ''}`);
}

function stopTestTone() {
  if (toneOscillator)  { try { toneOscillator.stop(); } catch(e){} toneOscillator = null; }
  if (toneNoiseNode)   { try { toneNoiseNode.stop(); }  catch(e){} toneNoiseNode  = null; }
  if (toneGain)        { try { toneGain.disconnect(); } catch(e){} toneGain       = null; }
  activeToneType = 'off';
}

// ============================================================================
// RTA FREQUENCY CURSOR (hover tooltip)
// ============================================================================

const ISO_CENTERS = [20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];

dom.rtaCanvas.addEventListener('mousemove', e => {
  const rect = dom.rtaCanvas.getBoundingClientRect();
  const x    = e.clientX - rect.left;
  const w    = rect.width;
  const gap  = 2, nb = ISO_CENTERS.length;
  const barW = Math.max(2, (w - nb * gap) / nb);
  const idx  = Math.floor(x / (barW + gap));

  if (idx >= 0 && idx < nb && rtaPeakHold) {
    const band   = ISO_CENTERS[idx];
    const dbVal  = (rtaPeakHold[idx] * 100 - 100).toFixed(1);
    const fStr   = band >= 1000 ? (band / 1000).toFixed(band >= 10000 ? 0 : 1) + ' kHz' : band + ' Hz';
    dom.rtaTooltip.textContent = `${fStr}  /  ${dbVal} dB`;
    dom.rtaTooltip.classList.add('visible');
  }
});

dom.rtaCanvas.addEventListener('mouseleave', () => {
  dom.rtaTooltip.classList.remove('visible');
});

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Power
dom.powerBtn.addEventListener('click', () => isActive ? stopEngine() : startEngine());

// Error dismiss
dom.errorDismiss.addEventListener('click', () => dom.errorModal.classList.remove('open'));

// Tabs
dom.tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    dom.tabBtns.forEach(b => b.classList.remove('active'));
    dom.tabContents.forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const t = document.getElementById('tab-' + btn.dataset.tab);
    if (t) t.classList.add('active');
  });
});

// Recording
dom.sessionRecBtn.addEventListener('click', () => isRecording ? stopRecording() : startRecording());

// Metric logger
dom.logToggleBtn.addEventListener('click', () => isLogging ? stopLogging() : startLogging());
dom.logResetBtn.addEventListener('click', () => {
  metricLog = [];
  dom.logCount.textContent = '0';
});

// Exports
dom.exportCsvBtn.addEventListener('click',    exportCsv);
dom.exportReportBtn.addEventListener('click', exportHtmlReport);
dom.exportRtaBtn.addEventListener('click',    exportRtaSnapshot);

// A-weighting toggle button in RTA header
dom.rtaAweightBtn.addEventListener('click', () => {
  const en = !ordo.options.useAWeighting;
  ordo.setAWeighting(en);
  dom.rtaAweightBtn.classList.toggle('active', en);
  dom.rtaAweightBtn.textContent = en ? 'A-WT ✓' : 'A-WT';
  // Sync tools tab buttons
  dom.awBtns.forEach(b => b.classList.toggle('active', b.dataset.aw === String(en)));
});

// RTA PNG snapshot
dom.rtaSnapshotBtn.addEventListener('click', exportRtaSnapshot);

// Window function buttons (in RTA header AND tools tab — both use data-win)
document.querySelectorAll('[data-win]').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.win;
    ordo.setWindow(type);
    // Mark all win-btn elements matching this type as active
    document.querySelectorAll('[data-win]').forEach(b => {
      b.classList.toggle('active', b.dataset.win === type);
    });
    // Update description
    const descs = {
      hann:        'Hann — best balance of frequency resolution and sidelobe rejection.',
      blackman:    'Blackman — lower sidelobes (-58 dB), slightly wider main lobe.',
      flattop:     'Flat-Top — best amplitude accuracy for THD and level calibration.',
      rectangular: 'Rectangular — maximum frequency resolution, high spectral leakage.',
    };
    if (dom.winDescription) dom.winDescription.textContent = descs[type] || '';
  });
});

// A-weighting buttons in tools tab
dom.awBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const en = btn.dataset.aw === 'true';
    ordo.setAWeighting(en);
    dom.awBtns.forEach(b => b.classList.toggle('active', b.dataset.aw === String(en)));
    // Sync RTA header button
    dom.rtaAweightBtn.classList.toggle('active', en);
    dom.rtaAweightBtn.textContent = en ? 'A-WT ✓' : 'A-WT';
  });
});

// Test tone buttons
dom.toneBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.tone;
    dom.toneBtns.forEach(b => b.classList.toggle('active', b.dataset.tone === type));

    if (type === 'off') {
      stopTestTone();
      dom.toneControls.style.opacity      = '0.4';
      dom.toneControls.style.pointerEvents = 'none';
    } else {
      const freq = parseFloat(dom.toneFreqSlider.value);
      const vol  = parseFloat(dom.toneVolSlider.value);
      startTestTone(type, freq, vol);
      dom.toneControls.style.opacity      = '1';
      dom.toneControls.style.pointerEvents = 'auto';
    }
  });
});

// Tone frequency slider
dom.toneFreqSlider.addEventListener('input', () => {
  const f = parseInt(dom.toneFreqSlider.value);
  dom.toneFreqDisplay.textContent = f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : f + ' Hz';
  if (activeToneType === 'sine' && toneOscillator) {
    toneOscillator.frequency.value = f;
  }
});

// Tone volume slider
dom.toneVolSlider.addEventListener('input', () => {
  const db = parseFloat(dom.toneVolSlider.value);
  dom.toneVolDisplay.textContent = db + ' dB';
  if (toneGain) toneGain.gain.value = Math.pow(10, db / 20);
});

// ============================================================================
// INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(initCanvases);
});
