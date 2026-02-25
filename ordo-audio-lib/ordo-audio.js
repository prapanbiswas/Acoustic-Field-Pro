/**
 * ============================================================================
 * OrdoAudio.js — Professional Client-Side Audio Analysis Library
 * Version: 2.0.0  |  License: MIT
 * ============================================================================
 * v2.0 additions:
 *   - FFT window functions: Hann, Blackman, Flat-Top, Rectangular
 *   - A-weighting filter for RTA display (IEC 61672)
 *   - SessionStats class — tracks peak, LUFS avg, clip count, duration
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

  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const MAJOR_PROFILE = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const MINOR_PROFILE = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  const ISO_THIRD_OCTAVE_CENTERS = [
    20,25,31.5,40,50,63,80,100,125,160,
    200,250,315,400,500,630,800,1000,1250,1600,
    2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000
  ];

  // ============================================================================
  // UTILITIES
  // ============================================================================

  function linToDb(v)   { return v > 0 ? 20 * Math.log10(v) : -Infinity; }
  function dbToLin(db)  { return Math.pow(10, db / 20); }
  function clamp(v,a,b) { return Math.max(a, Math.min(b, v)); }
  function mean(arr)    { return arr && arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
  function variance(arr){
    if (!arr || arr.length < 2) return 0;
    const m = mean(arr);
    return arr.reduce((a,b)=>a+Math.pow(b-m,2),0)/arr.length;
  }
  function circularPush(arr, val, max) { arr.push(val); if (arr.length > max) arr.shift(); }
  function hzToMel(hz) { return 2595*Math.log10(1+hz/700); }
  function melToHz(mel){ return 700*(Math.pow(10,mel/2595)-1); }

  function dct(input) {
    const N=input.length, out=new Float32Array(N), s=Math.PI/N;
    for(let k=0;k<N;k++){ let sum=0; for(let n=0;n<N;n++) sum+=input[n]*Math.cos(s*(n+.5)*k); out[k]=sum; }
    return out;
  }

  function hzToNote(freq) {
    if(freq<20||!isFinite(freq)) return {note:'--',octave:0,cents:0,midi:0,name:'--'};
    const midi=12*Math.log2(freq/440)+69, mr=Math.round(midi);
    const cents=Math.round((midi-mr)*100), octave=Math.floor(mr/12)-1;
    const note=NOTE_NAMES[((mr%12)+12)%12];
    return {note,octave,cents,midi:mr,name:`${note}${octave}`};
  }

  function correlate(a, b) {
    const ma=mean(a),mb=mean(b); let num=0,da=0,db=0;
    for(let i=0;i<a.length;i++){ num+=(a[i]-ma)*(b[i]-mb); da+=Math.pow(a[i]-ma,2); db+=Math.pow(b[i]-mb,2); }
    const d=Math.sqrt(da*db); return d===0?0:num/d;
  }

  // ============================================================================
  // WINDOW FUNCTIONS
  // ============================================================================

  /**
   * Build a window coefficient array of length N.
   * @param {'hann'|'blackman'|'flattop'|'rectangular'} type
   * @param {number} N
   * @returns {Float32Array}
   */
  function buildWindow(type, N) {
    const w=new Float32Array(N), P=Math.PI;
    switch(type) {
      case 'blackman':
        for(let n=0;n<N;n++) w[n]=0.42-0.5*Math.cos(2*P*n/(N-1))+0.08*Math.cos(4*P*n/(N-1));
        break;
      case 'flattop':
        // ISO 18431-2 Flat-Top: best amplitude accuracy for level measurements
        for(let n=0;n<N;n++) w[n]=0.21557895-0.41663158*Math.cos(2*P*n/(N-1))+0.27726316*Math.cos(4*P*n/(N-1))-0.08357895*Math.cos(6*P*n/(N-1))+0.00694737*Math.cos(8*P*n/(N-1));
        break;
      case 'rectangular':
        for(let n=0;n<N;n++) w[n]=1.0;
        break;
      case 'hann':
      default:
        for(let n=0;n<N;n++) w[n]=0.5*(1-Math.cos(2*P*n/(N-1)));
        break;
    }
    return w;
  }

  // ============================================================================
  // A-WEIGHTING (IEC 61672-1:2013)
  // ============================================================================

  /**
   * Compute A-weighting correction in dB for a given frequency.
   * Normalized to 0 dB at 1000 Hz.
   * @param {number} f - Hz
   * @returns {number} dB correction
   */
  function aWeightDb(f) {
    if(f<10) return -100;
    const f2=f*f, f4=f2*f2;
    const Ra=(12200*12200*f4)/((f2+20.6*20.6)*Math.sqrt((f2+107.7*107.7)*(f2+737.9*737.9))*(f2+12200*12200));
    const Ra1k=(12200*12200*1e12)/((1e6+20.6*20.6)*Math.sqrt((1e6+107.7*107.7)*(1e6+737.9*737.9))*(1e6+12200*12200));
    return 20*Math.log10(Ra/Ra1k);
  }

  function buildAWeightTable(sampleRate, fftSize) {
    const binHz=sampleRate/fftSize, numBins=fftSize/2, t=new Float32Array(numBins);
    for(let i=0;i<numBins;i++) t[i]=aWeightDb(i*binHz);
    return t;
  }

  // ============================================================================
  // DSP MODULES
  // ============================================================================

  const RtaModule = {
    process(freqData, sampleRate, fftSize, aWeightTable) {
      const binHz=sampleRate/fftSize;
      return {
        bands: ISO_THIRD_OCTAVE_CENTERS.map(center=>{
          const low=center/Math.pow(2,1/6), high=center*Math.pow(2,1/6);
          const bL=Math.max(0,Math.floor(low/binHz)), bH=Math.min(freqData.length-1,Math.ceil(high/binHz));
          let energy=0,count=0;
          for(let i=bL;i<=bH;i++){
            const db=aWeightTable ? freqData[i]+aWeightTable[i] : freqData[i];
            energy+=Math.pow(10,db/10); count++;
          }
          const avgDb=count>0?10*Math.log10(Math.max(energy/count,1e-30)):-100;
          return {center, db:avgDb, normalized:clamp((avgDb+100)/100,0,1)};
        })
      };
    }
  };

  const SpectralFeaturesModule = {
    process(freqData, sampleRate, fftSize) {
      const binHz=sampleRate/fftSize, N=freqData.length;
      const mags=new Float32Array(N);
      for(let i=0;i<N;i++) mags[i]=Math.pow(10,freqData[i]/20);
      let total=0,wFreq=0,gLog=0;
      for(let i=1;i<N;i++){ const f=i*binHz,p=mags[i]*mags[i]; total+=p; wFreq+=f*p; gLog+=Math.log(Math.max(1e-10,p)); }
      const centroid=total>0?wFreq/total:0;
      const flatness=total>0?clamp(Math.exp(gLog/(N-1))/(total/(N-1)),0,1):0;
      let rolloff=0,cum=0; const thr=0.85*total;
      for(let i=1;i<N;i++){ cum+=mags[i]*mags[i]; if(cum>=thr){rolloff=i*binHz;break;} }
      let bwSum=0;
      for(let i=1;i<N;i++) bwSum+=Math.pow(i*binHz-centroid,2)*mags[i]*mags[i];
      return {centroid,flatness,rolloff,bandwidth:total>0?Math.sqrt(bwSum/total):0,totalEnergy:total};
    }
  };

  const LufsModule = {
    _biquad(f,x){ const y=f.b0*x+f.b1*f.x1+f.b2*f.x2-f.a1*f.y1-f.a2*f.y2; f.x2=f.x1;f.x1=x;f.y2=f.y1;f.y1=y; return y; },
    _filters(sr){
      const Vh=Math.pow(10,3.99984385397/20),Vb=Math.pow(Vh,.4845),f0=1681.974450955533,Q=.7071752369554196,K=Math.tan(Math.PI*f0/sr);
      const a0=1+K/Q+K*K;
      const pre={b0:(Vh+Vb*K/Q+K*K)/a0,b1:(2*(K*K-Vh))/a0,b2:(Vh-Vb*K/Q+K*K)/a0,a1:(2*(K*K-1))/a0,a2:(1-K/Q+K*K)/a0,x1:0,x2:0,y1:0,y2:0};
      const f0h=38.13547087613982,Qh=.5003270373238773,Kh=Math.tan(Math.PI*f0h/sr),a0h=1+Kh/Qh+Kh*Kh;
      const hp={b0:1/a0h,b1:-2/a0h,b2:1/a0h,a1:(2*(Kh*Kh-1))/a0h,a2:(1-Kh/Qh+Kh*Kh)/a0h,x1:0,x2:0,y1:0,y2:0};
      return {pre,hp};
    },
    process(timeData, state, sampleRate) {
      if(!state.f){ state.f=this._filters(sampleRate); state.mb=[]; state.sb=[]; state.ib=[]; state.il=-Infinity; }
      let bms=0;
      for(let i=0;i<timeData.length;i++){ let s=this._biquad(state.f.pre,timeData[i]); s=this._biquad(state.f.hp,s); bms+=s*s; }
      bms/=timeData.length;
      circularPush(state.mb,bms,4); circularPush(state.sb,bms,30);
      const mL=mean(state.mb),sL=mean(state.sb);
      const ml=mL>0?-0.691+10*Math.log10(mL):-Infinity;
      const sl=sL>0?-0.691+10*Math.log10(sL):-Infinity;
      if(ml>-70) state.ib.push(bms);
      if(state.ib.length>0){
        const ug=mean(state.ib),ul=-0.691+10*Math.log10(ug),rg=ul-10;
        const g=state.ib.filter(ms=>ms>0&&-0.691+10*Math.log10(ms)>rg);
        if(g.length>0) state.il=-0.691+10*Math.log10(mean(g));
      }
      const lb=state.sb.filter(ms=>ms>0).map(ms=>-0.691+10*Math.log10(ms)).filter(l=>l>-70);
      let lra=0;
      if(lb.length>1){const s=[...lb].sort((a,b)=>a-b); lra=s[Math.floor(s.length*.95)]-s[Math.floor(s.length*.1)];}
      return {momentary:isFinite(ml)?ml:-Infinity,shortTerm:isFinite(sl)?sl:-Infinity,integrated:isFinite(state.il)?state.il:-Infinity,lra};
    }
  };

  const TruePeakModule = {
    process(timeData, state) {
      if(state.hold===undefined) state.hold=-Infinity;
      let max=0;
      for(let i=0;i<timeData.length-1;i++){
        const a=timeData[i],b=timeData[i+1];
        const s=[a,a*.75+b*.25,a*.5+b*.5,a*.25+b*.75];
        for(const v of s) if(Math.abs(v)>max) max=Math.abs(v);
      }
      const db=linToDb(max);
      if(db>state.hold) state.hold=db;
      return {truePeak:db,truePeakHold:state.hold,isOver:db>-1.0};
    }
  };

  const DynamicsModule = {
    process(timeData, state) {
      if(!state.rh) {state.rh=[];state.ph=[];}
      let ss=0,pk=0;
      for(let i=0;i<timeData.length;i++){const a=Math.abs(timeData[i]);ss+=timeData[i]*timeData[i];if(a>pk)pk=a;}
      const rms=Math.sqrt(ss/timeData.length),rd=linToDb(rms),pd=linToDb(pk),cf=rms>0?pd-rd:0;
      circularPush(state.rh,rd,300); circularPush(state.ph,pd,300);
      const dr=state.rh.length>10?mean(state.ph)-mean(state.rh):0;
      return {rmsDb:rd,peakDb:pd,crestFactor:Math.abs(cf),dynamicRange:Math.abs(dr),compressionAmount:clamp(1-Math.abs(dr)/20,0,1)};
    }
  };

  const PitchModule = {
    process(timeData, sampleRate, threshold=0.15) {
      const N=timeData.length,H=Math.floor(N/2);
      const diff=new Float32Array(H);
      for(let t=0;t<H;t++) for(let j=0;j<H;j++){const d=timeData[j]-timeData[j+t];diff[t]+=d*d;}
      const cm=new Float32Array(H); cm[0]=1; let rs=0;
      for(let t=1;t<H;t++){rs+=diff[t];cm[t]=diff[t]/((1/t)*rs);}
      let tau=-1;
      for(let t=2;t<H;t++) if(cm[t]<threshold){while(t+1<H&&cm[t+1]<cm[t])t++;tau=t;break;}
      if(tau===-1){let mv=Infinity;for(let t=2;t<H;t++) if(cm[t]<mv){mv=cm[t];tau=t;}}
      let bt=tau;
      if(tau>0&&tau<H-1){const s0=cm[tau-1],s1=cm[tau],s2=cm[tau+1];bt=tau+(s2-s0)/(2*(2*s1-s2-s0));}
      const freq=bt>0?sampleRate/bt:0,conf=tau>0?clamp(1-cm[tau],0,1):0;
      return {frequency:conf>0.5?freq:0,rawFrequency:freq,confidence:conf,note:hzToNote(freq)};
    }
  };

  const ChromagramModule = {
    process(freqData, sampleRate, fftSize) {
      const binHz=sampleRate/fftSize,ch=new Float32Array(12);
      for(let i=1;i<freqData.length;i++){
        const f=i*binHz; if(f<20||f>20000) continue;
        const e=Math.pow(10,freqData[i]/10),m=12*Math.log2(f/440)+69,pc=((Math.round(m)%12)+12)%12;
        ch[pc]+=e;
      }
      const mx=Math.max(...ch); if(mx>0) for(let i=0;i<12;i++) ch[i]/=mx;
      let bk=0,bm='major',bc=-Infinity;
      for(let r=0;r<12;r++){
        const rot=[...ch.slice(r),...ch.slice(0,r)];
        const majC=correlate(rot,MAJOR_PROFILE),minC=correlate(rot,MINOR_PROFILE);
        if(majC>bc){bc=majC;bk=r;bm='major';} if(minC>bc){bc=minC;bk=r;bm='minor';}
      }
      return {chroma:Array.from(ch),key:NOTE_NAMES[bk],mode:bm,keyString:`${NOTE_NAMES[bk]} ${bm}`,confidence:clamp(bc,0,1)};
    }
  };

  const MfccModule = {
    _fb:null,
    _build(sr,fftSize,nf=26,fmin=20,fmax=8000){
      const nb=fftSize/2,mel0=hzToMel(fmin),mel1=hzToMel(fmax),pts=[];
      for(let i=0;i<=nf+1;i++) pts.push(melToHz(mel0+i*(mel1-mel0)/(nf+1)));
      const bp=pts.map(hz=>Math.floor((fftSize+1)*hz/sr));
      const fb=[];
      for(let m=1;m<=nf;m++){
        const f=new Float32Array(nb);
        for(let k=0;k<nb;k++){
          if(k>=bp[m-1]&&k<=bp[m]) f[k]=(k-bp[m-1])/(bp[m]-bp[m-1]);
          else if(k>=bp[m]&&k<=bp[m+1]) f[k]=(bp[m+1]-k)/(bp[m+1]-bp[m]);
        }
        fb.push(f);
      }
      return fb;
    },
    process(freqData, sampleRate, fftSize, nc=13) {
      if(!this._fb) this._fb=this._build(sampleRate,fftSize);
      const pw=new Float32Array(freqData.length);
      for(let i=0;i<freqData.length;i++) pw[i]=Math.pow(10,freqData[i]/10);
      const me=new Float32Array(this._fb.length);
      for(let m=0;m<this._fb.length;m++){let e=0;for(let k=0;k<freqData.length;k++)e+=this._fb[m][k]*pw[k];me[m]=Math.log(Math.max(1e-10,e));}
      return {mfcc:Array.from(dct(me).slice(0,nc)),numCoeffs:nc};
    }
  };

  const OnsetModule = {
    process(freqData, state, sampleRate, fftSize) {
      if(!state.prev){state.prev=new Float32Array(freqData.length);state.ot=[];state.lof=0;state.fc=0;state.bh=[];state.fh=[];state.bpm=0;}
      let flux=0;
      for(let i=0;i<freqData.length;i++){const d=freqData[i]-state.prev[i];if(d>0)flux+=d;}
      state.prev.set(freqData); state.fc++;
      circularPush(state.fh,flux,20);
      const mg=Math.max(state.fc-state.lof,1),minGap=Math.round(.25*sampleRate/fftSize);
      let onset=false;
      if(flux>mean(state.fh)*1.5&&mg>minGap){
        onset=true; state.lof=state.fc;
        circularPush(state.ot,Date.now(),16);
        if(state.ot.length>=4){
          const ivs=[];for(let i=1;i<state.ot.length;i++)ivs.push(state.ot[i]-state.ot[i-1]);
          const ai=mean(ivs);if(ai>200&&ai<2000){circularPush(state.bh,60000/ai,8);state.bpm=mean(state.bh);}
        }
      }
      return {flux,isOnset:onset,bpm:Math.round(state.bpm),bpmRaw:state.bpm,confidence:state.ot.length>4?clamp(1-variance(state.bh)/100,0,1):0};
    }
  };

  const ThdModule = {
    process(freqData, sampleRate, fftSize, fundamentalHz) {
      if(!fundamentalHz||fundamentalHz<20) return {thd:0,thdString:'0.00%',harmonics:[]};
      const binHz=sampleRate/fftSize;
      const getBP=(hz)=>{const b=Math.round(hz/binHz);if(b<0||b>=freqData.length)return 0;let p=0;for(let i=Math.max(0,b-2);i<=Math.min(freqData.length-1,b+2);i++)p+=Math.pow(10,freqData[i]/10);return p;};
      const fp=getBP(fundamentalHz);const hs=[];let hps=0;
      for(let n=2;n<=8;n++){const hz=fundamentalHz*n;if(hz>sampleRate/2)break;const p=getBP(hz);hps+=p;hs.push({harmonic:n,freq:hz,power:p,db:linToDb(Math.sqrt(p))});}
      const thd=fp>0?Math.sqrt(hps/fp)*100:0;
      return {thd:clamp(thd,0,100),thdString:`${thd.toFixed(2)}%`,harmonics:hs,fundamentalPower:fp};
    }
  };

  const SnrModule = {
    process(freqData, state) {
      if(!state.nfe){state.nfe=null;state.nf=[];state.cal=true;state.calf=30;}
      if(state.cal&&state.nf.length<state.calf){state.nf.push(mean(Array.from(freqData).map(d=>Math.pow(10,d/10))));return {snr:null,calibrating:true,noiseFloor:null};}
      if(state.cal){state.nfe=mean(state.nf);state.cal=false;}
      const sp=mean(Array.from(freqData).map(d=>Math.pow(10,d/10)));
      const snr=10*Math.log10(Math.max(sp/state.nfe,1));
      return {snr,snrString:`${snr.toFixed(1)} dB`,calibrating:false,noiseFloor:10*Math.log10(state.nfe),signalLevel:10*Math.log10(sp)};
    }
  };

  const ZcrModule = {
    process(timeData, sampleRate) {
      let c=0;for(let i=1;i<timeData.length;i++) if((timeData[i-1]>=0)!==(timeData[i]>=0))c++;
      const zcr=c/(2*(timeData.length/sampleRate));
      return {zcr,type:zcr>3000?'noisy':zcr>1000?'mixed':'tonal'};
    }
  };

  const DcOffsetModule = {
    process(timeData) {
      const avg=mean(Array.from(timeData));
      return {dcOffset:avg,dcOffsetDb:linToDb(Math.abs(avg)),hasIssue:Math.abs(avg)>.005,severity:Math.abs(avg)>.02?'critical':Math.abs(avg)>.005?'warning':'ok'};
    }
  };

  const ClippingModule = {
    process(timeData, state) {
      if(state.ch===undefined){state.ch=0;state.pd=-Infinity;state.cc=0;}
      let mx=0,cs=0;
      for(let i=0;i<timeData.length;i++){const a=Math.abs(timeData[i]);if(a>mx)mx=a;if(a>=.9999)cs++;}
      const pd=linToDb(mx);if(pd>state.pd)state.pd=pd;
      const clip=pd>-0.5;if(clip){state.ch=60;state.cc++;}else if(state.ch>0)state.ch--;
      return {peakDb:pd,allTimePeak:state.pd,isClipping:clip,clipLedActive:state.ch>0,clippedSamples:cs,clipRatio:cs/timeData.length,totalClipEvents:state.cc};
    }
  };

  const FeedbackModule = {
    process(freqData, sampleRate, fftSize, state) {
      if(!state.fh){state.fh=[];state.hc=0;state.rf=0;}
      const binHz=sampleRate/fftSize;let mdb=-Infinity,db=0;
      for(let i=Math.floor(100/binHz);i<freqData.length;i++) if(freqData[i]>mdb){mdb=freqData[i];db=i;}
      const dHz=db*binHz;
      if(mdb>-20&&dHz>250)circularPush(state.fh,dHz,25);else circularPush(state.fh,0,25);
      let fb=false,ns=null;
      if(state.fh.length>=25){const nz=state.fh.filter(f=>f>0);if(nz.length>=20&&Math.sqrt(variance(nz))<20){state.hc=50;state.rf=mean(nz);ns={frequency:state.rf,note:hzToNote(state.rf),bandwidth:'1/3 octave',suggestedCut:'-6 to -12 dB'};}}
      if(state.hc>0){fb=true;state.hc--;}
      return {isFeedbackRisk:fb,ringingFrequency:state.rf,notchSuggestion:ns,dominantFrequency:dHz,dominantDb:mdb};
    }
  };

  const PhaseModule = {
    process(timeData, right=null) {
      if(!right) return {correlation:1,monoCompatible:true,phaseString:'Mono',width:0};
      let dot=0,lp=0,rp=0;
      for(let i=0;i<timeData.length;i++){dot+=timeData[i]*right[i];lp+=timeData[i]*timeData[i];rp+=right[i]*right[i];}
      const d=Math.sqrt(lp*rp),c=d>0?clamp(dot/d,-1,1):0;
      return {correlation:c,monoCompatible:c>-0.5,phaseString:c>.8?'Mono-ish':c>0?'Wide':'Out-of-Phase!',width:clamp(1-c,0,2)};
    }
  };

  const Rt60Module = {
    process(timeData, sampleRate, state) {
      if(!state.s){state.s=[];state.dec=false;state.rt=null;}
      let rms=0;for(let i=0;i<timeData.length;i++)rms+=timeData[i]*timeData[i];
      rms=Math.sqrt(rms/timeData.length);const db=linToDb(rms);
      state.s.push({db,time:Date.now()});if(state.s.length>500)state.s.shift();
      if(state.s.length>50){
        const rc=state.s.slice(-10),ro=state.s.slice(-50,-40);
        const rm=mean(rc.map(s=>s.db)),om=mean(ro.map(s=>s.db));
        if(!state.dec&&om>-20&&rm<om-15){state.dec=true;state.ds=om;state.dt=ro[0].time;}
        if(state.dec&&db<state.ds-60){state.rt=(Date.now()-state.dt)/1000;state.dec=false;}
      }
      return {rt60:state.rt,rt60String:state.rt?`${state.rt.toFixed(2)}s`:'Measuring...',isDecaying:state.dec,currentRmsDb:db};
    }
  };

  const InharmonicityModule = {
    process(freqData, sampleRate, fftSize, fundamentalHz) {
      if(!fundamentalHz||fundamentalHz<20) return {inharmonicity:0,harmonicsFound:[],inharmonicityScore:'N/A'};
      const binHz=sampleRate/fftSize,hf=[];let td=0,cnt=0;
      for(let n=2;n<=10;n++){
        const ih=fundamentalHz*n;if(ih>sampleRate/2)break;
        const bL=Math.floor(ih*.95/binHz),bH=Math.ceil(ih*1.05/binHz);
        let md=-Infinity,pb=0;
        for(let b=bL;b<=bH&&b<freqData.length;b++) if(freqData[b]>md){md=freqData[b];pb=b;}
        if(md>-60){const ah=pb*binHz,dev=((ah-ih)/ih)*100;td+=Math.abs(dev);cnt++;hf.push({n,idealHz:ih,actualHz:ah,deviation:dev,db:md});}
      }
      const inh=cnt>0?td/cnt:0;
      return {inharmonicity:inh,harmonicsFound:hf,inharmonicityScore:inh<.5?'Very Clean':inh<2?'Normal':inh<5?'Stretched':'High'};
    }
  };

  const StandingWaveModule = {
    process(freqData, sampleRate, fftSize, state) {
      if(!state.h) state.h=[];
      const binHz=sampleRate/fftSize,mb=Math.ceil(300/binHz),snap=[];
      for(let i=Math.floor(20/binHz);i<=mb&&i<freqData.length;i++) snap.push({freq:i*binHz,db:freqData[i]});
      circularPush(state.h,snap,30);if(state.h.length<10)return {modes:[],detected:false};
      const am=new Map();
      for(const fr of state.h) for(const{freq,db}of fr){const k=Math.round(freq);if(!am.has(k))am.set(k,[]);am.get(k).push(db);}
      const ad=[];for(const[freq,dbs]of am)ad.push({freq,db:mean(dbs)});
      const om=mean(ad.map(d=>d.db));
      const modes=ad.filter(d=>d.db>om+8).sort((a,b)=>b.db-a.db).slice(0,5);
      return {modes,detected:modes.length>0,worstMode:modes[0]||null};
    }
  };

  // ============================================================================
  // SESSION STATISTICS
  // ============================================================================

  class SessionStats {
    constructor() { this.reset(); }
    reset() {
      this.startTime=null; this.endTime=null;
      this.peakDbfs=-Infinity; this.truePeakDbtp=-Infinity;
      this.lufsSum=0; this.lufsCount=0;
      this.totalClipEvents=0; this.totalFeedbackEvents=0;
      this.dominantKey=null; this.dominantBpm=null;
    }
    start() { this.reset(); this.startTime=Date.now(); }
    stop()  { this.endTime=Date.now(); }
    update(d) {
      if(!this.startTime) return;
      if(d.clipping){ if(d.clipping.peakDb>this.peakDbfs)this.peakDbfs=d.clipping.peakDb; if(d.clipping.isClipping)this.totalClipEvents++; }
      if(d.truePeak&&d.truePeak.truePeak>this.truePeakDbtp)this.truePeakDbtp=d.truePeak.truePeak;
      if(d.lufs&&isFinite(d.lufs.momentary)){this.lufsSum+=d.lufs.momentary;this.lufsCount++;}
      if(d.feedback&&d.feedback.isFeedbackRisk)this.totalFeedbackEvents++;
      if(d.chroma&&d.chroma.key)this.dominantKey=`${d.chroma.key} ${d.chroma.mode}`;
      if(d.onset&&d.onset.bpm>0)this.dominantBpm=d.onset.bpm;
    }
    get durationSeconds(){ return this.startTime?((this.endTime||Date.now())-this.startTime)/1000:0; }
    get averageLufs(){ return this.lufsCount>0?this.lufsSum/this.lufsCount:-Infinity; }
    toObject(){
      return {durationSeconds:this.durationSeconds,peakDbfs:this.peakDbfs,truePeakDbtp:this.truePeakDbtp,averageLufs:this.averageLufs,totalClipEvents:this.totalClipEvents,totalFeedbackEvents:this.totalFeedbackEvents,dominantKey:this.dominantKey,dominantBpm:this.dominantBpm};
    }
  }

  // ============================================================================
  // MAIN CLASS
  // ============================================================================

  class OrdoAudio {
    constructor(opts={}) {
      this.options={
        fftSize:               opts.fftSize               || 4096,
        smoothingTimeConstant: opts.smoothingTimeConstant || 0.8,
        minDecibels:           opts.minDecibels           || -100,
        maxDecibels:           opts.maxDecibels           || 0,
        sampleRate:            opts.sampleRate            || null,
        windowType:            opts.windowType            || 'hann',
        useAWeighting:         opts.useAWeighting         || false,
      };
      this.audioContext=null; this.analyser=null; this.source=null; this.stream=null;
      this.timeData=null; this.freqData=null;
      this._windowCoeffs=null; this._aWeightTable=null;
      this._moduleStates={}; this._listeners={}; this._animFrameId=null;
      this._isRunning=false; this._frameCount=0;
      this.session=new SessionStats();
      this.diagnostics={fps:0,lastFrameTime:0,processingTimeMs:0};
      this._activeModules=new Set(OrdoAudio.modules);
    }

    // Config
    setWindow(type){ this.options.windowType=type; if(this.analyser) this._windowCoeffs=buildWindow(type,this.options.fftSize); return this; }
    setAWeighting(en){
      this.options.useAWeighting=en;
      if(en&&this.audioContext&&!this._aWeightTable) this._aWeightTable=buildAWeightTable(this.audioContext.sampleRate,this.options.fftSize);
      return this;
    }

    // Module selection
    use(...mods){ this._activeModules=new Set(mods); return this; }
    enable(...mods){ mods.forEach(m=>this._activeModules.add(m)); return this; }
    disable(...mods){ mods.forEach(m=>this._activeModules.delete(m)); return this; }

    // Events
    on(ev,cb){ if(!this._listeners[ev])this._listeners[ev]=[]; this._listeners[ev].push(cb); return this; }
    off(ev,cb){ if(this._listeners[ev])this._listeners[ev]=this._listeners[ev].filter(c=>c!==cb); return this; }
    _emit(ev,d){ if(this._listeners[ev])this._listeners[ev].forEach(cb=>cb(d)); }

    // Init
    async init(source='microphone') {
      try {
        this.audioContext=new (window.AudioContext||window.webkitAudioContext)({sampleRate:this.options.sampleRate||undefined,latencyHint:'interactive'});
        this.analyser=this.audioContext.createAnalyser();
        this.analyser.fftSize=this.options.fftSize;
        this.analyser.smoothingTimeConstant=this.options.smoothingTimeConstant;
        this.analyser.minDecibels=this.options.minDecibels;
        this.analyser.maxDecibels=this.options.maxDecibels;
        if(source==='microphone'){
          this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,autoGainControl:false,noiseSuppression:false,latency:0}});
          this.source=this.audioContext.createMediaStreamSource(this.stream);
        } else if(source instanceof MediaStream){
          this.stream=source; this.source=this.audioContext.createMediaStreamSource(source);
        } else if(source instanceof AudioBuffer){
          const bs=this.audioContext.createBufferSource(); bs.buffer=source; this.source=bs; bs.start();
        } else throw new Error('Invalid source');
        this.source.connect(this.analyser);
        this.timeData=new Float32Array(this.analyser.fftSize);
        this.freqData=new Float32Array(this.analyser.frequencyBinCount);
        this._windowCoeffs=buildWindow(this.options.windowType,this.options.fftSize);
        if(this.options.useAWeighting) this._aWeightTable=buildAWeightTable(this.audioContext.sampleRate,this.options.fftSize);
        this._emit('ready',{sampleRate:this.audioContext.sampleRate,fftSize:this.options.fftSize,frequencyBinCount:this.analyser.frequencyBinCount,activeModules:[...this._activeModules]});
        return this;
      } catch(err){ this._emit('error',err); throw err; }
    }

    // Playback
    start() {
      if(this._isRunning) return this;
      this._isRunning=true;
      if(this.audioContext&&this.audioContext.state==='suspended') this.audioContext.resume();
      this.session.start();
      const loop=()=>{
        if(!this._isRunning)return;
        const t0=performance.now(),result=this.processFrame();
        if(result){this.session.update(result);this._emit('frame',result);}
        this.diagnostics.processingTimeMs=performance.now()-t0;
        const now=performance.now();
        this.diagnostics.fps=Math.round(1000/(now-this.diagnostics.lastFrameTime));
        this.diagnostics.lastFrameTime=now;
        this._animFrameId=requestAnimationFrame(loop);
      };
      this._animFrameId=requestAnimationFrame(loop);
      return this;
    }

    stop() {
      this._isRunning=false; this.session.stop();
      if(this._animFrameId){cancelAnimationFrame(this._animFrameId);this._animFrameId=null;}
      return this;
    }

    async destroy() {
      this.stop();
      if(this.stream)this.stream.getTracks().forEach(t=>t.stop());
      if(this.audioContext)await this.audioContext.close();
      this._listeners={};
    }

    // Core processing
    processFrame() {
      if(!this.analyser) return null;
      this.analyser.getFloatTimeDomainData(this.timeData);
      this.analyser.getFloatFrequencyData(this.freqData);
      const sr=this.audioContext.sampleRate,fft=this.options.fftSize;
      this._frameCount++;
      const r={frame:this._frameCount,timestamp:Date.now(),sampleRate:sr,fftSize:fft,raw:{timeData:this.timeData,freqData:this.freqData,binHz:sr/fft},diagnostics:{...this.diagnostics}};
      const st=this._moduleStates,has=m=>this._activeModules.has(m);
      const awt=this.options.useAWeighting?this._aWeightTable:null;

      if(has('clipping'))     {if(!st.cl)st.cl={};r.clipping=ClippingModule.process(this.timeData,st.cl);if(r.clipping.isClipping)this._emit('clip',r.clipping);}
      if(has('dcOffset'))      r.dcOffset=DcOffsetModule.process(this.timeData);
      if(has('zcr'))           r.zcr=ZcrModule.process(this.timeData,sr);
      if(has('dynamics'))     {if(!st.dy)st.dy={};r.dynamics=DynamicsModule.process(this.timeData,st.dy);}
      if(has('truePeak'))     {if(!st.tp)st.tp={};r.truePeak=TruePeakModule.process(this.timeData,st.tp);}
      if(has('lufs'))         {if(!st.lf)st.lf={};r.lufs=LufsModule.process(this.timeData,st.lf,sr);}
      if(has('rta'))           r.rta=RtaModule.process(this.freqData,sr,fft,awt);
      if(has('spectral'))      r.spectral=SpectralFeaturesModule.process(this.freqData,sr,fft);
      if(has('pitch'))         r.pitch=PitchModule.process(this.timeData,sr,0.15);
      if(has('chroma'))        r.chroma=ChromagramModule.process(this.freqData,sr,fft);
      if(has('mfcc'))          r.mfcc=MfccModule.process(this.freqData,sr,fft,13);
      if(has('onset'))        {if(!st.on)st.on={};r.onset=OnsetModule.process(this.freqData,st.on,sr,fft);if(r.onset.isOnset)this._emit('onset',r.onset);}
      if(has('thd')&&r.pitch)  r.thd=ThdModule.process(this.freqData,sr,fft,r.pitch.frequency);
      if(has('snr'))          {if(!st.sn)st.sn={};r.snr=SnrModule.process(this.freqData,st.sn);}
      if(has('feedback'))     {if(!st.fb)st.fb={};r.feedback=FeedbackModule.process(this.freqData,sr,fft,st.fb);if(r.feedback&&r.feedback.isFeedbackRisk)this._emit('feedback',r.feedback);}
      if(has('phase'))         r.phase=PhaseModule.process(this.timeData,null);
      if(has('rt60'))         {if(!st.rt)st.rt={};r.rt60=Rt60Module.process(this.timeData,sr,st.rt);}
      if(has('inharmonicity')&&r.pitch) r.inharmonicity=InharmonicityModule.process(this.freqData,sr,fft,r.pitch.frequency);
      if(has('standingWaves')){if(!st.sw)st.sw={};r.standingWaves=StandingWaveModule.process(this.freqData,sr,fft,st.sw);}
      return r;
    }

    // Static utils
    static analyzeBuffer(buf){
      const d=buf.getChannelData(0),sr=buf.sampleRate;
      return {dynamics:DynamicsModule.process(d,{}),zcr:ZcrModule.process(d,sr),dcOffset:DcOffsetModule.process(d),clipping:ClippingModule.process(d,{}),sampleRate:sr,duration:buf.duration};
    }
    static hzToNote(hz)       { return hzToNote(hz); }
    static linToDb(lin)       { return linToDb(lin); }
    static dbToLin(db)        { return dbToLin(db); }
    static hzToMel(hz)        { return hzToMel(hz); }
    static aWeightDb(hz)      { return aWeightDb(hz); }
    static buildWindow(t,N)   { return buildWindow(t,N); }
    static get modules(){ return ['rta','spectral','lufs','truePeak','dynamics','pitch','chroma','mfcc','onset','thd','snr','zcr','dcOffset','clipping','feedback','phase','rt60','inharmonicity','standingWaves']; }
    static get version(){ return '2.0.0'; }
  }

  return OrdoAudio;
});
