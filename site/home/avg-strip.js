// The header's average strip: WR, EXP, NETR and PF, each the mean over the scenarios shown (owner 2026-11-20)
// The header's average strip (owner 2026-11-20: "indikator performance ditempatkan di header aja, supaya tidak terlalu
// penuh"; "warnanya samakan dengan yang di nexus"): the simulated expectancy per plan of each exit scenario, coloured
// as Nexus colours R (above zero green, below rose, zero slate), linked to the Performance page. Shared by every page
// whose header carries the strip (#avg-strip); the managed exit only once the data says it is shown.
import { headline } from './track.js';

export function renderAvgStrip(body, doc = document) {
  const strip = doc.getElementById('avg-strip');
  const list = headline(body);
  if (!strip || !list.length) return;
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const items = list.map((a) => { const s = make('span', 'avg-item'); s.append(make('span', 'avg-k', a.code), make('b', a.tone ? `t-${a.tone}` : null, a.value)); return s; });
  strip.querySelector('.avg-vals').replaceChildren(...items);
  strip.setAttribute('aria-label', `Simulated average of the exit scenarios: ${list.map((a) => `${a.name} ${a.value}`).join(', ')}. Open the Performance page.`);
  strip.hidden = false;
}
