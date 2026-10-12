// ══ CATALOG MAP (Settings → Catalogs → Catalog Map) ═══════════════════════════
// Every catalog entry as a tile, grouped by category and sized by how many
// records and settings use it (loadLookups' `uses`, the same count that guards
// the delete button). Dashed tiles are unused; linked tiles have names that
// look alike after normalizing case, spacing, punctuation and Arabic letter
// forms, so they may be one thing typed twice. Read-only: a tile opens its
// category in Settings (or the client), and a look-alike pair in a mergeable
// category offers the existing Merge flow.

let catalogMapFilter = 'all';   // all | unused | alike
let catalogMapData = null;      // [{ tab, items, pairs }] from the last draw

const CATALOG_MAP_FILTERS = [['all', 'layout-dashboard', 'All'], ['unused', 'ban', 'Unused'], ['alike', 'copy', 'Look-alikes']];

// Lower-case, no accents or tashkeel, one form of alef/ta marbuta/ya, letters
// and digits only — "Acme Co." and "ACME-co" both become "acmeco".
function catalogNorm(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯؐ-ًؚ-ٰٟ]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[^a-z0-9ء-ي٠-٩]+/g, '');
}

// Edit distance, giving up once it passes `max`.
function catalogEditDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Why two normalized names look alike, or '' when they don't.
function catalogAlikeReason(a, b) {
  if (a.length < 3 || b.length < 3) return a && a === b ? 'same' : '';
  if (a === b) return 'same';
  // Names that differ only in their numbers ("Server 1" / "Server 2") are a
  // series, not a typo.
  const digitless = s => s.replace(/[0-9٠-٩]/g, '');
  if (digitless(a) === digitless(b)) return '';
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // Short names sit one letter apart by chance (Arabic ones especially), so
  // a typo needs 6+ letters for one edit and 10+ for two.
  const max = short.length >= 10 ? 2 : short.length >= 6 ? 1 : 0;
  // One name containing the other ("Quotation" / "Quotation Approval") is
  // deliberately not a match: in real catalogs that is nearly always two
  // different things.
  if (max && catalogEditDistance(short, long, max) <= max) return 'typo';
  return '';
}

// Names only, never codes: codes are generated in series (CL-01, CL-02…),
// so any two of them look alike.
function catalogNames(category, o) {
  const raw = [o.label, o.nameEn, o.nameAr];
  return [...new Set(raw.map(catalogNorm).filter(Boolean))];
}

// Look-alike pairs within one category, the busier entry first in each pair.
function catalogLookAlikes(category, items) {
  const names = items.map(o => catalogNames(category, o));
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      let reason = '';
      for (const a of names[i]) {
        for (const b of names[j]) { reason = catalogAlikeReason(a, b); if (reason) break; }
        if (reason) break;
      }
      if (!reason) continue;
      const [x, y] = (items[j].uses || 0) > (items[i].uses || 0) ? [items[j], items[i]] : [items[i], items[j]];
      pairs.push({ a: x, b: y, reason });
    }
  }
  return pairs;
}

function catalogEntryName(category, o) {
  return (category === 'COMPANY' ? companyDisplayName(o) : lookupDisplayName(o)) || o.code;
}

function catalogUsesText(n) {
  if (!n) return window.ctI18n?.t('Unused') || 'Unused';
  if (n === 1) return window.ctI18n?.t('1 use') || '1 use';
  return window.ctI18n?.t('{n} uses', { n }) || n + ' uses';
}

async function runCatalogMap() {
  const host = document.getElementById('maint-catalog-map');
  host.innerHTML = '<div class="maint-empty">Counting…</div>';
  let fresh;
  try { fresh = await window.api.loadLookups(); }
  catch { host.innerHTML = '<div class="maint-empty">Could not read the catalog.</div>'; return; }
  catalogMapData = SETTINGS_CATALOG_TABS
    .map(tab => {
      const items = (fresh.categories?.[tab.category] || []).slice()
        .sort((x, y) => (y.uses || 0) - (x.uses || 0) || catalogEntryName(tab.category, x).localeCompare(catalogEntryName(tab.category, y)));
      const dismissed = new Set(uiState.catalogMapDismissed || []);
      const pairs = catalogLookAlikes(tab.category, items).filter(p => !dismissed.has(catalogPairKey(tab.category, p)));
      return { tab, items, pairs };
    })
    .filter(g => g.items.length);
  drawCatalogMap();
}

