# OrdoAudio.js — Professional Client-Side Audio Analysis Library

**Version 1.0.0 · Zero Dependencies · MIT License**

OrdoAudio is a comprehensive, zero-dependency JavaScript library for real-time professional audio analysis in the browser. It implements 19 DSP modules covering every major measurement an audio engineer or sound professional needs — all running instantly client-side via the Web Audio API.

---

## Quick Start

```html
<script src="ordo-audio-lib/ordo-audio.js"></script>
```

```javascript
const ordo = new OrdoAudio({ fftSize: 4096 });

// Initialize microphone capture
await ordo.init('microphone');

// Subscribe to per-frame analysis results
ordo.on('frame', (data) => {
  console.log('LUFS:', data.lufs.momentary);
  console.log('Pitch:', data.pitch.note.name);
  console.log('BPM:', data.onset.bpm);
});

// Special event listeners
ordo.on('clip',     (data) => alert('Clipping detected!'));
ordo.on('onset',    (data) => console.log('Beat hit!'));
ordo.on('feedback', (data) => console.log('Feedback risk at', data.ringingFrequency, 'Hz'));

// Start analysis loop
ordo.start();

// Stop and release resources
ordo.destroy();
```

---

## Constructor Options

```javascript
const ordo = new OrdoAudio({
  fftSize:               4096,  // FFT size (power of 2). Higher = better freq resolution.
  smoothingTimeConstant: 0.8,   // 0-1. Higher = smoother, slower response.
  minDecibels:           -100,  // Lower dB bound for the analyser
  maxDecibels:           0,     // Upper dB bound for the analyser
  sampleRate:            null,  // Force a sample rate (null = use device default)
});
```

---

## Initialization Sources

```javascript
// Microphone
await ordo.init('microphone');

// Existing MediaStream (e.g., from WebRTC)
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
await ordo.init(stream);

// Pre-loaded AudioBuffer (offline / file analysis)
const response = await fetch('audio.wav');
const arrayBuffer = await response.arrayBuffer();
const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
await ordo.init(audioBuffer);
```

---

## Module System

By default all 19 modules are active. For performance, enable only what you need:

```javascript
// Enable only specific modules
ordo.use('rta', 'lufs', 'clipping', 'pitch');

// Or enable/disable individually
ordo.enable('mfcc');
ordo.disable('rt60', 'inharmonicity');
```

### Available Modules

| Module Name      | Description |
|-----------------|-------------|
| `rta`           | 31-band 1/3 octave Real-Time Analyzer (ISO standard centers) |
| `spectral`      | Spectral centroid, flatness, rolloff, bandwidth |
| `lufs`          | Momentary / Short-Term / Integrated LUFS + LRA (ITU-R BS.1770 / EBU R128) |
| `truePeak`      | True inter-sample peak detection (4× oversampled, dBTP) |
| `dynamics`      | RMS, peak, crest factor, dynamic range, compression estimate |
| `pitch`         | YIN algorithm — accurate fundamental frequency + musical note |
| `chroma`        | 12-class chromagram + key/scale detection (Krumhansl-Schmuckler) |
| `mfcc`          | 13 Mel-Frequency Cepstral Coefficients (timbre fingerprint) |
| `onset`         | Spectral flux onset detection + real-time BPM tracking |
| `thd`           | Total Harmonic Distortion (harmonics 2–8, % and dB) |
| `snr`           | Signal-to-Noise Ratio estimation with auto noise floor calibration |
| `zcr`           | Zero Crossing Rate + signal type classification |
| `dcOffset`      | DC bias detection with severity level |
| `clipping`      | Clipping / over-ceiling detection with hold time and event counter |
| `feedback`      | Feedback frequency pinpointing + notch filter suggestion |
| `phase`         | Phase correlation meter / mono compatibility (stereo-ready) |
| `rt60`          | RT60 reverberation time estimation |
| `inharmonicity` | Harmonic deviation from ideal series (tuning/distortion indicator) |
| `standingWaves` | Room mode / standing wave detection in 20–300 Hz range |

---

## Frame Data Reference

Every `frame` event delivers a rich data object:

```javascript
ordo.on('frame', (data) => {
  // --- Raw data ---
  data.raw.timeData   // Float32Array — waveform samples
  data.raw.freqData   // Float32Array — FFT bins in dBFS
  data.raw.binHz      // Hz per FFT bin

  // --- RTA (31 bands) ---
  data.rta.bands[n].center      // Band center frequency (Hz)
  data.rta.bands[n].db          // Band level (dBFS)
  data.rta.bands[n].normalized  // 0–1 for visualization

  // --- Spectral ---
  data.spectral.centroid     // Hz — spectral brightness
  data.spectral.flatness     // 0=pure tone → 1=white noise
  data.spectral.rolloff      // Hz — 85% energy point
  data.spectral.bandwidth    // Hz — spread around centroid

  // --- LUFS ---
  data.lufs.momentary   // dBFS (400ms window)
  data.lufs.shortTerm   // dBFS (3s window)
  data.lufs.integrated  // dBFS (full session, gated)
  data.lufs.lra         // LU — loudness range

  // --- True Peak ---
  data.truePeak.truePeak      // dBTP current
  data.truePeak.truePeakHold  // dBTP all-time session max
  data.truePeak.isOver        // boolean — exceeds -1.0 dBTP

  // --- Dynamics ---
  data.dynamics.rmsDb           // current RMS in dBFS
  data.dynamics.peakDb          // current peak in dBFS
  data.dynamics.crestFactor     // dB — peak vs RMS
  data.dynamics.dynamicRange    // dB — overall DR score
  data.dynamics.compressionAmount // 0–1 estimate

  // --- Pitch (YIN) ---
  data.pitch.frequency    // Hz — fundamental (0 if undetected)
  data.pitch.confidence   // 0–1
  data.pitch.note.name    // e.g. "A4"
  data.pitch.note.note    // e.g. "A"
  data.pitch.note.octave  // e.g. 4
  data.pitch.note.cents   // cents deviation from equal temperament

  // --- Chroma / Key ---
  data.chroma.chroma      // Float32Array[12] — energy per pitch class
  data.chroma.key         // e.g. "G"
  data.chroma.mode        // "major" | "minor"
  data.chroma.keyString   // e.g. "G minor"
  data.chroma.confidence  // 0–1

  // --- MFCC ---
  data.mfcc.mfcc          // number[13] — cepstral coefficients

  // --- Onset / BPM ---
  data.onset.isOnset   // boolean — true on detected beat/transient
  data.onset.bpm       // integer BPM estimate
  data.onset.flux      // raw spectral flux value

  // --- THD ---
  data.thd.thd           // % total harmonic distortion
  data.thd.thdString     // e.g. "0.83%"
  data.thd.harmonics     // array of {n, freq, power, db}

  // --- SNR ---
  data.snr.snr           // dB signal-to-noise ratio
  data.snr.calibrating   // true during first ~1 second
  data.snr.noiseFloor    // dB estimated noise floor

  // --- ZCR ---
  data.zcr.zcr    // crossings/second
  data.zcr.type   // "tonal" | "mixed" | "noisy"

  // --- DC Offset ---
  data.dcOffset.dcOffset   // linear value (ideal: 0)
  data.dcOffset.hasIssue   // boolean
  data.dcOffset.severity   // "ok" | "warning" | "critical"

  // --- Clipping ---
  data.clipping.peakDb           // current peak dBFS
  data.clipping.isClipping       // boolean
  data.clipping.clipLedActive    // boolean (with hold time)
  data.clipping.totalClipEvents  // running count

  // --- Feedback ---
  data.feedback.isFeedbackRisk      // boolean
  data.feedback.ringingFrequency    // Hz
  data.feedback.notchSuggestion     // { frequency, note, suggestedCut }

  // --- Phase ---
  data.phase.correlation    // -1 to 1
  data.phase.monoCompatible // boolean
  data.phase.phaseString    // "Mono-ish" | "Wide" | "Out-of-Phase!"

  // --- RT60 ---
  data.rt60.rt60       // seconds (null until measured)
  data.rt60.rt60String // human-readable string

  // --- Inharmonicity ---
  data.inharmonicity.inharmonicity      // average % deviation
  data.inharmonicity.inharmonicityScore // "Very Clean" | "Normal" | "Stretched" | "High"
  data.inharmonicity.harmonicsFound     // array of detected harmonics

  // --- Standing Waves ---
  data.standingWaves.modes     // array of { freq, db } resonance peaks
  data.standingWaves.detected  // boolean
  data.standingWaves.worstMode // { freq, db } or null
});
```

---

## Special Events

| Event      | Triggered When |
|-----------|---------------|
| `ready`   | Engine initialized successfully |
| `error`   | Initialization or permission failure |
| `frame`   | Every animation frame (~60fps) |
| `clip`    | A clipping event is detected |
| `onset`   | A beat / transient is detected |
| `feedback`| Feedback risk threshold exceeded |

---

## Static Utilities

```javascript
// Convert Hz to musical note info
OrdoAudio.hzToNote(440)
// → { note: 'A', octave: 4, cents: 0, midi: 69, name: 'A4' }

// Convert linear amplitude to dBFS
OrdoAudio.linToDb(0.5)  // → -6.02

// Convert dBFS to linear
OrdoAudio.dbToLin(-6)   // → 0.501

// Convert Hz to Mel scale
OrdoAudio.hzToMel(1000) // → 999.98

// List all module names
OrdoAudio.modules
// → ['rta', 'spectral', 'lufs', ...]

// Library version
OrdoAudio.version // → '1.0.0'

// Analyze an offline AudioBuffer
const result = OrdoAudio.analyzeBuffer(audioBuffer);
```

---

## Performance Tips

- Use `ordo.use(...)` to enable only the modules you need
- For best pitch detection, use `fftSize: 4096` or higher
- For LUFS compliance, do not use smoothing (`smoothingTimeConstant: 0`)
- The MFCC module is moderately CPU-intensive; disable if not needed
- `rt60`, `inharmonicity`, and `standingWaves` use historical buffering — they stabilize over the first few seconds

---

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome 66+ | ✅ Full |
| Firefox 76+ | ✅ Full |
| Safari 14.1+ | ✅ Full (webkit prefix handled) |
| Edge 79+ | ✅ Full |

Requires: `getUserMedia`, `AudioContext`, `AnalyserNode`, `requestAnimationFrame`

---

## Algorithm References

- **YIN Pitch**: De Cheveigné & Kawahara (2002), "YIN, a fundamental frequency estimator for speech and music"
- **LUFS / K-weighting**: ITU-R BS.1770-4, EBU R128
- **Chromagram / Key**: Krumhansl-Schmuckler key-finding algorithm
- **MFCC**: Davis & Mermelstein (1980), standard mel filterbank implementation
- **BPM**: Spectral flux onset detection with inter-onset interval averaging
- **THD**: IEC 61672 harmonic power ratio method

---

## License

MIT License — Copyright (c) 2024 Acoustic Field Pro / OrdoAudio Contributors

