/* The TCR:pMHC interface matrix — 6 CDR loops x 3 MHC regions.
 *
 * One bubble per cell: AREA encodes buried surface area, COLOUR encodes shape
 * complementarity. Area (not radius) is proportional to BSA, so the ink matches
 * the quantity — and it is normalised against a max taken across ALL structures,
 * not this one, so a bubble means the same thing on every structure page.
 *
 * Hover a cell to highlight that CDR loop / MHC region in Mol*; click to zoom to
 * it. The patches are addressable because chains D and E are IMGT-renumbered, so
 * the CDR loops sit at canonical positions in every structure.
 */
(function () {

  const root = document.getElementById('interface-matrix');
  if (!root) return;

  const DATA = JSON.parse(root.dataset.matrix);
  const CDR_LOOPS = JSON.parse(root.dataset.cdrLoops);
  const MHC_REGIONS = JSON.parse(root.dataset.mhcRegions);
  const CDR_LABELS = JSON.parse(root.dataset.cdrLabels);
  const MHC_LABELS = JSON.parse(root.dataset.mhcLabels);
  const CDR_SELECTIONS = JSON.parse(root.dataset.cdrSelections);
  const MHC_SELECTIONS = JSON.parse(root.dataset.mhcSelections);
  const VIEWER_ID = root.dataset.viewer;

  const NS = 'http://www.w3.org/2000/svg';

  // Geometry, in SVG user units.
  const CELL = 74;           // column pitch
  const ROW = 74;            // row pitch
  const GROUP_GAP = 26;      // extra gap between the alpha and beta halves
  const LEFT = 92;           // room for the MHC region labels
  const TOP = 34;            // room for the CDR labels
  const BOTTOM = 104;        // the size legend band, below a separating rule
  const MAX_RADIUS = 30;     // radius of a bubble at the global BSA max

  const SC_MIN = parseFloat(root.dataset.scMin);
  const SC_MAX = parseFloat(root.dataset.scMax);

  /* Viridis, sampled at 16 stops. Perceptually uniform and colour-blind safe —
   * the same scale the grant's shape-complementarity figures use. */
  const VIRIDIS = [
    [68, 1, 84], [72, 26, 108], [71, 47, 125], [65, 68, 135],
    [57, 86, 140], [49, 104, 142], [42, 120, 142], [35, 136, 142],
    [31, 152, 139], [34, 168, 132], [53, 183, 121], [84, 197, 104],
    [122, 209, 81], [165, 219, 54], [210, 226, 27], [253, 231, 37],
  ];

  function viridis(t) {
    const clamped = Math.max(0, Math.min(1, t));
    const scaled = clamped * (VIRIDIS.length - 1);
    const i = Math.floor(scaled);
    const j = Math.min(i + 1, VIRIDIS.length - 1);
    const f = scaled - i;
    const c = VIRIDIS[i].map((v, k) => Math.round(v + f * (VIRIDIS[j][k] - v)));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  // Area ∝ BSA, so radius ∝ sqrt(BSA). Encoding BSA on the radius instead would
  // exaggerate the big cells by squaring them.
  const radiusFor = (bsa) =>
    MAX_RADIUS * Math.sqrt(Math.max(0, bsa) / DATA.bsa_max);

  // x pitch, with the alpha/beta halves pushed apart.
  const xFor = (cdrIndex) =>
    LEFT + cdrIndex * CELL + (cdrIndex >= 3 ? GROUP_GAP : 0) + CELL / 2;
  const yFor = (mhcIndex) => TOP + mhcIndex * ROW + ROW / 2;

  const WIDTH = LEFT + CDR_LOOPS.length * CELL + GROUP_GAP + 24;
  const HEIGHT = TOP + MHC_REGIONS.length * ROW + BOTTOM;

  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  };

  const fmt = (v, dp) =>
    (v === null || v === undefined) ? '—' : v.toFixed(dp === undefined ? 1 : dp);

  const svg = el('svg', {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    class: 'matrix-svg',
    role: 'img',
    'aria-label': 'Interface matrix: buried surface area and shape complementarity for each CDR loop against each MHC region',
  });

  /* --- labels ------------------------------------------------------------- */

  CDR_LOOPS.forEach((cdr, i) => {
    const label = el('text', {
      x: xFor(i), y: TOP - 12, class: 'matrix-label matrix-label-cdr',
      'text-anchor': 'middle',
    });
    label.textContent = CDR_LABELS[cdr];
    svg.appendChild(label);
  });

  MHC_REGIONS.forEach((mhc, j) => {
    const label = el('text', {
      x: LEFT - 14, y: yFor(j), class: 'matrix-label',
      'text-anchor': 'end', 'dominant-baseline': 'central',
    });
    label.textContent = MHC_LABELS[mhc];
    svg.appendChild(label);
  });

  // The line between the alpha and beta halves of the receptor.
  const splitX = LEFT + 3 * CELL + GROUP_GAP / 2;
  svg.appendChild(el('line', {
    x1: splitX, y1: TOP - 4, x2: splitX, y2: TOP + MHC_REGIONS.length * ROW,
    class: 'matrix-split',
  }));

  /* --- bubbles ------------------------------------------------------------ */

  const tooltip = document.getElementById('matrix-tooltip');
  const viewerFor = () => (window.HistoTCR || {}).viewers?.[VIEWER_ID];

  function showTooltip(event, cell) {
    if (!tooltip) return;
    const copies = DATA.n_copies > 1
      ? `<div class="tt-note">mean of ${DATA.n_copies} copies in the asymmetric unit</div>`
      : '';
    tooltip.innerHTML = `
      <div class="tt-title">${CDR_LABELS[cell.cdr_loop]} &middot; ${MHC_LABELS[cell.mhc_region]}</div>
      <table>
        <tr><td class="tt-k">Buried area</td><td>${fmt(cell.bsa_total)} Å²</td></tr>
        <tr><td class="tt-k">CDR side</td><td>${fmt(cell.bsa_cdr_side)} Å²</td></tr>
        <tr><td class="tt-k">Sc</td><td>${cell.sc === null ? 'not available' : fmt(cell.sc, 2)}</td></tr>
        <tr><td class="tt-k">Median gap</td><td>${cell.median_distance === null ? '—' : fmt(cell.median_distance, 2) + ' Å'}</td></tr>
      </table>${copies}`;
    tooltip.style.display = 'block';
    const pad = 14;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    const box = tooltip.getBoundingClientRect();
    if (x + box.width > window.innerWidth) x = event.clientX - box.width - pad;
    if (y + box.height > window.innerHeight) y = event.clientY - box.height - pad;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  const hideTooltip = () => { if (tooltip) tooltip.style.display = 'none'; };

  DATA.cells.forEach((cell) => {
    const i = CDR_LOOPS.indexOf(cell.cdr_loop);
    const j = MHC_REGIONS.indexOf(cell.mhc_region);
    if (i < 0 || j < 0) return;

    const x = xFor(i);
    const y = yFor(j);
    const bsa = cell.bsa_total || 0;

    // A hit area over every cell, so even an empty one is hoverable and says so.
    const hit = el('rect', {
      x: x - CELL / 2, y: y - ROW / 2, width: CELL, height: ROW,
      class: 'matrix-hit',
    });

    if (bsa > 0) {
      const bubble = el('circle', {
        cx: x, cy: y, r: radiusFor(bsa),
        class: cell.sc === null ? 'matrix-bubble is-unknown' : 'matrix-bubble',
      });
      // A cell with contact but no SC (the calculation found no molecular dots)
      // is drawn as an outline, so it stays distinct from "no contact at all".
      bubble.setAttribute(
        'fill',
        cell.sc === null ? 'none' : viridis((cell.sc - SC_MIN) / (SC_MAX - SC_MIN)),
      );
      svg.appendChild(bubble);
    } else {
      svg.appendChild(el('circle', { cx: x, cy: y, r: 1.5, class: 'matrix-empty' }));
    }

    const cdrSel = CDR_SELECTIONS[cell.cdr_loop];
    const mhcSel = MHC_SELECTIONS[cell.mhc_region];

    hit.addEventListener('mousemove', (e) => showTooltip(e, cell));
    hit.addEventListener('mouseenter', () => {
      root.querySelectorAll('.matrix-hit.is-hot').forEach(n => n.classList.remove('is-hot'));
      hit.classList.add('is-hot');
      // Highlight the CDR loop; it is the side the reader is scanning by.
      HistoTCR.highlightRange(viewerFor(), cdrSel.chain, cdrSel.start, cdrSel.end);
    });
    hit.addEventListener('mouseleave', () => {
      hit.classList.remove('is-hot');
      hideTooltip();
      HistoTCR.highlightRange(viewerFor(), null);
    });
    hit.addEventListener('click', () => {
      // Zoom to the CDR loop and show its contacts. Mol* focuses one selection at
      // a time, so the loop wins over the MHC region — it is the smaller, more
      // specific patch, and the region it packs against is what you then see.
      const viewer = viewerFor();
      if (!viewer) return;
      HistoTCR.focusRange(viewer, cdrSel.chain, cdrSel.start, cdrSel.end);
      const anchor = document.getElementById('structure-top');
      if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    svg.appendChild(hit);
  });

  /* --- size legend --------------------------------------------------------
     Below a separating rule, so a row of reference circles doesn't read as a
     fourth MHC region. */

  const gridBottom = TOP + MHC_REGIONS.length * ROW;
  const legendY = gridBottom + 52;
  const refs = [50, 150, 300];

  svg.appendChild(el('line', {
    x1: 0, y1: gridBottom + 12, x2: WIDTH, y2: gridBottom + 12,
    class: 'matrix-rule',
  }));

  const legendTitle = el('text', {
    x: LEFT - 14, y: legendY, class: 'matrix-label',
    'text-anchor': 'end', 'dominant-baseline': 'central',
  });
  legendTitle.textContent = 'Buried area';
  svg.appendChild(legendTitle);

  let legendX = LEFT + 6;
  refs.forEach((ref) => {
    const r = radiusFor(ref);
    legendX += r + 12;
    svg.appendChild(el('circle', {
      cx: legendX, cy: legendY, r, class: 'matrix-bubble is-legend',
    }));
    const label = el('text', {
      x: legendX, y: legendY + MAX_RADIUS + 12, class: 'matrix-legend-text',
      'text-anchor': 'middle',
    });
    label.textContent = `${ref} Å²`;
    svg.appendChild(label);
    legendX += r + 28;
  });

  root.appendChild(svg);

  /* --- the Sc colour ramp ------------------------------------------------- */

  const ramp = document.getElementById('matrix-ramp');
  if (ramp) {
    const stops = [];
    for (let i = 0; i <= 10; i++) stops.push(viridis(i / 10));
    ramp.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
  }
})();
