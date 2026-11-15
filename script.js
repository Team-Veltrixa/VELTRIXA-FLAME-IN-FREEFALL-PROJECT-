/* VELTRIXA — shared site interactions. No frameworks, no API keys needed. */
document.addEventListener('DOMContentLoaded', () => {
  // Keep the navigation usable on smaller screens.
  const menuToggle = document.querySelector('.menu-toggle');
  const menu = document.querySelector('.main-nav');
  const closeMenu = () => {
    if (!menuToggle || !menu) return;
    menu.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation menu');
  };
  if (menuToggle && menu) {
    menuToggle.addEventListener('click', () => {
      const opening = !menu.classList.contains('is-open');
      menu.classList.toggle('is-open', opening);
      menuToggle.setAttribute('aria-expanded', String(opening));
      menuToggle.setAttribute('aria-label', opening ? 'Close navigation menu' : 'Open navigation menu');
    });
    menu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('click', event => {
      if (!menu.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
    });
    window.addEventListener('resize', () => { if (window.innerWidth > 850) closeMenu(); });
  }
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

  // Resource cards: category filters, URL category deep-link and live search.
  // Investigation data (data.js) drives the resource cards, the ranking and the AI sidebar.
  const D = window.VELTRIXA_DATA || { investigations: [], habitats: {}, goals: {} };
  // In-text citation whose parts each link straight to the NASA page they cite.
  const citeHtml = ids => {
    const parts = (ids || []).map(id => (D.sources || {})[id]).filter(Boolean)
      .map(s => `<a href="${s.url}" target="_blank" rel="noopener noreferrer" aria-label="${s.intext} (opens NASA source in a new tab)">${s.intext}</a>`);
    return parts.length ? `(${parts.join('; ')})` : '';
  };
  const resourceGrid = document.querySelector('#resource-grid');
  if (resourceGrid) {
    const frag = document.createDocumentFragment();
    D.investigations.forEach(inv => {
      const a = document.createElement('article');
      a.className = 'resource-card';
      a.dataset.category = 'datasets';
      a.dataset.keywords = [...inv.keys, ...inv.topics, inv.category, inv.platform].join(' ').toLowerCase();
      a.innerHTML = `<div class="resource-card-visual"><img src="assets/res-${inv.id}.webp" alt="" loading="lazy"></div>` +
        `<div class="resource-card-content"><div class="resource-card-copy"><h2><svg class="icon"><use href="#database"></use></svg>${inv.name}</h2><p>${inv.summary}</p><p class="cite">${citeHtml(inv.sources)}</p></div>` +
        `<a class="btn btn-small btn-primary" href="${inv.url}" target="_blank" rel="noopener noreferrer" aria-label="Explore ${inv.name} (opens in a new tab)">Explore <svg class="icon"><use href="#arrow-right"></use></svg></a></div>`;
      frag.appendChild(a);
    });
    resourceGrid.prepend(frag);
  }
  document.querySelectorAll('[data-cite]').forEach(el => { el.innerHTML = citeHtml(el.dataset.cite.split(';')); });
  const cards = [...document.querySelectorAll('.resource-card')];
  const filterButtons = [...document.querySelectorAll('[data-filter]')];
  const searchInput = document.querySelector('#resource-search');
  const emptyPanel = document.querySelector('#resource-empty');
  let activeCategory = 'all';

  function filterResources() {
    if (!cards.length) return;
    const query = (searchInput?.value || '').toLocaleLowerCase().trim();
    let visibleCount = 0;
    cards.forEach(card => {
      const inCategory = activeCategory === 'all' || card.dataset.category === activeCategory;
      const searchableText = (card.innerText + ' ' + (card.dataset.keywords || '')).toLocaleLowerCase();
      const visible = inCategory && searchableText.includes(query);
      card.hidden = !visible;
      if (visible) visibleCount++;
    });
    if (emptyPanel) emptyPanel.hidden = visibleCount !== 0;
  }
  function selectCategory(category, updateUrl = false) {
    const categories = ['all', 'datasets', 'guides'];
    activeCategory = categories.includes(category) ? category : 'all';
    filterButtons.forEach(button => {
      const selected = button.dataset.filter === activeCategory;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (updateUrl) {
      const url = new URL(window.location.href);
      if (activeCategory === 'all') url.searchParams.delete('category');
      else url.searchParams.set('category', activeCategory);
      history.replaceState({}, '', url);
    }
    filterResources();
  }
  if (cards.length) {
    const savedCategory = new URLSearchParams(window.location.search).get('category') || 'all';
    selectCategory(savedCategory);
    filterButtons.forEach(button => button.addEventListener('click', () => selectCategory(button.dataset.filter, true)));
    searchInput?.addEventListener('input', filterResources);
    document.querySelector('#reset-filters')?.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      selectCategory('all', true);
      searchInput?.focus();
    });

    if (window.location.hash === '#resource-search' && searchInput) {
      requestAnimationFrame(() => {
        searchInput.focus();
        searchInput.closest('.resource-search')?.classList.add('is-attention');
        window.setTimeout(() => searchInput.closest('.resource-search')?.classList.remove('is-attention'), 2200);
      });
    }
  }

  // Cabin safety check: users enter conditions and the page rates them.
  // Thresholds are simplified screening limits (see the note under the panel), not NASA PSI values.
  const environmentButtons = [...document.querySelectorAll('[data-environment]')];
  const PRESETS = {
    'earth-air':    { o2: 20.9, pressure: 101.3, gravity: 1,        airflow: 4,   temp: 21, co: 0 },
    'artemis-moon': { o2: 34,   pressure: 56.5,  gravity: 0.1654,   airflow: 7,   temp: 22, co: 2 },
    'pure-oxygen':  { o2: 100,  pressure: 98.4,  gravity: 1,        airflow: 9,   temp: 22, co: 1 }
  };
  const FIELDS = ['o2', 'pressure', 'gravity', 'airflow', 'temp', 'co'];
  const inputs = Object.fromEntries(FIELDS.map(key => [key, document.querySelector(`#in-${key}`)]));
  const LEVELS = ['nominal', 'caution', 'unsafe'];
  const LEVEL_LABEL = { nominal: 'SAFE', caution: 'CAUTION', unsafe: 'UNSAFE' };
  const KPA_PER_PSI = 6.89476;
  const MOON_BASE_MAX_KPA = 10.2 * KPA_PER_PSI; // ~70.3 kPa
  const SUIT_KPA = 4.3 * KPA_PER_PSI;           // ~29.6 kPa

  function assess(v) {
    const ppO2 = v.o2 / 100 * v.pressure;
    const factors = [];
    const add = (name, level, text) => factors.push({ name, level, text });

    // Fire hazard from oxygen fraction (flammability rises steeply with O2 fraction).
    if (v.o2 <= 24) add('Oxygen fire risk', 'nominal', `${v.o2.toFixed(1)}% O₂ is within the range of normal cabin air (Earth air is 20.9%).`);
    else if (v.o2 <= 30) add('Oxygen fire risk', 'caution', `${v.o2.toFixed(1)}% O₂ is above normal cabin air. Materials ignite more easily and flames spread faster.`);
    else if (v.o2 <= 50 && v.pressure <= MOON_BASE_MAX_KPA) add('Oxygen fire risk', 'caution', `${v.o2.toFixed(1)}% O₂ is at or above the ~30% expected for lunar habitats. Acceptable only at low pressure (≤ 10.2 psi) with strict material control.`);
    else add('Oxygen fire risk', 'unsafe', v.o2 > 50
      ? `${v.o2.toFixed(1)}% O₂ is beyond the lunar habitat range. Most common materials, including metals and textiles, burn readily.`
      : `${v.o2.toFixed(1)}% O₂ at ${v.pressure.toFixed(1)} kPa is above ~30% O₂ at full pressure. Flammability is much higher than Earth air; lower the pressure to 10.2 psi or less.`);

    // Breathability from oxygen partial pressure.
    if (ppO2 < 16) add('Breathable oxygen', 'unsafe', `Oxygen partial pressure of ${ppO2.toFixed(1)} kPa is below ~16 kPa. Hypoxia risk.`);
    else if (ppO2 < 19) add('Breathable oxygen', 'caution', `Oxygen partial pressure of ${ppO2.toFixed(1)} kPa is low (Earth sea level is 21.2 kPa). Reduced performance is possible.`);
    else if (ppO2 <= 50) add('Breathable oxygen', 'nominal', `Oxygen partial pressure of ${ppO2.toFixed(1)} kPa is breathable.`);
    else if (ppO2 <= 100) add('Breathable oxygen', 'caution', `Oxygen partial pressure of ${ppO2.toFixed(1)} kPa is high. Long exposure risks oxygen toxicity.`);
    else add('Breathable oxygen', 'unsafe', `Oxygen partial pressure of ${ppO2.toFixed(1)} kPa is dangerously high. Oxygen toxicity and extreme fire risk.`);

    // Total pressure.
    if (v.pressure < SUIT_KPA) add('Total pressure', 'unsafe', `${v.pressure.toFixed(1)} kPa is below spacesuit pressure (4.3 psi, ${SUIT_KPA.toFixed(1)} kPa). Not habitable without a pressure suit.`);
    else if (v.pressure > 110) add('Total pressure', 'caution', `${v.pressure.toFixed(1)} kPa is above sea-level pressure (101.3 kPa). It raises oxygen partial pressure and fire risk.`);
    else add('Total pressure', 'nominal', `${v.pressure.toFixed(1)} kPa (${(v.pressure / KPA_PER_PSI).toFixed(1)} psi) is within the habitable range.`);

    // Airflow: forced flow supplies oxidizer to a flame.
    if (v.o2 > 24 && v.airflow > 10) add('Airflow', 'caution', `${v.airflow.toFixed(1)} cm/s of flow in an oxygen-enriched cabin feeds flames. Low-speed flow tests (SPICE, BASS) show flow changes flame spread and extinction.`);
    else if (v.airflow > 100) add('Airflow', 'caution', `${v.airflow.toFixed(1)} cm/s is a strong draft that can spread a fire quickly.`);
    else add('Airflow', 'nominal', `${v.airflow.toFixed(1)} cm/s is a modest ventilation level.`);

    // Gravity: informational coverage, escalates only for the evidence gap (not a hazard rating).
    if (v.gravity < 0.01) add('Gravity', 'nominal', 'Microgravity. Flames are rounder and cooler and smoke does not rise. Covered by PSI data (ACME, SAME, BASS, FLEX).');
    else if (v.gravity >= 0.99) add('Gravity', 'nominal', 'Earth gravity. Standard flammability test methods apply.');
    else add('Gravity', 'caution', 'Partial gravity. PSI has no partial-gravity combustion data yet, so microgravity and 1 g results are used as bounds.');

    // Temperature.
    if (v.temp < 5 || v.temp > 40) add('Temperature', 'unsafe', `${v.temp.toFixed(1)} °C is outside a survivable cabin range${v.temp > 40 ? ' and lowers the energy needed for ignition' : ''}.`);
    else if (v.temp < 18 || v.temp > 27) add('Temperature', 'caution', `${v.temp.toFixed(1)} °C is outside the usual cabin comfort range (18–27 °C).`);
    else add('Temperature', 'nominal', `${v.temp.toFixed(1)} °C is within the usual cabin range.`);

    // Carbon monoxide (NIOSH: 35 ppm 8-h limit, 200 ppm ceiling).
    if (v.co >= 200) add('Carbon monoxide', 'unsafe', `${v.co.toFixed(1)} ppm is at or above the 200 ppm ceiling limit. Possible combustion in progress.`);
    else if (v.co >= 35) add('Carbon monoxide', 'caution', `${v.co.toFixed(1)} ppm is above the 35 ppm 8-hour exposure limit. Look for a smouldering source.`);
    else add('Carbon monoxide', 'nominal', `${v.co.toFixed(1)} ppm is below exposure limits.`);

    const worst = Math.max(...factors.map(f => LEVELS.indexOf(f.level)));
    return { ppO2, factors, level: LEVELS[worst] };
  }

  const el = id => document.querySelector(id);
  const ranges = Object.fromEntries(FIELDS.map(key => [key, document.querySelector(`#rg-${key}`)]));
  let sweep = 'o2';
  let lastValues = null;
  let currentPreset = 'artemis-moon';
  const ICONS = {
    nominal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    caution: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.8 20h18.4L12 4Z"/><path d="M12 10v4.5M12 17.4v.1"/></svg>',
    unsafe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg>'
  };
  function readInputs() {
    const values = {};
    let ok = true;
    for (const key of FIELDS) {
      const input = inputs[key];
      const raw = input.value.trim();
      const num = Number(raw);
      const valid = raw !== '' && Number.isFinite(num) && num >= Number(input.min) && num <= Number(input.max);
      input.setAttribute('aria-invalid', String(!valid));
      input.closest('.field').classList.toggle('is-invalid', !valid);
      if (valid) values[key] = num; else ok = false;
    }
    return ok ? values : null;
  }

  // ---- Line graph: sweep one input, plot oxygen partial pressure, shade by overall verdict. ----
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CH = { w: 680, h: 280, l: 52, r: 18, t: 16, b: 44 };
  let chartResizeTimer = null;
  const SWEEPS = {
    o2:       { min: 0, max: 100, step: 1,   label: 'Oxygen concentration (%)', fmt: x => `${x.toFixed(0)}% O₂`,  sub: 'Oxygen partial pressure as oxygen concentration varies, with your other inputs held fixed.' },
    pressure: { min: 0, max: 150, step: 1.5, label: 'Total pressure (kPa)',     fmt: x => `${x.toFixed(0)} kPa`, sub: 'Oxygen partial pressure as total pressure varies, with your other inputs held fixed.' }
  };
  const svgEl = (name, attrs = {}, text) => {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const ppOf = (v, x) => (sweep === 'o2' ? x / 100 * v.pressure : v.o2 / 100 * x);
  function drawChart(values) {
    const svg = el('#safety-chart-svg');
    svg.replaceChildren();
    // Draw at the real pixel width so text stays readable on phones.
    CH.w = Math.max(300, Math.min(1000, Math.round(svg.parentElement.clientWidth || 680)));
    CH.h = CH.w < 520 ? 250 : 280;
    CH.l = CH.w < 520 ? 44 : 52;
    svg.setAttribute('viewBox', `0 0 ${CH.w} ${CH.h}`);
    if (!values) { svg.appendChild(svgEl('text', { x: CH.w / 2, y: CH.h / 2, 'text-anchor': 'middle', class: 'ch-empty' }, 'Enter valid values to see the graph')); return; }
    const cfg = SWEEPS[sweep];
    const pts = [];
    for (let x = cfg.min; x <= cfg.max + 1e-9; x += cfg.step) {
      pts.push({ x, y: ppOf(values, x), level: assess({ ...values, [sweep]: x }).level });
    }
    const yMax = Math.max(30, Math.ceil(Math.max(...pts.map(p => p.y)) / 10) * 10);
    const sx = x => CH.l + (x - cfg.min) / (cfg.max - cfg.min) * (CH.w - CH.l - CH.r);
    const sy = y => CH.h - CH.b - y / yMax * (CH.h - CH.b - CH.t);
    // zones
    // Merge neighbouring steps with the same verdict into one band (no seams).
    for (let i = 0; i < pts.length - 1;) {
      let k = i + 1;
      while (k < pts.length - 1 && pts[k].level === pts[i].level) k++;
      svg.appendChild(svgEl('rect', { x: sx(pts[i].x), y: CH.t, width: sx(pts[k].x) - sx(pts[i].x), height: CH.h - CH.b - CH.t, class: `zone ${pts[i].level}` }));
      i = k;
    }
    // grid + y axis
    const yStep = yMax <= 40 ? 10 : yMax <= 100 ? 20 : 25;
    for (let y = 0; y <= yMax; y += yStep) {
      svg.appendChild(svgEl('line', { x1: CH.l, x2: CH.w - CH.r, y1: sy(y), y2: sy(y), class: 'grid' }));
      svg.appendChild(svgEl('text', { x: CH.l - 8, y: sy(y) + 4, 'text-anchor': 'end', class: 'tick' }, String(y)));
    }
    const xTicks = sweep === 'o2' ? [0, 20, 40, 60, 80, 100] : [0, 30, 60, 90, 120, 150];
    xTicks.forEach(x => {
      svg.appendChild(svgEl('text', { x: sx(x), y: CH.h - CH.b + 18, 'text-anchor': 'middle', class: 'tick' }, String(x)));
    });
    svg.appendChild(svgEl('text', { x: (CH.l + CH.w - CH.r) / 2, y: CH.h - 6, 'text-anchor': 'middle', class: 'axis-title' }, cfg.label));
    svg.appendChild(svgEl('text', { x: 14, y: (CH.t + CH.h - CH.b) / 2, 'text-anchor': 'middle', class: 'axis-title', transform: `rotate(-90 14 ${(CH.t + CH.h - CH.b) / 2})` }, 'O₂ partial pressure (kPa)'));
    // hypoxia floor
    svg.appendChild(svgEl('line', { x1: CH.l, x2: CH.w - CH.r, y1: sy(16), y2: sy(16), class: 'ref' }));
    svg.appendChild(svgEl('text', { x: CH.w - CH.r - 4, y: sy(16) - 5, 'text-anchor': 'end', class: 'ref-label' }, 'Hypoxia limit 16 kPa'));
    // line
    svg.appendChild(svgEl('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' '), class: 'curve' }));
    // current marker
    const cx = sx(values[sweep]), cy = sy(ppOf(values, values[sweep]));
    svg.appendChild(svgEl('line', { x1: cx, x2: cx, y1: CH.t, y2: CH.h - CH.b, class: 'marker-line' }));
    svg.appendChild(svgEl('circle', { cx, cy, r: 7, class: 'marker' }));
    const flip = cx > CH.w - 140;
    svg.appendChild(svgEl('text', { x: cx + (flip ? -11 : 11), y: Math.max(CH.t + 12, cy - 11), 'text-anchor': flip ? 'end' : 'start', class: 'marker-label' }, `You: ${cfg.fmt(values[sweep])}`));
    // hover crosshair
    const hover = svgEl('g', { class: 'hover', visibility: 'hidden' });
    const hLine = svgEl('line', { y1: CH.t, y2: CH.h - CH.b, class: 'hover-line' });
    const hDot = svgEl('circle', { r: 4.5, class: 'hover-dot' });
    hover.append(hLine, hDot);
    svg.appendChild(hover);
    const hit = svgEl('rect', { x: CH.l, y: CH.t, width: CH.w - CH.l - CH.r, height: CH.h - CH.b - CH.t, fill: 'transparent' });
    const readout = el('#chart-readout');
    const move = event => {
      const box = svg.getBoundingClientRect();
      const px = (event.clientX - box.left) / box.width * CH.w;
      const x = Math.max(cfg.min, Math.min(cfg.max, cfg.min + (px - CH.l) / (CH.w - CH.l - CH.r) * (cfg.max - cfg.min)));
      const y = ppOf(values, x);
      const level = assess({ ...values, [sweep]: x }).level;
      hLine.setAttribute('x1', sx(x)); hLine.setAttribute('x2', sx(x));
      hDot.setAttribute('cx', sx(x)); hDot.setAttribute('cy', sy(y));
      hover.setAttribute('visibility', 'visible');
      readout.dataset.level = level;
      readout.textContent = `At ${cfg.fmt(x)}: O₂ partial pressure ${y.toFixed(1)} kPa, overall ${LEVEL_LABEL[level]}.`;
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); delete readout.dataset.level; readout.textContent = 'Hover or tap the graph to read a value.'; });
    svg.appendChild(hit);
    const here = assess(values);
    svg.setAttribute('aria-label', `Line graph of oxygen partial pressure against ${cfg.label}. Your input is ${cfg.fmt(values[sweep])} giving ${here.ppO2.toFixed(1)} kPa, rated ${LEVEL_LABEL[here.level]}.`);
  }

  function render() {
    const badge = el('#alarm-badge');
    const list = el('#safety-factors');
    const summary = el('#safety-summary');
    const verdict = el('#verdict');
    const values = readInputs();
    lastValues = values;
    // keep sliders in sync with typed numbers
    FIELDS.forEach(key => { if (document.activeElement !== ranges[key] && inputs[key].value !== '') ranges[key].value = inputs[key].value; });
    el('#chart-sub').textContent = SWEEPS[sweep].sub;
    if (!values) {
      badge.textContent = 'Check your inputs';
      verdict.dataset.level = 'caution';
      el('#verdict-icon').innerHTML = ICONS.caution;
      ['#out-ppo2', '#out-psi', '#out-ratio'].forEach(id => { el(id).textContent = '—'; });
      list.replaceChildren();
      summary.textContent = 'Every field needs a number within its allowed range (for example, oxygen 0–100%).';
      drawChart(null);
      return;
    }
    const result = assess(values);
    badge.textContent = LEVEL_LABEL[result.level];
    verdict.dataset.level = result.level;
    el('#verdict-icon').innerHTML = ICONS[result.level];
    el('#out-ppo2').textContent = result.ppO2.toFixed(1);
    el('#out-psi').textContent = (values.pressure / KPA_PER_PSI).toFixed(1);
    el('#out-ratio').textContent = (values.o2 / 20.9).toFixed(2);
    const flagged = result.factors.filter(f => f.level !== 'nominal');
    summary.textContent = result.level === 'nominal'
      ? 'Every factor checked is within the screening limits.'
      : `${result.level === 'unsafe' ? 'Not safe' : 'Proceed with care'}: ${flagged.map(f => f.name.toLowerCase()).join(', ')}.`;
    const ordered = [...result.factors].sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level));
    list.replaceChildren(...ordered.map(f => {
      const li = document.createElement('li');
      li.dataset.level = f.level;
      const tag = document.createElement('b');
      tag.textContent = LEVEL_LABEL[f.level];
      const name = document.createElement('strong');
      name.textContent = f.name;
      const text = document.createElement('span');
      text.textContent = f.text;
      li.append(tag, name, text);
      return li;
    }));
    drawChart(values);
  }
  function setPresetButtons(name) {
    environmentButtons.forEach(button => {
      const selected = !!name && button.dataset.environment === name;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    currentPreset = name;
    FIELDS.forEach(key => { inputs[key].value = preset[key]; });
    setPresetButtons(name);
    render();
  }
  if (inputs.o2) {
    environmentButtons.forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.environment)));
    el('#safety-form').addEventListener('input', event => {
      const target = event.target;
      const key = FIELDS.find(k => target === inputs[k] || target === ranges[k]);
      if (target === ranges[key]) inputs[key].value = target.value;
      setPresetButtons(null);
      render();
    });
    el('#safety-form').addEventListener('submit', event => event.preventDefault());
    el('#safety-reset').addEventListener('click', () => applyPreset(currentPreset));
    document.querySelectorAll('[data-sweep]').forEach(button => button.addEventListener('click', () => {
      sweep = button.dataset.sweep;
      document.querySelectorAll('[data-sweep]').forEach(b => { b.classList.toggle('is-selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
      render();
    }));
    applyPreset('artemis-moon');
    window.addEventListener('resize', () => {
      clearTimeout(chartResizeTimer);
      chartResizeTimer = setTimeout(() => drawChart(lastValues), 150);
    });
  }

  // The mockup's Watch Demo button opens an interactive 3-step platform preview.
  const dialog = document.querySelector('#demo-dialog');
  const demoSlides = [
    ['Explore space data', 'Discover how VELTRIXA connects you with NASA’s open resources in a simple, visual experience.'],
    ['Find the right resource', 'Use category filters and instant search to locate NASA datasets, APIs, development tools and learning materials.'],
    ['Meet the mission', 'Learn why our team is building an accessible space intelligence experience for the NASA hackathon.']
  ];
  let slide = 0;
  function updateSlide() {
    if (!dialog) return;
    dialog.querySelector('#demo-step-label').textContent = `0${slide + 1} / 03`;
    dialog.querySelector('#demo-title').textContent = demoSlides[slide][0];
    dialog.querySelector('#demo-description').textContent = demoSlides[slide][1];
    dialog.querySelectorAll('.demo-dots span').forEach((dot, index) => dot.classList.toggle('selected', index === slide));
    const nextButton = dialog.querySelector('[data-demo-next]');
    nextButton.innerHTML = slide === 2 ? 'Explore Resources <svg class="icon"><use href="#arrow-right"></use></svg>' : 'Next <svg class="icon"><use href="#arrow-right"></use></svg>';
  }
  document.querySelectorAll('[data-open-demo]').forEach(button => button.addEventListener('click', () => {
    if (!dialog) return;
    slide = 0;
    updateSlide();
    dialog.showModal();
  }));
  dialog?.querySelector('[data-demo-next]')?.addEventListener('click', () => {
    if (slide === 2) window.location.href = 'resources.html';
    else { slide++; updateSlide(); }
  });
  dialog?.querySelector('[data-close-demo]')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

  // Zero-trust AI sidebar: responses are limited to the local NASA safety corpus.
  const aiFab = document.querySelector('#ai-fab');
  const aiSidebar = document.querySelector('#ai-sidebar');
  const aiClose = document.querySelector('#ai-close');
  const aiForm = document.querySelector('#ai-form');
  const aiInput = document.querySelector('#ai-input');
  const aiChatWindow = document.querySelector('#ai-chat-window');
  
  const setAi = open => {
    if (!aiSidebar) return;
    aiSidebar.classList.toggle('is-open', open);
    aiSidebar.setAttribute('aria-hidden', String(!open));
    aiSidebar.toggleAttribute('inert', !open);
    if (open) aiInput?.focus(); else aiFab?.focus();
  };
  const toggleAi = () => setAi(!aiSidebar?.classList.contains('is-open'));
  aiFab?.addEventListener('click', toggleAi);
  aiClose?.addEventListener('click', () => setAi(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setAi(false); });

  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const TAG = ' [Source: NASA PSI list + team dataset]';
  const detail = i => `${i.name} (${i.platform}): ${i.summary} Fire-safety takeaway: ${i.insight} ${i.cite || ''} [offline mode: run backend/app.py for pandas analysis]`;
  const namesFor = goal => D.investigations.filter(i => i.goals.includes(goal)).map(i => i.name).join(', ');
  function getSecureResponse(query) {
    const q = query.toLocaleLowerCase();
    const test = keys => keys.some(k => new RegExp('\\b' + escRe(k) + '\\b').test(q));
    let hits = D.investigations.filter(i => test(i.keys));
    if (!hits.length) hits = D.investigations.filter(i => test(i.topics));
    if (hits.length === 1) return detail(hits[0]);
    if (hits.length > 1) {
      const exact = hits.filter(i => q.includes(i.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length);
      if (exact.length) return detail(exact[0]);
      return `${hits.length} related investigations: ` + hits.map(i => `${i.name} (${i.summary})`).join(' | ') + TAG;
    }
    if (/\b(rank|top|best|matter|relevant|lunar|moon|mars|rover)\b/.test(q)) {
      const habitat = /mars/.test(q) ? 'mars' : /rover/.test(q) ? 'rover' : /lunar|moon/.test(q) ? 'lunar' : rank.habitat;
      const top = ranked({ ...rank, habitat }).slice(0, 3);
      return `Top picks for ${D.habitats[habitat]} (${D.goals[rank.goal]}): ` + top.map((r, n) => `${n + 1}. ${r.inv.name} (score ${r.s.total})`).join(', ') + '. Scores use team-assigned relevance weights; see the ranking panel for the breakdown.' + TAG;
    }
    if (/smoke|detector|aerosol/.test(q)) return 'Smoke and aerosol sensing: ' + D.investigations.filter(i => i.category === 'smoke').map(detail).join(' ');
    if (/extinguish|suppress|equipment|control|mist/.test(q)) return 'Investigations informing next-generation controls and equipment: ' + namesFor('controls') + '. Fine-water-mist extinguishers from the ISS also have Earth applications.' + TAG;
    if (/model|predict|data|simulat/.test(q)) return 'Investigations that support predictive flammability and fire modeling: ' + namesFor('model') + '. Use the Export buttons in the ranking panel to download the current ranked table.' + TAG;
    if (/earth|spinoff|mining|firefighter|terrestrial/.test(q)) return 'Earth applications include fine water mist extinguishers, improved smoke detection, and firefighter protective clothing and air tanks (NASA technology spinoffs).';
    if (/\bmir\b|1997/.test(q)) return 'The 1997 Mir fire started in a solid-fuel oxygen generator and was a major spacecraft fire-safety lesson.';
    if (/apollo/.test(q)) return 'Apollo 1 (1967) showed the danger of a pure-oxygen cabin fire; Apollo 13 (1970) showed the need for redundant life-support systems.';
    return 'No match in the PSI dataset. Try an investigation name (ACME, BASS-II, FLEX, SAFFIRE, SAME, DAFT, CFI) or ask which investigations matter most for a lunar base, smoke detection, or flammability modeling.';
  }

  function addAiMessage(text, isUser) {
    if (!aiChatWindow) return;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isUser ? 'chat-user' : 'chat-bot'}`;
    bubble.textContent = text;
    aiChatWindow.appendChild(bubble);
    aiChatWindow.scrollTop = aiChatWindow.scrollHeight;
  }
  
  const aiStatus = document.querySelector('#ai-sidebar .ai-header .ai-status');
  async function askAi(query) {
    addAiMessage(query, true);
    let answer;
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query, habitat: rank.habitat, goal: rank.goal, env: rank.env }) });
      if (!res.ok) throw new Error('api ' + res.status);
      answer = (await res.json()).answer;
      if (aiStatus) aiStatus.innerHTML = '<span class="status-dot"></span> Online - pandas analysis engine';
    } catch (err) {
      answer = getSecureResponse(query);
      if (aiStatus) aiStatus.innerHTML = '<span class="status-dot"></span> Offline - static dataset mode';
    }
    addAiMessage(answer, false);
  }
  
  aiForm?.addEventListener('submit', event => {
    event.preventDefault();
    const query = aiInput?.value.trim();
    if (!query) return;
    askAi(query);
    aiForm.reset();
  });
  
  document.querySelectorAll('[data-ask]').forEach(button => button.addEventListener('click', () => {
    const query = button.getAttribute('data-ask');
    if (query) askAi(query);
  }));

  document.querySelectorAll('[data-year]').forEach(node => node.textContent = String(new Date().getFullYear()));
  // Relevance ranking dashboard (transparent score; weights live in data.js).
  const rankList = document.querySelector('#rank-list');
  const rank = { habitat: 'lunar', goal: 'all', env: 'artemis-moon' };
  try { Object.assign(rank, JSON.parse(sessionStorage.getItem('veltrixa-rank') || '{}')); } catch (e) { /* storage unavailable */ }
  const saveRank = () => { try { sessionStorage.setItem('veltrixa-rank', JSON.stringify(rank)); } catch (e) { /* ignore */ } };
  const O2BOOST = { 'earth-air': 0, 'artemis-moon': 3, 'pure-oxygen': 5 };
  const MAX_SCORE = 31;
  function scoreOf(inv, st) {
    const h = inv.rel[st.habitat] * 4;
    const g = st.goal === 'all' ? inv.goals.length * 2 : (inv.goals.includes(st.goal) ? 6 : 0);
    const o = inv.o2 ? O2BOOST[st.env] : 0;
    return { h, g, o, total: h + g + o };
  }
  function ranked(st = rank) {
    return D.investigations.map(inv => ({ inv, s: scoreOf(inv, st) })).sort((a, b) => b.s.total - a.s.total || a.inv.name.localeCompare(b.inv.name));
  }
  function renderRank() {
    if (!rankList) return;
    rankList.innerHTML = ranked().map((r, n) => `<li class="rank-item"><span class="rank-n">${n + 1}</span><div class="rank-body">` +
      `<div class="rank-top"><strong>${r.inv.name}</strong><span class="rank-tag">${r.inv.platform}</span>${r.inv.goals.map(g => `<span class="rank-tag goal">${D.goals[g]}</span>`).join('')}<a href="${r.inv.url}" target="_blank" rel="noopener noreferrer">Source</a></div>` +
      `<div class="rank-bar" role="img" aria-label="Score ${r.s.total} of ${MAX_SCORE}"><span style="width:${Math.round(r.s.total / MAX_SCORE * 100)}%"></span></div>` +
      `<p class="rank-score">Score ${r.s.total} = habitat ${r.s.h} + goal ${r.s.g} + O₂ ${r.s.o}</p>` +
      `<p>${r.inv.insight} <span class="rank-cite">${citeHtml(r.inv.sources)}</span></p><p class="rank-earth">On Earth: ${r.inv.earth}</p></div></li>`).join('');
  }
  function syncChips() {
    document.querySelectorAll('[data-habitat]').forEach(b => { const on = b.dataset.habitat === rank.habitat; b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('[data-goal]').forEach(b => { const on = b.dataset.goal === rank.goal; b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('[data-env]').forEach(b => { const on = b.dataset.env === rank.env; b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', String(on)); });
    saveRank();
  }
  if (rankList) {
    document.querySelectorAll('[data-habitat]').forEach(b => b.addEventListener('click', () => { rank.habitat = b.dataset.habitat; syncChips(); renderRank(); }));
    document.querySelectorAll('[data-goal]').forEach(b => b.addEventListener('click', () => { rank.goal = b.dataset.goal; syncChips(); renderRank(); }));
    document.querySelectorAll('[data-env]').forEach(b => b.addEventListener('click', () => { rank.env = b.dataset.env; syncChips(); renderRank(); }));
    const download = (name, type, text) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const rows = () => ranked().map((r, n) => ({ rank: n + 1, id: r.inv.id, name: r.inv.name, platform: r.inv.platform, category: r.inv.category,
      score: r.s.total, habitat: D.habitats[rank.habitat], goal_filter: D.goals[rank.goal], goals: r.inv.goals.join('; '), takeaway: r.inv.insight, earth_application: r.inv.earth, source: r.inv.url }));
    document.querySelector('#export-json')?.addEventListener('click', () => download('veltrixa-ranking.json', 'application/json', JSON.stringify(rows(), null, 2)));
    document.querySelector('#export-csv')?.addEventListener('click', () => {
      const data = rows(); const cols = Object.keys(data[0]);
      const cell = v => `"${String(v).replace(/"/g, '""')}"`;
      download('veltrixa-ranking.csv', 'text/csv', [cols.join(','), ...data.map(r => cols.map(c => cell(r[c])).join(','))].join('\n'));
    });
    syncChips(); renderRank();
  }
});