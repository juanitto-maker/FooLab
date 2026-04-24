// Render a scan result card into a container element.
// Buttons (save / share / rescan / delete) live in index.html and are wired by app.js.

const RED_FLAG_LABELS = {
  palmOil: 'Palm oil',
  transFat: 'Trans fat',
  highSugar: 'High sugar',
  highSalt: 'High salt',
  highSatFat: 'High sat fat',
  artificialColor: 'Artificial color',
  preservative: 'Preservative',
  sweetener: 'Sweetener',
  msg: 'MSG',
  bhaBht: 'BHA/BHT',
  ultraProcessed: 'Ultra-processed',
  allergen: 'Allergen'
};

const NUTRITION_ROWS = [
  ['energyKcal', 'Energy', 'kcal'],
  ['sugar',      'Sugar',  'g'],
  ['satFat',     'Sat fat','g'],
  ['salt',       'Salt',   'g'],
  ['fiber',      'Fiber',  'g'],
  ['protein',    'Protein','g']
];

export function renderScorecard(result, photoBlob, container) {
  container.innerHTML = '';

  if (result?.notReadable) {
    container.appendChild(renderUnreadable(result));
    return;
  }

  const card = el('div', 'scorecard');

  const letter = (result.nutriScore || 'C').toUpperCase();
  const ns = el('div', `ns-letter ns-${letter}`);
  ns.textContent = letter;
  card.appendChild(ns);

  const head = el('div', 'product-head');
  const name = el('h2');
  name.textContent = result.productName || 'Unknown product';
  head.appendChild(name);
  if (result.brand) {
    const brand = el('div', 'product-brand');
    brand.textContent = result.brand;
    head.appendChild(brand);
  }
  if (result.summary) {
    const sum = el('p', 'product-summary');
    sum.textContent = result.summary;
    head.appendChild(sum);
  }
  card.appendChild(head);

  const scoreLine = el('div', 'score-line');
  scoreLine.innerHTML = `
    <span>Health score</span>
    <span class="big">${clampNum(result.healthScore)} / 100</span>
  `;
  card.appendChild(scoreLine);

  if (Array.isArray(result.redFlags) && result.redFlags.length > 0) {
    card.appendChild(sectionTitle('Red flags'));
    const chips = el('div', 'chips');
    for (const flag of result.redFlags) {
      const sev = flag.severity || 'medium';
      const chip = el('span', `chip chip-${sev}`);
      chip.textContent = RED_FLAG_LABELS[flag.type] || flag.type;
      if (flag.detail) chip.title = flag.detail;
      chips.appendChild(chip);
    }
    card.appendChild(chips);

    const details = el('div');
    details.style.marginTop = '10px';
    for (const flag of result.redFlags) {
      if (!flag.detail) continue;
      const p = el('p');
      p.style.fontSize = '14px';
      p.style.color = 'var(--ink-2)';
      p.style.margin = '4px 0';
      p.textContent = `• ${flag.detail}`;
      details.appendChild(p);
    }
    card.appendChild(details);
  }

  if (Array.isArray(result.eNumbers) && result.eNumbers.length > 0) {
    card.appendChild(sectionTitle('E-numbers'));
    const list = el('ul', 'enumbers');
    for (const e of result.eNumbers) {
      const li = el('li');
      const head = el('div', 'enumber-head');
      const name = el('span');
      name.textContent = `${e.code} — ${e.name}`;
      const concern = el('span', `enumber-concern ${e.concern || 'low'}`);
      concern.textContent = e.concern || 'low';
      head.appendChild(name);
      head.appendChild(concern);
      li.appendChild(head);
      if (e.note) {
        const note = el('p', 'enumber-note');
        note.textContent = e.note;
        note.hidden = true;
        li.appendChild(note);
        head.addEventListener('click', () => { note.hidden = !note.hidden; });
      }
      list.appendChild(li);
    }
    card.appendChild(list);
  }

  if (Array.isArray(result.ingredients) && result.ingredients.length > 0) {
    card.appendChild(sectionTitle('Ingredients'));
    const p = el('p', 'ingredients-list');
    p.textContent = result.ingredients.join(', ');
    card.appendChild(p);
  }

  if (result.nutrition && hasAnyNutrition(result.nutrition)) {
    card.appendChild(sectionTitle(`Nutrition (per ${result.nutrition.per || '100g'})`));
    const table = el('table', 'nutrition-table');
    for (const [key, label, unit] of NUTRITION_ROWS) {
      const v = result.nutrition[key];
      if (v == null) continue;
      const tr = el('tr');
      const td1 = el('td'); td1.textContent = label;
      const td2 = el('td'); td2.textContent = `${round1(v)} ${unit}`;
      tr.appendChild(td1); tr.appendChild(td2);
      table.appendChild(tr);
    }
    card.appendChild(table);
  }

  if (Array.isArray(result.allergens) && result.allergens.length > 0) {
    card.appendChild(sectionTitle('Allergens'));
    const chips = el('div', 'chips');
    for (const a of result.allergens) {
      const chip = el('span', 'chip chip-low');
      chip.textContent = a;
      chips.appendChild(chip);
    }
    card.appendChild(chips);
  }

  if (result.tips) {
    card.appendChild(sectionTitle('Tips'));
    const p = el('p');
    p.textContent = result.tips;
    card.appendChild(p);
  }

  const conf = el('span', 'confidence-badge');
  conf.textContent = `Confidence: ${result.confidence || 'medium'}`;
  card.appendChild(conf);

  container.appendChild(card);
}

function renderUnreadable(result) {
  const card = el('div', 'scorecard');
  const h = el('h2');
  h.textContent = 'Could not read the label';
  card.appendChild(h);
  const p = el('p');
  p.textContent = result.reason || 'Try a closer, better-lit photo.';
  card.appendChild(p);
  return card;
}

function sectionTitle(text) {
  const h = el('h3', 'section-title');
  h.textContent = text;
  return h;
}

function hasAnyNutrition(n) {
  return NUTRITION_ROWS.some(([k]) => n[k] != null);
}

function round1(v) {
  const num = Number(v);
  if (!Number.isFinite(num)) return v;
  return Math.round(num * 10) / 10;
}

function clampNum(v) {
  const num = Number(v);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
