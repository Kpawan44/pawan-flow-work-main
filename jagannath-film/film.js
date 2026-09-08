const SCENES = [
  {
    id: 0,
    title: "आवाहन",
    duration: 7000,
    music: 0.22,
    narration: "",
    shots: [{ src: "assets/scene-01-forest-mystery.png", ken: "in", duration: 7000 }],
  },
  {
    id: 1,
    title: "प्राचीन दिव्य रहस्य",
    duration: 10000,
    music: 0.28,
    narration:
      "बहुत पहले, ओडिशा की पवित्र भूमि में एक दिव्य रहस्य प्रकट हुआ—जो भारत के आध्यात्मिक इतिहास को सदा के लिए बदल देगा।",
    shots: [{ src: "assets/scene-01-forest-mystery.png", ken: "left", duration: 10000 }],
  },
  {
    id: 2,
    title: "राजा इन्द्रद्युम्न का दर्शन",
    duration: 10500,
    music: 0.32,
    narration:
      "राजा इन्द्रद्युम्न को दिव्य आह्वान मिला। उन्हें बताया गया कि परम प्रभु स्वयं एक रहस्यमय रूप में प्रकट होंगे।",
    shots: [{ src: "assets/scene-02-king-vision.png", ken: "in", duration: 10500 }],
  },
  {
    id: 3,
    title: "दिव्य खोज",
    duration: 10000,
    music: 0.34,
    narration: "परंतु वन के एक भक्त सेवक पहले से ही गुप्त रूप से प्रभु की आराधना कर रहा था।",
    shots: [
      { src: "assets/scene-03-search-and-devotee.png", ken: "right", duration: 4200 },
      { src: "assets/scene-03b-vishvavasu-worship.png", ken: "in", duration: 5800 },
    ],
  },
  {
    id: 4,
    title: "दिव्य विग्रह",
    duration: 11000,
    music: 0.38,
    narration:
      "प्रभु ने प्रकट किया कि उनका रूप साधारण मानव नेत्रों से नहीं समझा जा सकता। वे रूप से परे हैं, फिर भी भक्तों के लिए रूप धारण करते हैं।",
    shots: [{ src: "assets/scene-04-divine-revelation.png", ken: "in", duration: 11000 }],
  },
  {
    id: 5,
    title: "रहस्यमय शिल्पी",
    duration: 11000,
    music: 0.36,
    narration: "जब तक मैं कार्य करूँ, कोई मुझे विचलित न करे।",
    extraNarration:
      "एक वृद्ध रहस्यमय शिल्पी राजमहल में आया। वह दिव्य काष्ठ विग्रह गढ़ सकता था—एक पवित्र शर्त पर।",
    shots: [
      { src: "assets/scene-05-king-and-carpenter.png", ken: "out", duration: 5500 },
      { src: "assets/scene-05b-workshop-log.png", ken: "in", duration: 5500 },
    ],
  },
  {
    id: 6,
    title: "रहस्यमय मौन",
    duration: 12500,
    music: 0.3,
    narration:
      "जब द्वार खुले, वह रहस्यमय शिल्पी अदृश्य हो चुका था। राजा के सम्मुख तीन अद्भुत दिव्य रूप थे—मानव दृष्टि में अधूरे, पर दिव्य इच्छा से पूर्ण।",
    shots: [
      { src: "assets/scene-06a-waiting.png", ken: "left", duration: 4500 },
      { src: "assets/scene-06-three-forms.png", ken: "in", duration: 8000 },
    ],
  },
  {
    id: 7,
    title: "जगन्नाथ का प्राकट्य",
    duration: 10500,
    music: 0.48,
    narration:
      "और इस प्रकार जगन्नाथ की दिव्य उपस्थिति ऐसे रूप में प्रकट हुई, जो हर भक्त का स्वागत करे—जाति, पद या मूल से परे।",
    shots: [
      { src: "assets/scene-07-temple-installation.png", ken: "in", duration: 6000 },
      { src: "assets/scene-jagannath-eyes.png", ken: "in", duration: 4500 },
    ],
  },
  {
    id: 8,
    title: "पुरी का मंदिर",
    duration: 10000,
    music: 0.52,
    narration:
      "उसी पवित्र क्षण से पुरी भारत के महानतम तीर्थों में से एक बना—भगवान जगन्नाथ का पावन धाम।",
    shots: [{ src: "assets/scene-08-puri-temple-aerial.png", ken: "up", duration: 10000 }],
  },
  {
    id: 9,
    title: "रथ यात्रा",
    duration: 16000,
    music: 0.78,
    conch: true,
    narration:
      "प्रत्येक वर्ष प्रभु अपने मंदिर से निकलकर भक्तों के बीच आते हैं। यही है पवित्र रथ यात्रा—जगन्नाथ की यात्रा।",
    shots: [
      { src: "assets/scene-09-rath-yatra.png", ken: "out", duration: 4500 },
      { src: "assets/scene-09c-devotees-pulling.png", ken: "left", duration: 3800 },
      { src: "assets/scene-09b-chariot-wheels.png", ken: "in", duration: 3500 },
      { src: "assets/scene-jagannath-eyes.png", ken: "in", duration: 4200 },
    ],
  },
  {
    id: 10,
    title: "सबके प्रभु",
    duration: 10000,
    music: 0.62,
    narration: "जगन्नाथ का अर्थ है—जगत् के स्वामी। उनका संदेश सरल है—दिव्य सबका है।",
    shots: [
      { src: "assets/scene-10-belongs-to-everyone.png", ken: "out", duration: 5500 },
      { src: "assets/scene-jagannath-eyes.png", ken: "in", duration: 4500 },
    ],
  },
  {
    id: 11,
    title: "विश्वरूप",
    duration: 12500,
    music: 0.86,
    narration:
      "काष्ठ से परे, मंदिर से परे, हर मानवीय सीमा से परे—जगन्नाथ उस शाश्वत दिव्य उपस्थिति के प्रतीक हैं जो समस्त ब्रह्मांड में बसती है।",
    shots: [
      { src: "assets/scene-jagannath-eyes.png", ken: "in", duration: 3000 },
      { src: "assets/cosmic-jagannath.png", ken: "out", duration: 9500 },
    ],
  },
  {
    id: 12,
    title: "जय जगन्नाथ",
    duration: 15000,
    music: 0.7,
    finale: true,
    narration:
      "जय जगन्नाथ। जगत् के स्वामी प्रत्येक हृदय को भक्ति, करुणा और मानवता की ओर ले जाएँ।",
    shots: [{ src: "assets/scene-12-sunset-ending.png", ken: "in", duration: 9500 }],
  },
];

