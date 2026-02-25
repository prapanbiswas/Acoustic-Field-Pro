# Acoustic Field Pro

**Professional Browser-Based Audio Analyzer powered by OrdoAudio.js**

A fully client-side, real-time audio analysis application for audio engineers, sound designers, acoustic consultants, and music producers. Zero backend. Zero dependencies. Instant analysis, directly in the browser.

---

## 🚀 Getting Started

1. **Open `index.html`** in a modern browser (Chrome, Firefox, Safari, Edge)
2. Click **INIT ENG** to start the engine
3. Grant microphone permission when prompted
4. All 19 DSP analysis modules begin running instantly

> **No server required.** Simply open the HTML file. Everything runs client-side via the Web Audio API.

---

## 📁 Project Structure

```
acoustic-field-pro/
│
├── index.html              # Main application UI
├── style.css               # Professional stylesheet (Phosphor monitor aesthetic)
├── app.js                  # UI controller — wires OrdoAudio to the interface
├── README.md               # This file
│
└── ordo-audio-lib/
    ├── ordo-audio.js       # The OrdoAudio analysis library (zero dependencies)
    └── README.md           # Library documentation & API reference
```

---

## 🎛️ What's Analyzed (19 DSP Modules)

| Module | What It Measures | Use Case |
|--------|-----------------|----------|
| **RTA** | 31-band 1/3 octave spectrum | EQ decisions, room tuning |
| **Spectral** | Centroid, flatness, rolloff, bandwidth | Tonal character analysis |
| **LUFS** | Momentary / Short-Term / Integrated + LRA | Broadcast loudness compliance |
| **True Peak** | Inter-sample peak (4× oversampled) | Clip prevention on DAC conversion |
| **Dynamics** | RMS, peak, crest factor, DR, compression estimate | Mix dynamics check |
| **Pitch (YIN)** | Accurate fundamental Hz + musical note | Tuning, vocal pitch tracking |
| **Chromagram** | 12-class pitch energy + key/mode estimation | Key detection, chord awareness |
| **MFCC** | 13 Mel-Frequency Cepstral Coefficients | Timbre fingerprinting |
| **Onset / BPM** | Spectral flux onset detection + tempo | Beat tracking, rhythmic analysis |
| **THD** | Total Harmonic Distortion (H2–H8) | Amp/mic/speaker quality testing |
| **SNR** | Signal-to-Noise Ratio estimation | Equipment noise floor assessment |
| **ZCR** | Zero Crossing Rate + signal type | Tonal vs. noisy content classification |
| **DC Offset** | DC bias detection + severity | Ground loop / electrical issue detection |
| **Clipping** | Over-ceiling detection with event count | Gain staging, disaster prevention |
| **Feedback** | Frequency pinpointing + notch suggestion | Live sound reinforcement |
| **Phase** | Phase correlation meter (stereo) | Mono compatibility check |
| **RT60** | Reverberation time estimation | Room acoustic measurement |
| **Inharmonicity** | Harmonic deviation from ideal series | Piano/string instrument tuning |
| **Standing Waves** | Room mode detection 20–300 Hz | Room treatment, bass management |

---

## 🖥️ UI Overview

### Header
- **INIT ENG** button — Start/stop the analysis engine
- **LED indicators** — CLIP (red), FDBK (amber), TP (true peak over), LIVE (green = active)

### Main Panel
- **RTA** — 31-band real-time analyzer with color-coded frequency ranges (blue=bass, green=mid, purple=treble)
- **Oscilloscope** — Phosphor-style waveform display
- **Spectrogram** — Scrolling waterfall frequency-time heatmap

### Metric Cards (Top Row)
- RMS level with peak hold + bar meter
- YIN pitch detection with note name and cents deviation
- Real-time BPM with confidence
- Estimated musical key and mode

### Sidebar Tabs
| Tab | Contents |
|-----|----------|
| **Loudness** | LUFS (M/S/I), LRA, True Peak, Crest Factor, Dynamic Range, Energy Distribution |
| **Spectral** | Centroid, Flatness, Rolloff, Bandwidth, THD harmonics, MFCC bars |
| **Chroma** | 12-note chromagram, Phase correlation meter, RT60 |
| **Diag** | SNR, ZCR, DC Offset, Room Mode list |

### Live Alerts
- Clipping detected (pulsing red)
- Feedback risk with suggested notch frequency
- DC offset warning

---

## 🔧 Performance Notes

- **fftSize: 4096** — High frequency resolution. Adjust in `app.js` if needed.
- **19 modules active** — All run per-frame. Disable unused modules via `ordo.use(...)` for lower CPU usage.
- **60 fps target** — Canvas rendering is hardware-accelerated; analysis is synchronous on main thread.
- The **MFCC** and **YIN pitch** modules are the most CPU-intensive. They can be disabled without affecting other modules.

---

## 🌐 Browser Requirements

| Browser | Minimum Version |
|---------|----------------|
| Chrome | 66+ |
| Firefox | 76+ |
| Safari | 14.1+ |
| Edge | 79+ |

Requires: `getUserMedia`, `AudioContext`, `AnalyserNode`

> **HTTPS or localhost required** for microphone access. Most browsers block `getUserMedia` on plain HTTP.

---

## 📖 Library Documentation

See `ordo-audio-lib/README.md` for the complete OrdoAudio API reference, including:
- All module data structures
- Static utility functions
- Custom event subscriptions
- How to use with file inputs or WebRTC streams
- Performance optimization tips
- Algorithm references & papers

---

## 🎨 Design

The UI follows an **Industrial Phosphor Monitor** aesthetic:
- **Orbitron** — Display font for headings and values
- **Rajdhani** — UI labels and descriptions  
- **Share Tech Mono** — All technical readouts and monospace data
- **Phosphor green** `#00ff88` — Primary accent, live data
- Dark high-contrast background with subtle CRT scan-line texture

---

## 📜 License

MIT License — Free for personal and commercial use.

Built with the Web Audio API. No third-party libraries required.
