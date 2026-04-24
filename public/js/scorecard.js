// Render a scan result card into a container element.
// Buttons (save / share / rescan / delete) live in index.html and are wired by app.js.

import {
  loadEnumbersDB, lookupAdditive,
  computeAdditiveRating, getConditionWarnings, frequencyGuidance
} from './additives.js';

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

  // Additive traffic light — derived client-side from eNumbers + flags
  const rating = computeAdditiveRating(result);
  if (rating) card.appendChild(renderAdditiveRating(rating));

  // Condition-agnostic warnings — diabetes, hypertension, allergies, PKU, etc.
  const warnings = getConditionWarnings(result);
  if (warnings.length > 0) {
    card.appendChild(sectionTitle('Heads-up for'));
    const chips = el('div', 'condition-chips');
    for (const w of warnings) {
      const chip = el('span', `condition-chip sev-${w.severity || 'medium'}`);
      chip.textContent = w.label;
      if (w.reason) chip.title = w.reason;
      chips.appendChild(chip);
    }
    card.appendChild(chips);

    const details = el('div', 'condition-details');
    for (const w of warnings) {
      if (!w.reason) continue;
      const p = el('p', 'condition-line');
      p.textContent = `• ${w.label} — ${w.reason}`;
      details.appendChild(p);
    }
    card.appendChild(details);
  }

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
    card.appendChild(sectionTitle('E-numbers / additives'));
    const list = el('ul', 'enumbers');
    for (const e of result.eNumbers) {
      list.appendChild(renderEnumberItem(e));
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

  // Async enrichment — upgrade rating + condition chips + E-number detail
  // once the static DB has loaded. We render immediately with what the AI
  // returned; the reference data adds the "read more" health context.
  loadEnumbersDB().then((db) => enrich(container, result, db)).catch(() => {});
}

function renderAdditiveRating(rating) {
  const wrap = el('div', `additive-rating rating-${rating.level}`);
  const dot = el('span', 'additive-dot');
  const text = el('div', 'additive-text');
  const title = el('div', 'additive-title');
  title.textContent = rating.label;
  const detail = el('div', 'additive-detail');
  detail.textContent = rating.detail;
  text.appendChild(title);
  text.appendChild(detail);
  wrap.appendChild(dot);
  wrap.appendChild(text);
  return wrap;
}

function renderEnumberItem(e, dbEntry = null) {
  const li = el('li');
  li.dataset.code = (e.code || '').toUpperCase();

  const head = el('div', 'enumber-head');
  const name = el('span');
  name.textContent = `${e.code} — ${e.name}`;
  const concern = el('span', `enumber-concern ${e.concern || 'low'}`);
  concern.textContent = e.concern || 'low';
  head.appendChild(name);
  head.appendChild(concern);
  li.appendChild(head);

  const panel = el('div', 'enumber-panel');
  panel.hidden = true;

  if (e.note) {
    const note = el('p', 'enumber-note');
    note.textContent = e.note;
    panel.appendChild(note);
  }

  if (dbEntry) {
    panel.appendChild(renderDbDetail(dbEntry, e.concern));
  }

  li.appendChild(panel);

  head.addEventListener('click', () => { panel.hidden = !panel.hidden; });

  return li;
}

function renderDbDetail(ref, aiConcern) {
  const wrap = el('div', 'enumber-detail');

  if (ref.what) {
    wrap.appendChild(detailRow('About', ref.what));
  }
  if (ref.smallDose) {
    wrap.appendChild(detailRow('Small amounts', ref.smallDose));
  }
  if (ref.largeDose) {
    wrap.appendChild(detailRow('Daily / heavy use', ref.largeDose));
  }

  const guide = frequencyGuidance(ref.concern || aiConcern);
  if (guide) wrap.appendChild(detailRow('Consumption', guide));

  if (Array.isArray(ref.conditions) && ref.conditions.length > 0) {
    const lbl = el('div', 'enumber-detail-label');
    lbl.textContent = 'Relevant for';
    wrap.appendChild(lbl);
    const chips = el('div', 'condition-chips');
    for (const cond of ref.conditions) {
      const chip = el('span', 'condition-chip sev-medium');
      chip.textContent = humanizeCondition(cond);
      chips.appendChild(chip);
    }
    wrap.appendChild(chips);
  }

  return wrap;
}