const shotsEl = document.getElementById("shots");
const subtitlesEl = document.getElementById("subtitles");
const titleCard = document.getElementById("title-card");
const endCard = document.getElementById("end-card");
const hud = document.getElementById("hud");
const progressBar = document.getElementById("progress-bar");
const sceneLabel = document.getElementById("scene-label");
const goldenFade = document.getElementById("golden-fade");
const playBtn = document.getElementById("play-btn");
const pauseBtn = document.getElementById("pause-btn");
const muteBtn = document.getElementById("mute-btn");

const totalMs = SCENES.reduce((s, sc) => s + sc.duration, 0);
let started = false;
let paused = false;
let muted = false;
let sceneIndex = 0;
let sceneStartedAt = 0;
let elapsedBeforePause = 0;
let timers = [];
let audio;
let speechUtterance;

class SacredScore {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
    this.intensity = 0.28;
    this.nodes = [];
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.drone();
    this.strings();
    this.bellPulse();
    this.flute();
    this.tabla();
    this.choir();
  }

  setIntensity(v) {
    this.intensity = v;
    if (this.padGain) {
      this.padGain.gain.setTargetAtTime(0.05 + v * 0.12, this.ctx.currentTime, 1.2);
    }
    if (this.tablaGain) {
      this.tablaGain.gain.setTargetAtTime(0.02 + v * 0.09, this.ctx.currentTime, 0.8);
    }
    if (this.choirGain) {
      this.choirGain.gain.setTargetAtTime(v * 0.08, this.ctx.currentTime, 1.4);
    }
  }

  osc(type, freq, gainValue, dest) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gainValue;
    o.connect(g);
    g.connect(dest || this.master);
    o.start();
    this.nodes.push(o);
    return { o, g };
  }

  drone() {
    const dest = this.ctx.createGain();
    dest.gain.value = 0.16;
    dest.connect(this.master);
    [98, 147, 196, 294].forEach((f, i) => {
      this.osc("sine", f, 0.18 - i * 0.03, dest);
      this.osc("triangle", f * 1.002, 0.04, dest);
    });
  }

  strings() {
    this.padGain = this.ctx.createGain();
    this.padGain.gain.value = 0.07;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1400;
    this.padGain.connect(filter);
    filter.connect(this.master);
    [196, 247, 294, 392].forEach((f) => this.osc("sawtooth", f, 0.05, this.padGain));
  }

  choir() {
    this.choirGain = this.ctx.createGain();
    this.choirGain.gain.value = 0.02;
    this.choirGain.connect(this.master);
    [392, 494, 587].forEach((f) => this.osc("triangle", f, 0.07, this.choirGain));
  }

  bellPulse() {
    const ring = () => {
      if (!this.running) return;
      const now = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(880, now);
      o.frequency.exponentialRampToValueAtTime(420, now + 1.6);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
      o.connect(g);
      g.connect(this.master);
      o.start(now);
      o.stop(now + 2.3);
      setTimeout(ring, this.intensity > 0.6 ? 1800 : 3200);
    };
    ring();
  }

  flute() {
    const phrases = [
      [392, 440, 494, 523, 494, 440, 392],
      [294, 349, 392, 440, 392, 349, 330, 294],
      [523, 494, 440, 392, 349, 392, 440],
    ];
    let p = 0;
    const playPhrase = () => {
      if (!this.running) return;
      const notes = phrases[p % phrases.length];
      p += 1;
      notes.forEach((freq, i) => {
        const t = this.ctx.currentTime + i * 0.42;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const f = this.ctx.createBiquadFilter();
        o.type = "sine";
        o.frequency.value = freq;
        f.type = "lowpass";
        f.frequency.value = 1800;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.07 + this.intensity * 0.05, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o.connect(f);
        f.connect(g);
        g.connect(this.master);
        o.start(t);
        o.stop(t + 0.45);
      });
      setTimeout(playPhrase, 4200);
    };
    playPhrase();
  }

  tabla() {
    this.tablaGain = this.ctx.createGain();
    this.tablaGain.gain.value = 0.04;
    this.tablaGain.connect(this.master);
    const beat = () => {
      if (!this.running) return;
      const now = this.ctx.currentTime;
      const pattern = this.intensity > 0.55 ? [0, 0.25, 0.5, 0.75] : [0, 0.5];
      pattern.forEach((off, i) => {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(i % 2 === 0 ? 90 : 160, now + off);
        o.frequency.exponentialRampToValueAtTime(45, now + off + 0.12);
        g.gain.setValueAtTime(0.0001, now + off);
        g.gain.exponentialRampToValueAtTime(0.5, now + off + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.16);
        o.connect(g);
        g.connect(this.tablaGain);
        o.start(now + off);
        o.stop(now + off + 0.18);
      });
      setTimeout(beat, this.intensity > 0.7 ? 520 : 880);
    };
    beat();
  }

  conch() {
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(280, now);
    o.frequency.linearRampToValueAtTime(340, now + 1.4);
    f.type = "bandpass";
    f.frequency.value = 420;
    f.Q.value = 6;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.12, now + 0.4);
    g.gain.linearRampToValueAtTime(0.0001, now + 2.6);
    o.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start(now);
    o.stop(now + 2.7);
  }

  setMuted(isMuted) {
    this.master.gain.setTargetAtTime(isMuted ? 0 : 0.22, this.ctx.currentTime, 0.15);
  }
}

