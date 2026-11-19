// Ambient sound for the holo war room (owner 2026-11-19: "Ada, mati default"). Generated with WebAudio, so there is
// no audio file to fetch: a low drone through a slowly breathing filter, a little air, and a soft tone when an
// agent starts to speak. Created only after the visitor turns the sound on (browsers need that gesture anyway).
export function ambient() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 380; filter.Q.value = 0.7; filter.connect(master);
  // the drone: a low fifth, slightly detuned so it beats slowly
  for (const [f, type, g] of [[55, 'sine', 0.5], [82.4, 'triangle', 0.18], [110.3, 'sine', 0.12]]) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 8;
    const v = ctx.createGain(); v.gain.value = g; o.connect(v).connect(filter); o.start();
  }
  // the filter breathes once every 14 seconds or so
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const depth = ctx.createGain(); depth.gain.value = 160; lfo.connect(depth).connect(filter.frequency); lfo.start();
  // air: filtered noise, very quiet
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const air = ctx.createBufferSource(); air.buffer = noise; air.loop = true;
  const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 900; band.Q.value = 0.6;
  const airGain = ctx.createGain(); airGain.gain.value = 0.035; air.connect(band).connect(airGain).connect(master); air.start();
  let on = false;
  return {
    set(next) {
      on = Boolean(next);
      const t = ctx.currentTime;
      if (on) ctx.resume();
      master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(on ? 0.09 : 0, t + 1.2);
      if (!on) setTimeout(() => { if (!on) ctx.suspend(); }, 1400);
    },
    blip() {
      if (!on) return;
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(660, t + 0.18);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.32);
    }
  };
}
