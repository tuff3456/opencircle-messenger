// Audio pipeline for calls: mic -> voice effect -> outgoing stream, plus soundboard.
const WORKLET = `
class PitchShift extends AudioWorkletProcessor {
  constructor(){ super(); this.L=8192; this.buf=new Float32Array(this.L); this.w=0; this.d=0; this.W=1600; this.ratio=1;
    this.port.onmessage=(e)=>{ this.ratio=e.data; }; }
  process(inputs, outputs){
    const inp=inputs[0]&&inputs[0][0]; const out=outputs[0][0]; if(!inp||!out) return true;
    const L=this.L, W=this.W, r=this.ratio;
    for(let i=0;i<inp.length;i++){
      this.buf[this.w]=inp[i];
      if(r===1){ out[i]=inp[i]; } else {
        this.d=(this.d+(1-r)+W)%W; const d2=(this.d+W/2)%W;
        const a=this.buf[(this.w-Math.floor(this.d)-1+L*2)%L], b=this.buf[(this.w-Math.floor(d2)-1+L*2)%L];
        out[i]=a*Math.sin(Math.PI*this.d/W)+b*Math.sin(Math.PI*d2/W);
      }
      this.w=(this.w+1)%L;
    }
    for(let c=1;c<outputs[0].length;c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('pitch-shift', PitchShift);`;

export const VOICES = [
  { id: "normal", label: "Normal" },
  { id: "deep", label: "Deep" },
  { id: "chipmunk", label: "Chipmunk" },
  { id: "robot", label: "Robot" },
  { id: "echo", label: "Echo cave" },
  { id: "radio", label: "Radio" },
] as const;
export type VoiceId = (typeof VOICES)[number]["id"];

export const SOUNDS = [
  { id: "airhorn", label: "📯 Airhorn" }, { id: "ding", label: "🔔 Ding" },
  { id: "drum", label: "🥁 Ba-dum-tss" }, { id: "trombone", label: "🎺 Sad trombone" },
  { id: "applause", label: "👏 Applause" }, { id: "boing", label: "🌀 Boing" },
  { id: "laser", label: "🔫 Laser" }, { id: "bruh", label: "😐 Bruh" },
] as const;

export class VoicePipeline {
  ctx: AudioContext;
  dest: MediaStreamAudioDestinationNode;
  private input: GainNode;
  private shifter: AudioWorkletNode | null = null;
  private chainOut: GainNode;
  private extra: AudioNode[] = [];
  private osc: OscillatorNode | null = null;
  private screenSource: MediaStreamAudioSourceNode | null = null;
  muted = false;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.dest = ctx.createMediaStreamDestination();
    this.input = ctx.createGain();
    this.chainOut = ctx.createGain();
    this.chainOut.connect(this.dest);
  }

  static async create(mic: MediaStream | null) {
    const ctx = new AudioContext();
    const p = new VoicePipeline(ctx);
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(url);
      p.shifter = new AudioWorkletNode(ctx, "pitch-shift");
    } catch { p.shifter = null; }
    if (mic) ctx.createMediaStreamSource(mic).connect(p.input);
    p.setVoice("normal");
    await ctx.resume();
    return p;
  }

  get track() { return this.dest.stream.getAudioTracks()[0]; }

  setMuted(m: boolean) { this.muted = m; this.input.gain.value = m ? 0 : 1; }

  setScreenAudio(stream: MediaStream | null) {
    this.screenSource?.disconnect(); this.screenSource = null;
    if (stream?.getAudioTracks().length) {
      this.screenSource = this.ctx.createMediaStreamSource(stream);
      this.screenSource.connect(this.dest);
    }
  }

  setVoice(v: VoiceId) {
    const c = this.ctx;
    this.input.disconnect();
    this.shifter?.disconnect();
    this.extra.forEach((n) => n.disconnect());
    this.osc?.stop(); this.osc = null;
    this.extra = [];
    let node: AudioNode = this.input;
    const chain = (n: AudioNode) => { node.connect(n); node = n; this.extra.push(n); };
    if ((v === "deep" || v === "chipmunk") && this.shifter) {
      this.shifter.port.postMessage(v === "deep" ? 0.7 : 1.6);
      node.connect(this.shifter); node = this.shifter;
    } else this.shifter?.port.postMessage(1);
    if (v === "robot") {
      const ring = c.createGain(); ring.gain.value = 0;
      const o = c.createOscillator(); o.frequency.value = 55; o.connect(ring.gain); o.start(); this.osc = o;
      chain(ring);
    }
    if (v === "radio") {
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 2;
      chain(bp);
      const ws = c.createWaveShaper(); const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 4); }
      ws.curve = curve; chain(ws);
    }
    if (v === "echo") {
      const dry = c.createGain(); node.connect(dry); this.extra.push(dry); dry.connect(this.chainOut);
      const d = c.createDelay(1); d.delayTime.value = 0.28; const fb = c.createGain(); fb.gain.value = 0.45;
      node.connect(d); d.connect(fb); fb.connect(d); d.connect(this.chainOut); this.extra.push(d, fb);
      return;
    }
    node.connect(this.chainOut);
  }

  play(id: string) {
    void this.ctx.resume();
    const c = this.ctx; const t = c.currentTime;
    const out = c.createGain(); out.gain.value = 0.5; out.connect(this.dest); out.connect(c.destination);
    const tone = (type: OscillatorType, f0: number, f1: number, start: number, dur: number, vol = 0.6) => {
      const o = c.createOscillator(); const g = c.createGain(); o.type = type;
      o.frequency.setValueAtTime(f0, t + start); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + start + dur);
      g.gain.setValueAtTime(vol, t + start); g.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
      o.connect(g); g.connect(out); o.start(t + start); o.stop(t + start + dur + 0.05);
    };
    const noise = (start: number, dur: number, vol = 0.5, hp = 0) => {
      const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate); const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = c.createBufferSource(); s.buffer = b; const g = c.createGain(); g.gain.value = vol;
      let n: AudioNode = s;
      if (hp) { const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp; s.connect(f); n = f; }
      n.connect(g); g.connect(out); s.start(t + start);
    };
    switch (id) {
      case "airhorn": [0, 0.35, 0.7].forEach((s) => { tone("sawtooth", 470, 450, s, 0.3); tone("sawtooth", 590, 570, s, 0.3, 0.4); }); break;
      case "ding": tone("sine", 1320, 1300, 0, 1.2); tone("sine", 2640, 2600, 0, 0.6, 0.2); break;
      case "drum": tone("sine", 160, 60, 0, 0.15); tone("sine", 180, 70, 0.18, 0.15); noise(0.4, 0.6, 0.4, 6000); break;
      case "trombone": [392, 370, 349, 330].forEach((f, i) => tone("sawtooth", f, i === 3 ? f * 0.9 : f, i * 0.45, i === 3 ? 1 : 0.4, 0.35)); break;
      case "applause": for (let i = 0; i < 25; i++) noise(i * 0.08 + Math.random() * 0.05, 0.08, 0.3, 1500); break;
      case "boing": tone("sine", 150, 600, 0, 0.5); break;
      case "laser": tone("square", 1800, 200, 0, 0.35, 0.3); break;
      case "bruh": tone("sawtooth", 110, 95, 0, 0.6, 0.5); break;
    }
  }

  close() { this.osc?.stop(); this.ctx.close(); }
}