function clearTimers() {
  timers.forEach((id) => clearTimeout(id));
  timers = [];
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
}

function showShot(shot) {
  const el = document.createElement("div");
  el.className = `shot active ken-${shot.ken}`;
  el.style.setProperty("--dur", `${shot.duration}ms`);
  el.style.backgroundImage = `url("${shot.src}")`;
  shotsEl.appendChild(el);
  while (shotsEl.children.length > 2) {
    shotsEl.removeChild(shotsEl.firstChild);
  }
  later(() => {
    el.classList.remove("active");
  }, shot.duration - 80);
}

function playShots(scene) {
  let t = 0;
  scene.shots.forEach((shot, i) => {
    later(() => showShot(shot), t);
    t += shot.duration;
  });
}

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const hindi = voices.filter((v) => /hi(-|_)IN|hindi|हिन्दी|हिंदी/i.test(`${v.lang} ${v.name}`));
  return (
    hindi.find((v) => /male|hemant|ravi|prabhat/i.test(v.name)) ||
    hindi[0] ||
    voices.find((v) => /en-IN/i.test(v.lang)) ||
    null
  );
}

function speak(text) {
  window.speechSynthesis?.cancel();
  if (!text || muted) return;
  speechUtterance = new SpeechSynthesisUtterance(text);
  speechUtterance.lang = "hi-IN";
  const voice = pickVoice();
  if (voice) speechUtterance.voice = voice;
  speechUtterance.rate = 0.9;
  speechUtterance.pitch = 0.84;
  speechUtterance.volume = 1;
  window.speechSynthesis.speak(speechUtterance);
}