// A pair you have said is not a duplicate stays hidden: remembered by the two
// entry ids in this account's saved UI state, so a rename never revives it
// under a different key and nothing in the catalog itself changes.
function catalogPairKey(category, p) {
  return category + ':' + Math.min(p.a.id, p.b.id) + '-' + Math.max(p.a.id, p.b.id);
}
function dismissCatalogPair(category, p) {
  const key = catalogPairKey(category, p);
  uiState.catalogMapDismissed = [...new Set([...(uiState.catalogMapDismissed || []), key])];
  saveUiStateDebounced();
  catalogMapData.forEach(g => { if (g.tab.category === category) g.pairs = g.pairs.filter(x => x !== p); });
  drawCatalogMap();
  toast('Pair hidden', { actionLabel: 'Undo', onAction: () => {
    uiState.catalogMapDismissed = (uiState.catalogMapDismissed || []).filter(k => k !== key);
    saveUiStateDebounced();
    runCatalogMap();
  } });
}

function setCatalogMapFilter(filter) {
  catalogMapFilter = filter;
  drawCatalogMap();
}

function drawCatalogMap() {
  const host = document.getElementById('maint-catalog-map');
  if (!host || !catalogMapData) return;
  host.innerHTML = '';
  const all = catalogMapData.flatMap(g => g.items);
  const unused = all.filter(o => !o.uses).length;
  const pairCount = catalogMapData.reduce((n, g) => n + g.pairs.length, 0);

  const bar = pjMk('div', 'cat-map-bar');
  const stats = pjMk('div', 'cat-map-stats');
  [[all.length, 'Entries', ''], [unused, 'Unused', 'is-unused'], [pairCount, 'Look-alike pairs', 'is-alike']].forEach(([n, label, cls]) => {
    const s = pjMk('div', 'cat-map-stat ' + cls);
    s.appendChild(pjMk('strong', null, String(n)));
    s.appendChild(pjMk('span', null, label));
    stats.appendChild(s);
  });
  bar.appendChild(stats);
  const seg = pjMk('div', 'seg-ctl');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Show entries');
  CATALOG_MAP_FILTERS.forEach(([key, icon, label]) => {
    const b = pjMk('button', 'seg-btn' + (catalogMapFilter === key ? ' active' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(catalogMapFilter === key));
    b.innerHTML = ic(icon);
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', () => setCatalogMapFilter(key));
    seg.appendChild(b);
  });
  bar.appendChild(seg);
  host.appendChild(bar);

  const legend = pjMk('div', 'cat-map-legend');
  [['is-used', 'Size = how many records use it'], ['is-unused', 'Unused — can be deleted in Settings'],
    ['is-alike', 'Looks like another entry'], ['is-hidden', 'Hidden from dropdowns']].forEach(([cls, label]) => {
    const item = pjMk('span', 'cat-map-legend-item');
    item.appendChild(pjMk('span', 'cat-map-swatch ' + cls));
    item.appendChild(pjMk('span', null, label));
    legend.appendChild(item);
  });
  host.appendChild(legend);

  const tip = pjMk('div', 'cat-map-tip');
  tip.hidden = true;
  tip.setAttribute('role', 'tooltip');
  host.appendChild(tip);

  let shown = 0;
  catalogMapData.forEach(group => {
    const { tab, items, pairs } = group;
    const twins = new Map();   // id -> [{ other, reason }]
    pairs.forEach(p => {
      if (!twins.has(p.a.id)) twins.set(p.a.id, []);
      if (!twins.has(p.b.id)) twins.set(p.b.id, []);
      twins.get(p.a.id).push({ other: p.b, reason: p.reason });
      twins.get(p.b.id).push({ other: p.a, reason: p.reason });
    });
    const visible = items.filter(o => catalogMapFilter === 'all'
      || (catalogMapFilter === 'unused' && !o.uses)
      || (catalogMapFilter === 'alike' && twins.has(o.id)));
    if (!visible.length) return;
    shown++;

    const block = pjMk('section', 'cat-map-group');
    const head = pjMk('div', 'cat-map-group-head');
    const title = pjMk('div', 'cat-map-group-title');
    title.innerHTML = ic(tab.icon);
    title.appendChild(pjMk('span', null, tab.label));
    head.appendChild(title);
    const groupUnused = items.filter(o => !o.uses).length;
    const meta = [window.ctI18n?.t('{n} entries', { n: items.length }) || items.length + ' entries'];
    if (groupUnused) meta.push(window.ctI18n?.t('{n} unused', { n: groupUnused }) || groupUnused + ' unused');
    if (pairs.length) meta.push(window.ctI18n?.t('{n} look-alike', { n: pairs.length }) || pairs.length + ' look-alike');
    head.appendChild(pjMk('span', 'cat-map-group-meta', meta.join(' · ')));
    const open = pjMk('button', 'btn');
    open.type = 'button';
    open.innerHTML = ic('external-link');
    open.appendChild(document.createTextNode(tab.category === 'COMPANY' ? 'Open Clients' : 'Open in Settings'));
    open.addEventListener('click', () => catalogMapOpen(tab));
    head.appendChild(open);
    block.appendChild(head);

    // Sizes are relative within a category: a status used by every task and a
    // currency used twice are different scales, and the job here is spotting
    // the small and the empty next to their own siblings.
    const max = Math.max(1, ...items.map(o => o.uses || 0));
    const tiles = pjMk('div', 'cat-map-tiles');
    const tileById = new Map();
    visible.forEach(o => {
      const t = o.uses ? Math.sqrt(o.uses / max) : 0;
      const tile = pjMk('button', 'cat-map-tile' + (o.uses ? ' is-used' : ' is-unused')
        + (twins.has(o.id) ? ' is-alike' : '') + (o.isActive === false ? ' is-hidden' : ''));
      tile.type = 'button';
      tile.style.setProperty('--t', t.toFixed(3));
      const name = pjMk('span', 'cat-map-tile-name', catalogEntryName(tab.category, o));
      name.dataset.userContent = '';
      tile.appendChild(name);
      tile.appendChild(pjMk('span', 'cat-map-tile-count', o.uses ? String(o.uses) : '0'));
      if (twins.has(o.id)) tile.insertAdjacentHTML('afterbegin', ic('copy', 'cat-map-tile-badge'));
      tile.setAttribute('aria-label', catalogEntryName(tab.category, o) + ' — ' + catalogUsesText(o.uses));
      tile.addEventListener('mouseenter', () => catalogMapHover(block, tile, o, twins.get(o.id), tab, tip, tileById));
      tile.addEventListener('focus', () => catalogMapHover(block, tile, o, twins.get(o.id), tab, tip, tileById));
      tile.addEventListener('mouseleave', () => catalogMapUnhover(block, tip));
      tile.addEventListener('blur', () => catalogMapUnhover(block, tip));
      tile.addEventListener('click', () => catalogMapOpen(tab, o));
      tileById.set(o.id, tile);
      tiles.appendChild(tile);
    });
    block.appendChild(tiles);

    if (pairs.length && catalogMapFilter !== 'unused') {
      const list = pjMk('div', 'cat-map-pairs');
      list.appendChild(pjMk('div', 'cat-map-pairs-title', 'Look-alikes worth a look'));
      pairs.forEach(p => {
        const row = pjMk('div', 'maint-row cat-map-pair');
        const main = pjMk('div', 'maint-row-main');
        const names = pjMk('div', 'maint-row-title');
        [p.a, p.b].forEach((o, i) => {
          if (i) names.appendChild(pjMk('span', 'cat-map-pair-sep', '≈'));
          const n = pjMk('span', null, catalogEntryName(tab.category, o));
          n.dataset.userContent = '';
          names.appendChild(n);
          names.appendChild(pjMk('span', 'cat-map-pair-uses', catalogUsesText(o.uses)));
        });
        main.appendChild(names);
        main.appendChild(pjMk('div', 'maint-row-meta',
          p.reason === 'same' ? 'Same name once spacing and punctuation are ignored' : 'Names differ by a letter or two'));
        row.appendChild(main);
        row.addEventListener('mouseenter', () => [p.a, p.b].forEach(o => tileById.get(o.id)?.classList.add('is-lit')));
        row.addEventListener('mouseleave', () => [p.a, p.b].forEach(o => tileById.get(o.id)?.classList.remove('is-lit')));
        const notDup = pjMk('button', 'btn', 'Not a duplicate');
        notDup.type = 'button';
        notDup.title = 'Stop showing this pair';
        notDup.addEventListener('click', () => dismissCatalogPair(tab.category, p));
        row.appendChild(notDup);
        if (LOOKUP_MERGE_CATEGORIES[tab.category]) {
          const btn = pjMk('button', 'btn', 'Merge…');
          btn.type = 'button';
          btn.addEventListener('click', () => openMaintenanceMergeConfirm(row,
            { category: tab.category, codes: [p.a, p.b].map(o => ({ id: o.id, code: o.code, label: o.label })) },
            runCatalogMap));
          row.appendChild(btn);
        } else {
          const btn = pjMk('button', 'btn', tab.category === 'COMPANY' ? 'Open Clients' : 'Open in Settings');
          btn.type = 'button';
          btn.addEventListener('click', () => catalogMapOpen(tab));
          row.appendChild(btn);
        }
        list.appendChild(row);
      });
      block.appendChild(list);
    }
    host.appendChild(block);
  });

  if (!shown) {
    host.appendChild(pjMk('div', 'maint-empty', catalogMapFilter === 'unused'
      ? 'Every entry is in use.' : 'No look-alike names found.'));
  }
}

function catalogMapHover(block, tile, o, twins, tab, tip, tileById) {
  block.classList.toggle('has-focus', !!twins);
  block.querySelectorAll('.cat-map-tile.is-lit').forEach(t => t.classList.remove('is-lit'));
  if (twins) {
    tile.classList.add('is-lit');
    twins.forEach(w => tileById.get(w.other.id)?.classList.add('is-lit'));
  }
  tip.innerHTML = '';
  const name = pjMk('div', 'cat-map-tip-title', catalogEntryName(tab.category, o));
  name.dataset.userContent = '';
  tip.appendChild(name);
  tip.appendChild(pjMk('div', 'cat-map-tip-row', catalogUsesText(o.uses)));
  if (!o.uses) tip.appendChild(pjMk('div', 'cat-map-tip-row', tab.category === 'COMPANY' ? 'Clients are archived, not deleted' : 'Can be deleted in Settings'));
  if (o.isActive === false) tip.appendChild(pjMk('div', 'cat-map-tip-row', 'Hidden from dropdowns'));
  (twins || []).forEach(w => {
    const row = pjMk('div', 'cat-map-tip-row');
    row.appendChild(pjMk('span', null, 'Looks like'));
    const other = pjMk('strong', null, catalogEntryName(tab.category, w.other));
    other.dataset.userContent = '';
    row.appendChild(other);
    tip.appendChild(row);
  });
  tip.hidden = false;
  const host = tip.parentElement;
  const hb = host.getBoundingClientRect();
  const tb = tile.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  const tipW = tip.offsetWidth;
  let x = rtl ? tb.right - hb.left - tipW : tb.left - hb.left;
  x = Math.max(0, Math.min(x, hb.width - tipW));
  tip.style.left = x + 'px';
  tip.style.top = (tb.bottom - hb.top + 6) + 'px';
}

function catalogMapUnhover(block, tip) {
  block.classList.remove('has-focus');
  block.querySelectorAll('.cat-map-tile.is-lit').forEach(t => t.classList.remove('is-lit'));
  tip.hidden = true;
}

// A client opens its own profile; any other entry opens its category's
// editor in Settings, where unused entries can be deleted.
function catalogMapOpen(tab, o) {
  if (tab.category === 'COMPANY') {
    switchModule('clients');
    if (o) openClientDetail(o.id);
    return;
  }
  const btn = document.querySelector('#module-settings .stab[data-tab="' + tab.key + '"]');
  if (btn) switchTab(btn);
}
