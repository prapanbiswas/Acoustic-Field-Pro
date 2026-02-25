/**
 * ============================================================================
 * OrdoAudio.js — Professional Client-Side Audio Analysis Library
 * Version: 1.0.0
 * License: MIT
 * ============================================================================
 *
 * A zero-dependency, modular audio analysis library for the browser.
 * Implements professional-grade DSP algorithms used by audio engineers.
 *
 * Features: RTA, Spectrogram, LUFS, True Peak, YIN Pitch, Chromagram,
 *           Key Detection, MFCC, BPM, RT60, THD, SNR, ZCR, Phase, DC Offset,
 *           Spectral Centroid, Flatness, Rolloff, Dynamic Range, Feedback,
 *           Clipping, Onset Detection, Standing Waves, Inharmonicity and more.
 *
 * Usage:
 *   const ordo = new OrdoAudio({ fftSize: 4096 });
 *   await ordo.init('microphone');
 *   ordo.on('frame', (data) => console.log(data));
 *   ordo.start();
 * ============================================================================
 */

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? (module.exports = factory())
    : typeof define === 'function' && define.amd
    ? define(factory)
    : (global.OrdoAudio = factory());
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ============================================================================
  // CONSTANTS
  // ============================================================================

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  const ISO_THIRD_OCTAVE_CENTERS = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
  ];

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  /**
   * Convert linear amplitude to dBFS
   * @param {number} linear
   * @returns {number}
   */
  function linToDb(linear) {
    return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
  }

  /**
   * Convert dB to linear amplitude
   * @param {number} db
   * @returns {number}
   */
  function dbToLin(db) {
    return Math.pow(10, db / 20);
  }

  /**
   * Clamp a value between min and max
   */
  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  /**
   * Compute mean of array
   */
  function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Compute variance of array
   */
  function variance(arr) {
    const m = mean(arr);
    return arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length;
  }

  /**
   * Apply a circular buffer push
   */
  function circularPush(arr, val, maxLen) {
    arr.push(val);
    if (arr.length > maxLen) arr.shift();
  }

  /**
   * Discrete Cosine Transform (Type II) for MFCC
   * @param {Float32Array} input
   * @returns {Float32Array}
   */
  function dct(input) {
    const N = input.length;
    const output = new Float32Array(N);
    const scale = Math.PI / N;
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) {
        sum += input[n] * Math.cos(scale * (n + 0.5) * k);
      }
      output[k] = sum;
    }
    return output;
  }

  /**
   * Convert Hz to Mel scale
   */
  function hzToMel(hz) {
    return 2595 * Math.log10(1 + hz / 700);
  }

  /**
   * Convert Mel to Hz
   */
  function melToHz(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1);
  }

  /**
   * Convert Hz to musical note name
   * @param {number} freq - Frequency in Hz
   * @returns {{ note: string, octave: number, cents: number }}
   */
  function hzToNote(freq) {
    if (freq < 20 || !isFinite(freq)) return { note: '--', octave: 0, cents: 0, midi: 0 };
    const midi = 12 * Math.log2(freq / 440) + 69;
    const midiRounded = Math.round(midi);
    const cents = Math.round((midi - midiRounded) * 100);
    const octave = Math.floor(midiRounded / 12) - 1;
    const note = NOTE_NAMES[((midiRounded % 12) + 12) % 12];
    return { note, octave, cents, midi: midiRounded, name: `${note}${octave}` };
  }

  /**
   * Pearson correlation between two arrays
   */
  function correlate(a, b) {
    const ma = mean(a);
    const mb = mean(b);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += Math.pow(a[i] - ma, 2);
      db += Math.pow(b[i] - mb, 2);
    }
    const denom = Math.sqrt(da * db);
    return denom === 0 ? 0 : num / denom;
  }

  // ============================================================================
  // DSP MODULES
  // ============================================================================

  /**
   * Module: Real-Time Analyzer (1/3 Octave ISO Standard)
   */
  const RtaModule = {
    name: 'rta',
    /**
     * Compute 31-band 1/3 octave RTA from frequency data
     * @param {Float32Array} freqData - FFT magnitude data in dB
     * @param {number} sampleRate
     * @param {number} fftSize
     * @returns {{ bands: Array<{center: number, db: number, normalized: number}> }}
     */
    process(freqData, sampleRate, fftSize) {
      const binHz = sampleRate / fftSize;
      const bands = ISO_THIRD_OCTAVE_CENTERS.map((center) => {
        const low = center / Math.pow(2, 1 / 6);
        const high = center * Math.pow(2, 1 / 6);
        const binLow = Math.max(0, Math.floor(low / binHz));
        const binHigh = Math.min(freqData.length - 1, Math.ceil(high / binHz));

        let energySum = 0;
        let count = 0;
        for (let i = binLow; i <= binHigh; i++) {
          // freqData is in dB; convert to linear power, average, convert back
          const lin = Math.pow(10, freqData[i] / 10);
          energySum += lin;
          count++;
        }
        const avgDb = count > 0 ? 10 * Math.log10(energySum / count) : -100;
        return {
          center,
          db: avgDb,
          normalized: clamp((avgDb + 100) / 100, 0, 1),
        };
      });
      return { bands };
    },
  };

  /**
   * Module: Spectral Features (Centroid, Flatness, Rolloff)
   */
  const SpectralFeaturesModule = {
    name: 'spectral',
    /**
     * @param {Float32Array} freqData - FFT in dB (from analyser)
     * @param {number} sampleRate
     * @param {number} fftSize
     */
    process(freqData, sampleRate, fftSize) {
      const binHz = sampleRate / fftSize;
      const N = freqData.length;

      // Convert dB to linear magnitudes
      const mags = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        mags[i] = Math.pow(10, freqData[i] / 20);
      }

      let totalEnergy = 0;
      let weightedFreqSum = 0;
      let geometricMeanLog = 0;
      let cumulativeEnergy = 0;

      for (let i = 1; i < N; i++) {
        const freq = i * binHz;
        const mag = mags[i];
        const power = mag * mag;
        totalEnergy += power;
        weightedFreqSum += freq * power;
        geometricMeanLog += Math.log(Math.max(1e-10, power));
      }

      // Spectral Centroid (Hz)
      const centroid = totalEnergy > 0 ? weightedFreqSum / totalEnergy : 0;

      // Spectral Flatness (Wiener Entropy) - ratio of geometric to arithmetic mean of power
      const geometricMean = Math.exp(geometricMeanLog / (N - 1));
      const arithmeticMean = totalEnergy / (N - 1);
      const flatness = arithmeticMean > 0 ? clamp(geometricMean / arithmeticMean, 0, 1) : 0;

      // Spectral Rolloff (85% energy threshold)
      const threshold = 0.85 * totalEnergy;
      let rolloffHz = 0;
      cumulativeEnergy = 0;
      for (let i = 1; i < N; i++) {
        cumulativeEnergy += mags[i] * mags[i];
        if (cumulativeEnergy >= threshold) {
          rolloffHz = i * binHz;
          break;
        }
      }

      // Spectral Bandwidth (spread around centroid)
      let bandwidthSum = 0;
      for (let i = 1; i < N; i++) {
        const freq = i * binHz;
        bandwidthSum += Math.pow(freq - centroid, 2) * mags[i] * mags[i];
      }
      const bandwidth = totalEnergy > 0 ? Math.sqrt(bandwidthSum / totalEnergy) : 0;

      return {
        centroid,        // Hz - "brightness" indicator
        flatness,        // 0=pure tone, 1=white noise
        rolloff: rolloffHz, // Hz
        bandwidth,       // Hz
        totalEnergy,
      };
    },
  };

  /**
   * Module: LUFS Loudness (ITU-R BS.1770 / EBU R128)
   * Implements K-weighting filter and gated measurement
   */
  const LufsModule = {
    name: 'lufs',

    /**
     * Create K-weighting biquad filter coefficients
     * Stage 1: High-frequency shelf (pre-filter)
     * Stage 2: High-pass filter (RLB weighting)
     */
    createKWeightingFilters(sampleRate) {
      const db = 3.99984385397; // shelf gain in dB
      const Vh = Math.pow(10, db / 20);
      const Vb = Math.pow(Vh, 0.4845);
      const f0 = 1681.974450955533;
      const Q = 0.7071752369554196;
      const K = Math.tan((Math.PI * f0) / sampleRate);

      // Pre-filter (high shelf)
      const a0_pre = 1 + K / Q + K * K;
      const preFilter = {
        b0: (Vh + Vb * K / Q + K * K) / a0_pre,
        b1: (2 * (K * K - Vh)) / a0_pre,
        b2: (Vh - Vb * K / Q + K * K) / a0_pre,
        a1: (2 * (K * K - 1)) / a0_pre,
        a2: (1 - K / Q + K * K) / a0_pre,
        x1: 0, x2: 0, y1: 0, y2: 0,
      };

      // High-pass filter (f0=38.13547087613982Hz, Q=0.5003270373238773)
      const f0_hp = 38.13547087613982;
      const Q_hp = 0.5003270373238773;
      const K_hp = Math.tan((Math.PI * f0_hp) / sampleRate);
      const a0_hp = 1 + K_hp / Q_hp + K_hp * K_hp;
      const hpFilter = {
        b0: 1 / a0_hp,
        b1: -2 / a0_hp,
        b2: 1 / a0_hp,
        a1: (2 * (K_hp * K_hp - 1)) / a0_hp,
        a2: (1 - K_hp / Q_hp + K_hp * K_hp) / a0_hp,
        x1: 0, x2: 0, y1: 0, y2: 0,
      };

      return { preFilter, hpFilter };
    },

    /**
     * Apply biquad filter to a single sample
     */
    applyBiquad(filter, x) {
      const y =
        filter.b0 * x +
        filter.b1 * filter.x1 +
        filter.b2 * filter.x2 -
        filter.a1 * filter.y1 -
        filter.a2 * filter.y2;
      filter.x2 = filter.x1;
      filter.x1 = x;
      filter.y2 = filter.y1;
      filter.y1 = y;
      return y;
    },

    /**
     * Process a block of time-domain samples and return LUFS metrics
     * @param {Float32Array} timeData
     * @param {object} state - persistent state across frames
     * @param {number} sampleRate
     */
    process(timeData, state, sampleRate) {
      if (!state.filters) {
        state.filters = this.createKWeightingFilters(sampleRate);
        state.momentaryBuffer = []; // 400ms blocks
        state.shortTermBuffer = []; // 3s blocks
        state.integratedBlocks = [];
        state.blockSamples = Math.round(0.1 * sampleRate); // 100ms overlap blocks
        state.sampleAccum = 0;
        state.meanSquareAccum = 0;
        state.integratedLufs = -Infinity;
      }

      const { preFilter, hpFilter } = state.filters;
      let blockMeanSquare = 0;

      for (let i = 0; i < timeData.length; i++) {
        let s = this.applyBiquad(preFilter, timeData[i]);
        s = this.applyBiquad(hpFilter, s);
        blockMeanSquare += s * s;
      }
      blockMeanSquare /= timeData.length;

      // Momentary LUFS (400ms window = 4 overlapping 100ms blocks)
      circularPush(state.momentaryBuffer, blockMeanSquare, 4);
      const momentaryMs = mean(state.momentaryBuffer);
      const momentaryLufs = momentaryMs > 0 ? -0.691 + 10 * Math.log10(momentaryMs) : -Infinity;

      // Short-Term LUFS (3s window = 30 overlapping 100ms blocks)
      circularPush(state.shortTermBuffer, blockMeanSquare, 30);
      const shortTermMs = mean(state.shortTermBuffer);
      const shortTermLufs = shortTermMs > 0 ? -0.691 + 10 * Math.log10(shortTermMs) : -Infinity;

      // Integrated LUFS (gated: absolute gate -70 LUFS, relative gate -10 LU)
      if (momentaryLufs > -70) {
        state.integratedBlocks.push(blockMeanSquare);
      }
      if (state.integratedBlocks.length > 0) {
        const ungated = mean(state.integratedBlocks);
        const ungatedLufs = -0.691 + 10 * Math.log10(ungated);
        const relGate = ungatedLufs - 10;
        const gated = state.integratedBlocks.filter(
          (ms) => ms > 0 && -0.691 + 10 * Math.log10(ms) > relGate
        );
        if (gated.length > 0) {
          const gatedMs = mean(gated);
          state.integratedLufs = -0.691 + 10 * Math.log10(gatedMs);
        }
      }

      // Loudness Range (LRA) - standard deviation of short-term values (simplified)
      const lraBlocks = state.shortTermBuffer
        .filter((ms) => ms > 0)
        .map((ms) => -0.691 + 10 * Math.log10(ms))
        .filter((l) => l > -70);

      let lra = 0;
      if (lraBlocks.length > 1) {
        const sorted = [...lraBlocks].sort((a, b) => a - b);
        const low = sorted[Math.floor(sorted.length * 0.1)];
        const high = sorted[Math.floor(sorted.length * 0.95)];
        lra = high - low;
      }

      return {
        momentary: isFinite(momentaryLufs) ? momentaryLufs : -Infinity,
        shortTerm: isFinite(shortTermLufs) ? shortTermLufs : -Infinity,
        integrated: isFinite(state.integratedLufs) ? state.integratedLufs : -Infinity,
        lra,
      };
    },
  };

  /**
   * Module: True Peak Detection (inter-sample peak via 4x oversampling)
   */
  const TruePeakModule = {
    name: 'truePeak',
    _oversample(timeData) {
      // 4x linear interpolation oversampling (simplified, production uses sinc)
      const out = new Float32Array(timeData.length * 4);
      for (let i = 0; i < timeData.length - 1; i++) {
        out[i * 4] = timeData[i];
        out[i * 4 + 1] = timeData[i] * 0.75 + timeData[i + 1] * 0.25;
        out[i * 4 + 2] = timeData[i] * 0.5 + timeData[i + 1] * 0.5;
        out[i * 4 + 3] = timeData[i] * 0.25 + timeData[i + 1] * 0.75;
      }
      return out;
    },

    process(timeData, state) {
      if (!state.truePeakHold) state.truePeakHold = -Infinity;
      const oversampled = this._oversample(timeData);
      let maxSample = 0;
      for (let i = 0; i < oversampled.length; i++) {
        const abs = Math.abs(oversampled[i]);
        if (abs > maxSample) maxSample = abs;
      }
      const truePeakDb = linToDb(maxSample);
      if (truePeakDb > state.truePeakHold) {
        state.truePeakHold = truePeakDb;
      }
      return {
        truePeak: truePeakDb,     // current true peak dBTP
        truePeakHold: state.truePeakHold, // all-time max
        isOver: truePeakDb > -1.0, // EBU R128 max
      };
    },
  };

  /**
   * Module: Dynamic Range & Crest Factor
   */
  const DynamicsModule = {
    name: 'dynamics',
    process(timeData, state) {
      if (!state.rmsHistory) state.rmsHistory = [];
      if (!state.peakHistory) state.peakHistory = [];

      let sumSquares = 0;
      let peak = 0;
      for (let i = 0; i < timeData.length; i++) {
        const abs = Math.abs(timeData[i]);
        sumSquares += timeData[i] * timeData[i];
        if (abs > peak) peak = abs;
      }
      const rms = Math.sqrt(sumSquares / timeData.length);
      const rmsDb = linToDb(rms);
      const peakDb = linToDb(peak);
      const crestFactor = rms > 0 ? peakDb - rmsDb : 0;

      circularPush(state.rmsHistory, rmsDb, 300);  // ~10s at 30fps
      circularPush(state.peakHistory, peakDb, 300);

      const drScore = state.rmsHistory.length > 10
        ? state.peakHistory.reduce((a, b) => a + b, 0) / state.peakHistory.length -
          state.rmsHistory.reduce((a, b) => a + b, 0) / state.rmsHistory.length
        : 0;

      return {
        rmsDb,
        peakDb,
        crestFactor: Math.abs(crestFactor),
        dynamicRange: Math.abs(drScore),
        compressionAmount: clamp(1 - (Math.abs(drScore) / 20), 0, 1), // 0=no compression
      };
    },
  };

  /**
   * Module: YIN Algorithm — Accurate Pitch Detection
   * Reference: De Cheveigné & Kawahara (2002)
   */
  const PitchModule = {
    name: 'pitch',

    /**
     * YIN pitch detection
     * @param {Float32Array} timeData
     * @param {number} sampleRate
     * @param {number} threshold - confidence threshold (0.15 recommended)
     * @returns {{ frequency: number, confidence: number, note: object }}
     */
    process(timeData, sampleRate, threshold = 0.15) {
      const bufferSize = timeData.length;
      const halfBuffer = Math.floor(bufferSize / 2);

      // Step 1: Difference function
      const diff = new Float32Array(halfBuffer);
      for (let tau = 0; tau < halfBuffer; tau++) {
        for (let j = 0; j < halfBuffer; j++) {
          const delta = timeData[j] - timeData[j + tau];
          diff[tau] += delta * delta;
        }
      }

      // Step 2: Cumulative mean normalized difference function (CMNDF)
      const cmndf = new Float32Array(halfBuffer);
      cmndf[0] = 1;
      let runningSum = 0;
      for (let tau = 1; tau < halfBuffer; tau++) {
        runningSum += diff[tau];
        cmndf[tau] = diff[tau] / ((1 / tau) * runningSum);
      }

      // Step 3: Absolute threshold search — find first minimum below threshold
      let tauEstimate = -1;
      for (let tau = 2; tau < halfBuffer; tau++) {
        if (cmndf[tau] < threshold) {
          while (tau + 1 < halfBuffer && cmndf[tau + 1] < cmndf[tau]) {
            tau++;
          }
          tauEstimate = tau;
          break;
        }
      }

      // Fallback: pick global minimum
      if (tauEstimate === -1) {
        let minVal = Infinity;
        for (let tau = 2; tau < halfBuffer; tau++) {
          if (cmndf[tau] < minVal) {
            minVal = cmndf[tau];
            tauEstimate = tau;
          }
        }
      }

      // Step 4: Parabolic interpolation for sub-sample accuracy
      let betterTau = tauEstimate;
      if (tauEstimate > 0 && tauEstimate < halfBuffer - 1) {
        const s0 = cmndf[tauEstimate - 1];
        const s1 = cmndf[tauEstimate];
        const s2 = cmndf[tauEstimate + 1];
        betterTau = tauEstimate + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
      }

      const frequency = betterTau > 0 ? sampleRate / betterTau : 0;
      const confidence = tauEstimate > 0 ? clamp(1 - cmndf[tauEstimate], 0, 1) : 0;

      return {
        frequency: confidence > 0.5 ? frequency : 0,
        rawFrequency: frequency,
        confidence,
        note: hzToNote(frequency),
      };
    },
  };

  /**
   * Module: Chromagram & Key/Scale Estimation
   * Maps spectrum energy onto 12 pitch classes
   */
  const ChromagramModule = {
    name: 'chroma',
    process(freqData, sampleRate, fftSize) {
      const binHz = sampleRate / fftSize;
      const chroma = new Float32Array(12);

      for (let i = 1; i < freqData.length; i++) {
        const freq = i * binHz;
        if (freq < 20 || freq > 20000) continue;
        const energy = Math.pow(10, freqData[i] / 10);
        const midi = 12 * Math.log2(freq / 440) + 69;
        const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
        chroma[pitchClass] += energy;
      }

      // Normalize
      const maxEnergy = Math.max(...chroma);
      if (maxEnergy > 0) {
        for (let i = 0; i < 12; i++) chroma[i] /= maxEnergy;
      }

      // Key estimation using Krumhansl-Schmuckler algorithm
      let bestKey = 0, bestMode = 'major', bestCorr = -Infinity;
      for (let root = 0; root < 12; root++) {
        const rotated = [...chroma.slice(root), ...chroma.slice(0, root)];
        const majorCorr = correlate(rotated, MAJOR_PROFILE);
        const minorCorr = correlate(rotated, MINOR_PROFILE);
        if (majorCorr > bestCorr) {
          bestCorr = majorCorr;
          bestKey = root;
          bestMode = 'major';
        }
        if (minorCorr > bestCorr) {
          bestCorr = minorCorr;
          bestKey = root;
          bestMode = 'minor';
        }
      }

      return {
        chroma: Array.from(chroma),
        key: NOTE_NAMES[bestKey],
        mode: bestMode,
        keyString: `${NOTE_NAMES[bestKey]} ${bestMode}`,
        confidence: clamp(bestCorr, 0, 1),
      };
    },
  };

  /**
   * Module: MFCC (Mel-Frequency Cepstral Coefficients)
   * Core feature for timbre analysis and voice recognition
   */
  const MfccModule = {
    name: 'mfcc',
    _melFilterbank: null,

    _buildMelFilterbank(sampleRate, fftSize, numFilters = 26, fMin = 20, fMax = 8000) {
      const numBins = fftSize / 2;
      const melMin = hzToMel(fMin);
      const melMax = hzToMel(fMax);
      const melPoints = [];
      for (let i = 0; i <= numFilters + 1; i++) {
        melPoints.push(melToHz(melMin + (i * (melMax - melMin)) / (numFilters + 1)));
      }

      const binPoints = melPoints.map((hz) => Math.floor((fftSize + 1) * hz / sampleRate));

      const filterbank = [];
      for (let m = 1; m <= numFilters; m++) {
        const filter = new Float32Array(numBins);
        for (let k = 0; k < numBins; k++) {
          if (k >= binPoints[m - 1] && k <= binPoints[m]) {
            filter[k] = (k - binPoints[m - 1]) / (binPoints[m] - binPoints[m - 1]);
          } else if (k >= binPoints[m] && k <= binPoints[m + 1]) {
            filter[k] = (binPoints[m + 1] - k) / (binPoints[m + 1] - binPoints[m]);
          }
        }
        filterbank.push(filter);
      }
      return filterbank;
    },

    process(freqData, sampleRate, fftSize, numCoeffs = 13) {
      if (!this._melFilterbank) {
        this._melFilterbank = this._buildMelFilterbank(sampleRate, fftSize);
      }

      // Convert dB to power
      const power = new Float32Array(freqData.length);
      for (let i = 0; i < freqData.length; i++) {
        power[i] = Math.pow(10, freqData[i] / 10);
      }

      // Apply mel filterbank
      const melEnergies = new Float32Array(this._melFilterbank.length);
      for (let m = 0; m < this._melFilterbank.length; m++) {
        let energy = 0;
        for (let k = 0; k < freqData.length; k++) {
          energy += this._melFilterbank[m][k] * power[k];
        }
        melEnergies[m] = Math.log(Math.max(1e-10, energy));
      }

      // Apply DCT to get cepstral coefficients
      const allCoeffs = dct(melEnergies);
      const mfcc = Array.from(allCoeffs.slice(0, numCoeffs));

      return { mfcc, numCoeffs };
    },
  };

  /**
   * Module: Onset / Transient Detection & BPM Estimation
   */
  const OnsetModule = {
    name: 'onset',
    process(freqData, state, sampleRate, fftSize) {
      if (!state.prevFreqData) {
        state.prevFreqData = new Float32Array(freqData.length);
        state.onsetTimes = [];
        state.lastOnsetFrame = 0;
        state.frameCount = 0;
        state.bpmHistory = [];
        state.bpm = 0;
      }

      // Spectral flux — sum of positive differences between frames
      let flux = 0;
      for (let i = 0; i < freqData.length; i++) {
        const diff = freqData[i] - state.prevFreqData[i];
        if (diff > 0) flux += diff;
      }

      state.prevFreqData.set(freqData);
      state.frameCount++;

      // Adaptive threshold: 1.5x local mean flux
      if (!state.fluxHistory) state.fluxHistory = [];
      circularPush(state.fluxHistory, flux, 20);
      const localMean = mean(state.fluxHistory);
      const threshold = localMean * 1.5;
      const minOnsetGap = Math.round(0.25 * sampleRate / fftSize); // 250ms gap

      let isOnset = false;
      if (flux > threshold && state.frameCount - state.lastOnsetFrame > minOnsetGap) {
        isOnset = true;
        state.lastOnsetFrame = state.frameCount;

        const now = Date.now();
        circularPush(state.onsetTimes, now, 16);

        // BPM from inter-onset intervals
        if (state.onsetTimes.length >= 4) {
          const intervals = [];
          for (let i = 1; i < state.onsetTimes.length; i++) {
            intervals.push(state.onsetTimes[i] - state.onsetTimes[i - 1]);
          }
          const avgInterval = mean(intervals);
          if (avgInterval > 200 && avgInterval < 2000) {
            const instantBpm = 60000 / avgInterval;
            circularPush(state.bpmHistory, instantBpm, 8);
            state.bpm = mean(state.bpmHistory);
          }
        }
      }

      return {
        flux,
        isOnset,
        bpm: Math.round(state.bpm),
        bpmRaw: state.bpm,
        confidence: state.onsetTimes.length > 4 ? clamp(1 - variance(state.bpmHistory || []) / 100, 0, 1) : 0,
      };
    },
  };

  /**
   * Module: THD (Total Harmonic Distortion) Analysis
   */
  const ThdModule = {
    name: 'thd',
    process(freqData, sampleRate, fftSize, fundamentalHz) {
      if (!fundamentalHz || fundamentalHz < 20) return { thd: 0, harmonics: [] };

      const binHz = sampleRate / fftSize;
      const getBinPower = (targetHz) => {
        const bin = Math.round(targetHz / binHz);
        if (bin < 0 || bin >= freqData.length) return 0;
        // Sum energy in ±2 bins around harmonic
        let power = 0;
        for (let i = Math.max(0, bin - 2); i <= Math.min(freqData.length - 1, bin + 2); i++) {
          power += Math.pow(10, freqData[i] / 10);
        }
        return power;
      };

      const fundamentalPower = getBinPower(fundamentalHz);
      const harmonics = [];
      let harmonicPowerSum = 0;

      for (let n = 2; n <= 8; n++) {
        const harmonicHz = fundamentalHz * n;
        if (harmonicHz > sampleRate / 2) break;
        const power = getBinPower(harmonicHz);
        harmonicPowerSum += power;
        harmonics.push({
          harmonic: n,
          freq: harmonicHz,
          power,
          db: linToDb(Math.sqrt(power)),
        });
      }

      const thd = fundamentalPower > 0
        ? Math.sqrt(harmonicPowerSum / fundamentalPower) * 100
        : 0;

      return {
        thd: clamp(thd, 0, 100),
        thdString: `${thd.toFixed(2)}%`,
        harmonics,
        fundamentalPower,
      };
    },
  };

  /**
   * Module: SNR Estimation
   */
  const SnrModule = {
    name: 'snr',
    process(freqData, state) {
      if (!state.noiseFloorEstimate) {
        state.noiseFloorEstimate = null;
        state.noiseFrames = [];
        state.calibrating = true;
        state.calibrationFrames = 30; // ~1 second
      }

      // During calibration, capture noise floor
      if (state.calibrating && state.noiseFrames.length < state.calibrationFrames) {
        const avgPower = mean(Array.from(freqData).map((db) => Math.pow(10, db / 10)));
        state.noiseFrames.push(avgPower);
        return { snr: null, calibrating: true, noiseFloor: null };
      }

      if (state.calibrating) {
        state.noiseFloorEstimate = mean(state.noiseFrames);
        state.calibrating = false;
      }

      const signalPower = mean(Array.from(freqData).map((db) => Math.pow(10, db / 10)));
      const noisePower = state.noiseFloorEstimate;
      const snrLinear = noisePower > 0 ? signalPower / noisePower : 1;
      const snrDb = 10 * Math.log10(Math.max(snrLinear, 1));

      return {
        snr: snrDb,
        snrString: `${snrDb.toFixed(1)} dB`,
        calibrating: false,
        noiseFloor: 10 * Math.log10(noisePower),
        signalLevel: 10 * Math.log10(signalPower),
      };
    },
  };

  /**
   * Module: Zero Crossing Rate
   */
  const ZcrModule = {
    name: 'zcr',
    process(timeData, sampleRate) {
      let crossings = 0;
      for (let i = 1; i < timeData.length; i++) {
        if ((timeData[i - 1] >= 0) !== (timeData[i] >= 0)) {
          crossings++;
        }
      }
      const zcr = crossings / (2 * (timeData.length / sampleRate));
      return {
        zcr,
        // High ZCR = noisy/consonant; Low ZCR = tonal/voiced
        type: zcr > 3000 ? 'noisy' : zcr > 1000 ? 'mixed' : 'tonal',
      };
    },
  };

  /**
   * Module: DC Offset Detection
   */
  const DcOffsetModule = {
    name: 'dcOffset',
    process(timeData) {
      const avg = mean(Array.from(timeData));
      return {
        dcOffset: avg,
        dcOffsetDb: linToDb(Math.abs(avg)),
        hasIssue: Math.abs(avg) > 0.005, // Threshold: 0.5%
        severity: Math.abs(avg) > 0.02 ? 'critical' : Math.abs(avg) > 0.005 ? 'warning' : 'ok',
      };
    },
  };

  /**
   * Module: Clipping & Over-ceiling Detection
   */
  const ClippingModule = {
    name: 'clipping',
    process(timeData, state) {
      if (!state.clipHold) state.clipHold = 0;
      if (!state.peakDb) state.peakDb = -Infinity;
      if (!state.clipCount) state.clipCount = 0;

      let maxSample = 0;
      let clippedSamples = 0;

      for (let i = 0; i < timeData.length; i++) {
        const abs = Math.abs(timeData[i]);
        if (abs > maxSample) maxSample = abs;
        if (abs >= 0.9999) clippedSamples++;
      }

      const peakDb = linToDb(maxSample);
      if (peakDb > state.peakDb) state.peakDb = peakDb;

      const isClipping = peakDb > -0.5;
      if (isClipping) {
        state.clipHold = 60;
        state.clipCount++;
      } else if (state.clipHold > 0) {
        state.clipHold--;
      }

      return {
        peakDb,
        allTimePeak: state.peakDb,
        isClipping,
        clipLedActive: state.clipHold > 0,
        clippedSamples,
        clipRatio: clippedSamples / timeData.length,
        totalClipEvents: state.clipCount,
      };
    },
  };

  /**
   * Module: Feedback Detection & Pinpointing
   */
  const FeedbackModule = {
    name: 'feedback',
    process(freqData, sampleRate, fftSize, state) {
      if (!state.freqHistory) {
        state.freqHistory = [];
        state.holdCounter = 0;
        state.ringingFreq = 0;
      }

      const binHz = sampleRate / fftSize;
      let maxDb = -Infinity;
      let dominantBin = 0;

      for (let i = Math.floor(100 / binHz); i < freqData.length; i++) {
        if (freqData[i] > maxDb) {
          maxDb = freqData[i];
          dominantBin = i;
        }
      }

      const dominantHz = dominantBin * binHz;

      if (maxDb > -20 && dominantHz > 250) {
        circularPush(state.freqHistory, dominantHz, 25);
      } else {
        circularPush(state.freqHistory, 0, 25);
      }

      let isFeedback = false;
      let notchSuggestion = null;

      if (state.freqHistory.length >= 25) {
        const nonZero = state.freqHistory.filter((f) => f > 0);
        if (nonZero.length >= 20) {
          const std = Math.sqrt(variance(nonZero));
          if (std < 20) {
            state.holdCounter = 50;
            state.ringingFreq = mean(nonZero);
            const ringingNote = hzToNote(state.ringingFreq);
            notchSuggestion = {
              frequency: state.ringingFreq,
              note: ringingNote,
              bandwidth: '1/3 octave',
              suggestedCut: '-6 to -12 dB',
            };
          }
        }
      }

      if (state.holdCounter > 0) {
        isFeedback = true;
        state.holdCounter--;
      }

      return {
        isFeedbackRisk: isFeedback,
        ringingFrequency: state.ringingFreq,
        notchSuggestion,
        dominantFrequency: dominantHz,
        dominantDb: maxDb,
      };
    },
  };

  /**
   * Module: Phase Correlation (Mono Compatibility)
   */
  const PhaseModule = {
    name: 'phase',
    /**
     * For stereo sources; in mono/mic scenarios returns mid-only data.
     * Expects { left: Float32Array, right: Float32Array } or single channel.
     */
    process(timeData, rightChannel = null) {
      if (!rightChannel) {
        // Mono source — phase correlation is trivially 1.0
        return {
          correlation: 1.0,
          monoCompatible: true,
          phaseString: 'Mono',
          width: 0,
        };
      }

      let dotProduct = 0, leftPower = 0, rightPower = 0;
      for (let i = 0; i < timeData.length; i++) {
        dotProduct += timeData[i] * rightChannel[i];
        leftPower += timeData[i] * timeData[i];
        rightPower += rightChannel[i] * rightChannel[i];
      }

      const denom = Math.sqrt(leftPower * rightPower);
      const correlation = denom > 0 ? dotProduct / denom : 0;
      const width = clamp(1 - correlation, 0, 2);

      return {
        correlation: clamp(correlation, -1, 1),
        monoCompatible: correlation > -0.5,
        phaseString: correlation > 0.8 ? 'Mono-ish' : correlation > 0 ? 'Wide' : 'Out-of-Phase!',
        width,
      };
    },
  };

  /**
   * Module: RT60 Estimation (Reverberation Time)
   * Estimates the time for sound to decay 60dB after silence onset
   */
  const Rt60Module = {
    name: 'rt60',
    process(timeData, sampleRate, state) {
      if (!state.rt60Samples) {
        state.rt60Samples = [];
        state.isDecaying = false;
        state.decayStart = 0;
        state.rt60 = null;
      }

      let rms = 0;
      for (let i = 0; i < timeData.length; i++) rms += timeData[i] * timeData[i];
      rms = Math.sqrt(rms / timeData.length);
      const rmsDb = linToDb(rms);

      state.rt60Samples.push({ db: rmsDb, time: Date.now() });
      if (state.rt60Samples.length > 500) state.rt60Samples.shift();

      // Detect decay: look for rapid drop from loud to quiet
      if (state.rt60Samples.length > 50) {
        const recent = state.rt60Samples.slice(-10);
        const older = state.rt60Samples.slice(-50, -40);
        const recentMean = mean(recent.map((s) => s.db));
        const olderMean = mean(older.map((s) => s.db));

        if (!state.isDecaying && olderMean > -20 && recentMean < olderMean - 15) {
          state.isDecaying = true;
          state.decayStart = olderMean;
          state.decayStartTime = older[0].time;
        }

        if (state.isDecaying && rmsDb < state.decayStart - 60) {
          const decayTime = (Date.now() - state.decayStartTime) / 1000;
          state.rt60 = decayTime;
          state.isDecaying = false;
        }
      }

      return {
        rt60: state.rt60,
        rt60String: state.rt60 ? `${state.rt60.toFixed(2)}s` : 'Measuring...',
        isDecaying: state.isDecaying,
        currentRmsDb: rmsDb,
      };
    },
  };

  /**
   * Module: Inharmonicity Measurement
   * Measures deviation of overtones from ideal harmonic series
   */
  const InharmonicityModule = {
    name: 'inharmonicity',
    process(freqData, sampleRate, fftSize, fundamentalHz) {
      if (!fundamentalHz || fundamentalHz < 20) {
        return { inharmonicity: 0, harmonicsFound: [], inharmonicityScore: 'N/A' };
      }

      const binHz = sampleRate / fftSize;
      const harmonicsFound = [];
      let totalDeviation = 0;
      let count = 0;

      for (let n = 2; n <= 10; n++) {
        const idealHz = fundamentalHz * n;
        if (idealHz > sampleRate / 2) break;

        // Search ±5% around ideal frequency for actual peak
        const searchLow = idealHz * 0.95;
        const searchHigh = idealHz * 1.05;
        const binLow = Math.floor(searchLow / binHz);
        const binHigh = Math.ceil(searchHigh / binHz);

        let maxDb = -Infinity;
        let peakBin = 0;
        for (let b = binLow; b <= binHigh && b < freqData.length; b++) {
          if (freqData[b] > maxDb) {
            maxDb = freqData[b];
            peakBin = b;
          }
        }

        if (maxDb > -60) {
          const actualHz = peakBin * binHz;
          const deviation = ((actualHz - idealHz) / idealHz) * 100;
          totalDeviation += Math.abs(deviation);
          count++;
          harmonicsFound.push({ n, idealHz, actualHz, deviation, db: maxDb });
        }
      }

      const inharmonicity = count > 0 ? totalDeviation / count : 0;
      return {
        inharmonicity,
        harmonicsFound,
        inharmonicityScore: inharmonicity < 0.5 ? 'Very Clean' : inharmonicity < 2 ? 'Normal' : inharmonicity < 5 ? 'Stretched' : 'High',
      };
    },
  };

  /**
   * Module: Standing Wave / Room Mode Detector
   */
  const StandingWaveModule = {
    name: 'standingWaves',
    process(freqData, sampleRate, fftSize, state) {
      if (!state.swHistory) {
        state.swHistory = [];
      }

      // Build frequency magnitude snapshot for low end (20-300Hz)
      const binHz = sampleRate / fftSize;
      const maxBin = Math.ceil(300 / binHz);
      const snapshot = [];

      for (let i = Math.floor(20 / binHz); i <= maxBin && i < freqData.length; i++) {
        snapshot.push({ freq: i * binHz, db: freqData[i] });
      }

      circularPush(state.swHistory, snapshot, 30);

      // Average over time to find sustained peaks (resonances)
      if (state.swHistory.length < 10) return { modes: [], detected: false };

      const avgMags = new Map();
      for (const frame of state.swHistory) {
        for (const { freq, db } of frame) {
          const key = Math.round(freq);
          if (!avgMags.has(key)) avgMags.set(key, []);
          avgMags.get(key).push(db);
        }
      }

      const avgData = [];
      for (const [freq, dbs] of avgMags) {
        avgData.push({ freq, db: mean(dbs) });
      }

      const overallMean = mean(avgData.map((d) => d.db));
      const modes = avgData
        .filter((d) => d.db > overallMean + 8) // 8dB above average = resonance
        .sort((a, b) => b.db - a.db)
        .slice(0, 5);

      return {
        modes,
        detected: modes.length > 0,
        worstMode: modes[0] || null,
      };
    },
  };

  // ============================================================================
  // MAIN OrdoAudio CLASS
  // ============================================================================

  class OrdoAudio {
    constructor(options = {}) {
      this.options = {
        fftSize: options.fftSize || 4096,
        smoothingTimeConstant: options.smoothingTimeConstant || 0.8,
        minDecibels: options.minDecibels || -100,
        maxDecibels: options.maxDecibels || 0,
        sampleRate: options.sampleRate || null, // auto from context
      };

      // Core Web Audio
      this.audioContext = null;
      this.analyser = null;
      this.source = null;
      this.stream = null;

      // Data buffers
      this.timeData = null;
      this.freqData = null;

      // Module states (persistent across frames)
      this._moduleStates = {};

      // Event system
      this._listeners = {};

      // Animation
      this._animFrameId = null;
      this._isRunning = false;
      this._frameCount = 0;

      // Active modules registry
      this._activeModules = new Set([
        'rta', 'spectral', 'lufs', 'truePeak', 'dynamics',
        'pitch', 'chroma', 'mfcc', 'onset', 'thd', 'snr',
        'zcr', 'dcOffset', 'clipping', 'feedback', 'phase',
        'rt60', 'inharmonicity', 'standingWaves'
      ]);

      // Diagnostics
      this.diagnostics = {
        fps: 0,
        lastFrameTime: 0,
        processingTimeMs: 0,
      };
    }

    // ------------------------------------------------------------------
    // MODULE SELECTION
    // ------------------------------------------------------------------

    /**
     * Enable only specific modules (for performance)
     * @param {...string} modules - Module names
     * @returns {OrdoAudio}
     */
    use(...modules) {
      this._activeModules = new Set(modules);
      return this;
    }

    /**
     * Enable additional modules
     * @param {...string} modules
     * @returns {OrdoAudio}
     */
    enable(...modules) {
      modules.forEach((m) => this._activeModules.add(m));
      return this;
    }

    /**
     * Disable specific modules
     * @param {...string} modules
     * @returns {OrdoAudio}
     */
    disable(...modules) {
      modules.forEach((m) => this._activeModules.delete(m));
      return this;
    }

    // ------------------------------------------------------------------
    // EVENT SYSTEM
    // ------------------------------------------------------------------

    /**
     * Subscribe to events
     * @param {string} event - 'frame', 'onset', 'clip', 'feedback', 'ready', 'error'
     * @param {Function} callback
     * @returns {OrdoAudio}
     */
    on(event, callback) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(callback);
      return this;
    }

    /**
     * Unsubscribe from events
     * @param {string} event
     * @param {Function} callback
     * @returns {OrdoAudio}
     */
    off(event, callback) {
      if (this._listeners[event]) {
        this._listeners[event] = this._listeners[event].filter((cb) => cb !== callback);
      }
      return this;
    }

    _emit(event, data) {
      if (this._listeners[event]) {
        this._listeners[event].forEach((cb) => cb(data));
      }
    }

    // ------------------------------------------------------------------
    // INITIALIZATION
    // ------------------------------------------------------------------

    /**
     * Initialize the audio engine
     * @param {'microphone'|MediaStream|AudioBuffer} source
     * @returns {Promise<OrdoAudio>}
     */
    async init(source = 'microphone') {
      try {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: this.options.sampleRate || undefined,
          latencyHint: 'interactive',
        });

        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = this.options.fftSize;
        this.analyser.smoothingTimeConstant = this.options.smoothingTimeConstant;
        this.analyser.minDecibels = this.options.minDecibels;
        this.analyser.maxDecibels = this.options.maxDecibels;

        if (source === 'microphone') {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              autoGainControl: false,
              noiseSuppression: false,
              latency: 0,
            },
          });
          this.source = this.audioContext.createMediaStreamSource(this.stream);
        } else if (source instanceof MediaStream) {
          this.stream = source;
          this.source = this.audioContext.createMediaStreamSource(source);
        } else if (source instanceof AudioBuffer) {
          const bufferSource = this.audioContext.createBufferSource();
          bufferSource.buffer = source;
          this.source = bufferSource;
          bufferSource.start();
        } else {
          throw new Error('Invalid source. Use "microphone", a MediaStream, or an AudioBuffer.');
        }

        this.source.connect(this.analyser);

        // Allocate data buffers
        this.timeData = new Float32Array(this.analyser.fftSize);
        this.freqData = new Float32Array(this.analyser.frequencyBinCount);

        this._emit('ready', {
          sampleRate: this.audioContext.sampleRate,
          fftSize: this.options.fftSize,
          frequencyBinCount: this.analyser.frequencyBinCount,
          activeModules: [...this._activeModules],
        });

        return this;
      } catch (err) {
        this._emit('error', err);
        throw err;
      }
    }

    // ------------------------------------------------------------------
    // PLAYBACK CONTROL
    // ------------------------------------------------------------------

    /**
     * Start real-time analysis loop
     * @returns {OrdoAudio}
     */
    start() {
      if (this._isRunning) return this;
      this._isRunning = true;

      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const loop = () => {
        if (!this._isRunning) return;
        const t0 = performance.now();
        const result = this.processFrame();
        if (result) this._emit('frame', result);
        this.diagnostics.processingTimeMs = performance.now() - t0;

        const now = performance.now();
        const delta = now - this.diagnostics.lastFrameTime;
        this.diagnostics.fps = Math.round(1000 / delta);
        this.diagnostics.lastFrameTime = now;

        this._animFrameId = requestAnimationFrame(loop);
      };

      this._animFrameId = requestAnimationFrame(loop);
      return this;
    }

    /**
     * Stop real-time analysis
     * @returns {OrdoAudio}
     */
    stop() {
      this._isRunning = false;
      if (this._animFrameId) {
        cancelAnimationFrame(this._animFrameId);
        this._animFrameId = null;
      }
      return this;
    }

    /**
     * Stop and release all audio resources
     */
    async destroy() {
      this.stop();
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
      }
      if (this.audioContext) {
        await this.audioContext.close();
      }
      this._listeners = {};
    }

    // ------------------------------------------------------------------
    // CORE PROCESSING
    // ------------------------------------------------------------------

    /**
     * Process one frame of audio data and return all active analysis results.
     * Can be called manually for single-frame analysis.
     * @returns {object} Full analysis result object
     */
    processFrame() {
      if (!this.analyser) return null;

      this.analyser.getFloatTimeDomainData(this.timeData);
      this.analyser.getFloatFrequencyData(this.freqData);

      const sampleRate = this.audioContext.sampleRate;
      const fftSize = this.options.fftSize;
      this._frameCount++;

      const result = {
        frame: this._frameCount,
        timestamp: Date.now(),
        sampleRate,
        fftSize,
        raw: {
          timeData: this.timeData,
          freqData: this.freqData,
          binHz: sampleRate / fftSize,
        },
        diagnostics: { ...this.diagnostics },
      };

      // Run active modules
      const st = this._moduleStates;
      const has = (m) => this._activeModules.has(m);

      if (has('clipping')) {
        if (!st.clipping) st.clipping = {};
        result.clipping = ClippingModule.process(this.timeData, st.clipping);
        if (result.clipping.isClipping) this._emit('clip', result.clipping);
      }

      if (has('dcOffset')) {
        result.dcOffset = DcOffsetModule.process(this.timeData);
      }

      if (has('zcr')) {
        result.zcr = ZcrModule.process(this.timeData, sampleRate);
      }

      if (has('dynamics')) {
        if (!st.dynamics) st.dynamics = {};
        result.dynamics = DynamicsModule.process(this.timeData, st.dynamics);
      }

      if (has('truePeak')) {
        if (!st.truePeak) st.truePeak = {};
        result.truePeak = TruePeakModule.process(this.timeData, st.truePeak);
      }

      if (has('lufs')) {
        if (!st.lufs) st.lufs = {};
        result.lufs = LufsModule.process(this.timeData, st.lufs, sampleRate);
      }

      if (has('rta')) {
        result.rta = RtaModule.process(this.freqData, sampleRate, fftSize);
      }

      if (has('spectral')) {
        result.spectral = SpectralFeaturesModule.process(this.freqData, sampleRate, fftSize);
      }

      if (has('pitch')) {
        result.pitch = PitchModule.process(this.timeData, sampleRate, 0.15);
      }

      if (has('chroma')) {
        result.chroma = ChromagramModule.process(this.freqData, sampleRate, fftSize);
      }

      if (has('mfcc')) {
        result.mfcc = MfccModule.process(this.freqData, sampleRate, fftSize, 13);
      }

      if (has('onset')) {
        if (!st.onset) st.onset = {};
        result.onset = OnsetModule.process(this.freqData, st.onset, sampleRate, fftSize);
        if (result.onset.isOnset) this._emit('onset', result.onset);
      }

      if (has('thd') && result.pitch) {
        result.thd = ThdModule.process(
          this.freqData, sampleRate, fftSize,
          result.pitch.frequency
        );
      }

      if (has('snr')) {
        if (!st.snr) st.snr = {};
        result.snr = SnrModule.process(this.freqData, st.snr);
      }

      if (has('feedback')) {
        if (!st.feedback) st.feedback = {};
        result.feedback = FeedbackModule.process(this.freqData, sampleRate, fftSize, st.feedback);
        if (result.feedback && result.feedback.isFeedbackRisk) this._emit('feedback', result.feedback);
      }

      if (has('phase')) {
        result.phase = PhaseModule.process(this.timeData, null);
      }

      if (has('rt60')) {
        if (!st.rt60) st.rt60 = {};
        result.rt60 = Rt60Module.process(this.timeData, sampleRate, st.rt60);
      }

      if (has('inharmonicity') && result.pitch) {
        result.inharmonicity = InharmonicityModule.process(
          this.freqData, sampleRate, fftSize,
          result.pitch.frequency
        );
      }

      if (has('standingWaves')) {
        if (!st.standingWaves) st.standingWaves = {};
        result.standingWaves = StandingWaveModule.process(this.freqData, sampleRate, fftSize, st.standingWaves);
      }

      return result;
    }

    // ------------------------------------------------------------------
    // STATIC / UTILITY API
    // ------------------------------------------------------------------

    /**
     * Analyze a single AudioBuffer (offline, returns full analysis)
     * @param {AudioBuffer} buffer
     * @returns {object}
     */
    static analyzeBuffer(buffer) {
      const channelData = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;
      const fftSize = 4096;

      // Simple offline analysis for a buffer
      const dynamics = DynamicsModule.process(channelData, {});
      const zcr = ZcrModule.process(channelData, sampleRate);
      const dc = DcOffsetModule.process(channelData);
      const clip = ClippingModule.process(channelData, {});

      return { dynamics, zcr, dcOffset: dc, clipping: clip, sampleRate, duration: buffer.duration };
    }

    /** Helper: Hz to note name */
    static hzToNote(hz) { return hzToNote(hz); }

    /** Helper: linear to dBFS */
    static linToDb(lin) { return linToDb(lin); }

    /** Helper: dBFS to linear */
    static dbToLin(db) { return dbToLin(db); }

    /** Helper: Hz to Mel */
    static hzToMel(hz) { return hzToMel(hz); }

    /** Returns list of all available module names */
    static get modules() {
      return [
        'rta', 'spectral', 'lufs', 'truePeak', 'dynamics', 'pitch',
        'chroma', 'mfcc', 'onset', 'thd', 'snr', 'zcr', 'dcOffset',
        'clipping', 'feedback', 'phase', 'rt60', 'inharmonicity', 'standingWaves'
      ];
    }

    /** Returns library version */
    static get version() { return '1.0.0'; }
  }

  return OrdoAudio;
});