function detailRow(label, text) {
  const row = el('div', 'enumber-detail-row');
  const lbl = el('div', 'enumber-detail-label');
  lbl.textContent = label;
  const val = el('p', 'enumber-detail-text');
  val.textContent = text;
  row.appendChild(lbl);
  row.appendChild(val);
  return row;
}

function humanizeCondition(key) {
  const map = {
    diabetes: 'Diabetes',
    hypertension: 'Hypertension',
    hypotension: 'Low blood pressure',
    pku: 'PKU',
    sulfite_sensitivity: 'Sulfite sensitivity',
    adhd_children: 'ADHD-sensitive children',
    kidney: 'Kidney disease',
    thyroid: 'Thyroid',
    ibs: 'IBS / sensitive gut',
    migraine: 'Migraine-prone'
  };
  return map[key] || key;
}

function enrich(container, result, db) {
  if (!db) return;

  // Re-render the additive rating with DB-informed concerns mixed in.
  const rating = computeAdditiveRating(result, db);
  const existingRating = container.querySelector('.additive-rating');
  if (rating && existingRating) {
    const fresh = renderAdditiveRating(rating);
    existingRating.replaceWith(fresh);
  }

  // Merge DB condition tags into the warnings section.
  const fullWarnings = getConditionWarnings(result, db);
  const warningsTitle = [...container.querySelectorAll('.section-title')]
    .find((n) => n.textContent === 'Heads-up for');
  if (fullWarnings.length > 0) {
    if (warningsTitle) {
      const chipsEl = warningsTitle.nextElementSibling;
      const detailsEl = chipsEl?.nextElementSibling;
      if (chipsEl && chipsEl.classList.contains('condition-chips')) {
        chipsEl.innerHTML = '';
        for (const w of fullWarnings) {
          const chip = el('span', `condition-chip sev-${w.severity || 'medium'}`);
          chip.textContent = w.label;
          if (w.reason) chip.title = w.reason;
          chipsEl.appendChild(chip);
        }
      }
      if (detailsEl && detailsEl.classList.contains('condition-details')) {
        detailsEl.innerHTML = '';
        for (const w of fullWarnings) {
          if (!w.reason) continue;
          const p = el('p', 'condition-line');
          p.textContent = `• ${w.label} — ${w.reason}`;
          detailsEl.appendChild(p);
        }
      }
    } else {
      // Condition section wasn't rendered initially — DB surfaced new tags.
      // Inject it right before the Red flags title, or at the end if none.
      const title = sectionTitle('Heads-up for');
      const chipsEl = el('div', 'condition-chips');
      const detailsEl = el('div', 'condition-details');
      for (const w of fullWarnings) {
        const chip = el('span', `condition-chip sev-${w.severity || 'medium'}`);
        chip.textContent = w.label;
        if (w.reason) chip.title = w.reason;
        chipsEl.appendChild(chip);
        if (w.reason) {
          const p = el('p', 'condition-line');
          p.textContent = `• ${w.label} — ${w.reason}`;
          detailsEl.appendChild(p);
        }
      }
      const scorecard = container.querySelector('.scorecard');
      const anchor = [...scorecard.querySelectorAll('.section-title')]
        .find((n) => n.textContent === 'Red flags' || n.textContent === 'E-numbers / additives');
      if (anchor) {
        scorecard.insertBefore(title, anchor);
        scorecard.insertBefore(chipsEl, anchor);
        scorecard.insertBefore(detailsEl, anchor);
      } else {
        scorecard.appendChild(title);
        scorecard.appendChild(chipsEl);
        scorecard.appendChild(detailsEl);
      }
    }
  }

  // Inject "read more" detail into each E-number list item.
  for (const li of container.querySelectorAll('.enumbers li')) {
    const code = li.dataset.code;
    const ref = lookupAdditive(db, code);
    if (!ref) continue;
    const panel = li.querySelector('.enumber-panel');
    if (!panel || panel.querySelector('.enumber-detail')) continue;
    const aiConcern = li.querySelector('.enumber-concern')?.textContent;
    panel.appendChild(renderDbDetail(ref, aiConcern));
  }
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