function elapsedFilm() {
  const done = SCENES.slice(0, sceneIndex).reduce((s, sc) => s + sc.duration, 0);
  return done + Math.min(Date.now() - sceneStartedAt, SCENES[sceneIndex].duration);
}

function tickProgress() {
  if (!started || paused) return;
  progressBar.style.width = `${(elapsedFilm() / totalMs) * 100}%`;
  requestAnimationFrame(tickProgress);
}

function playScene(index) {
  if (index >= SCENES.length) return finish();
  sceneIndex = index;
  const scene = SCENES[index];
  sceneStartedAt = Date.now();
  sceneLabel.textContent = scene.title;
  audio.setIntensity(scene.music);
  if (scene.conch) audio.conch();

  subtitlesEl.hidden = !scene.narration;
  subtitlesEl.textContent = scene.narration || "";

  playShots(scene);

  if (scene.extraNarration) {
    speak(scene.extraNarration);
    later(() => speak(scene.narration), 5500);
    later(() => {
      subtitlesEl.textContent = scene.narration;
    }, 5500);
    subtitlesEl.textContent = scene.extraNarration;
  } else {
    speak(scene.narration);
  }

  if (scene.finale) {
    later(() => {
      goldenFade.classList.add("show");
      speak("");
    }, 8800);
    later(() => {
      endCard.hidden = false;
      subtitlesEl.hidden = true;
      goldenFade.classList.remove("show");
    }, 10800);
  }

  later(() => playScene(index + 1), scene.duration);
}

function finish() {
  window.speechSynthesis?.cancel();
  endCard.hidden = false;
  subtitlesEl.hidden = true;
  sceneLabel.textContent = "जय जगन्नाथ";
  progressBar.style.width = "100%";
}

async function startFilm() {
  if (started) return;
  started = true;
  titleCard.hidden = true;
  document.getElementById("title-bg")?.remove();
  hud.hidden = false;
  audio = new SacredScore();
  await audio.ctx.resume();
  audio.start();
  playScene(0);
  tickProgress();
}

playBtn.addEventListener("click", startFilm);

pauseBtn.addEventListener("click", async () => {
  if (!started) return;
  paused = !paused;
  pauseBtn.textContent = paused ? "जारी रखें" : "विराम";
  if (paused) {
    elapsedBeforePause = Date.now() - sceneStartedAt;
    clearTimers();
    window.speechSynthesis?.pause();
    await audio.ctx.suspend();
  } else {
    await audio.ctx.resume();
    window.speechSynthesis?.resume();
    const remaining = SCENES[sceneIndex].duration - elapsedBeforePause;
    sceneStartedAt = Date.now() - elapsedBeforePause;
    later(() => playScene(sceneIndex + 1), remaining);
    tickProgress();
  }
});

muteBtn.addEventListener("click", () => {
  muted = !muted;
  muteBtn.textContent = muted ? "मौन" : "ध्वनि चालू";
  audio?.setMuted(muted);
  if (muted) window.speechSynthesis?.cancel();
});

SCENES.flatMap((s) => s.shots)
  .map((s) => s.src)
  .filter((src, i, arr) => arr.indexOf(src) === i)
  .forEach((src) => {
    const img = new Image();
    img.src = src;
  });

if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => pickVoice();
}
