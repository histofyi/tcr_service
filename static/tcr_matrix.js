/* The cross-structure interface panel on a TCR page.
 *
 * One ROW per structure of this receptor, and the same 6 CDR loops x 3 MHC regions
 * the structure page shows for a single complex. Read down a column and you see what
 * one loop does across every peptide the TCR has been solved against — which is the
 * point: 26 of the 33 multi-structure TCRs vary their peptide, and this is the view
 * that shows the cross-reactivity.
 *
 * AREA encodes trimmed area, COLOUR encodes shape complementarity.
 *
 * NB the structure page's matrix sizes its bubbles by BURIED area (BSA), which is a
 * different quantity — 1AO7's aCDR3/peptide cell is 63.3 A^2 trimmed and 127.1 A^2
 * buried, and neither is a rescaling of the other. Trimmed area is the area of the
 * patch the Sc calculation actually scored, so it is the area that belongs beside an
 * Sc colour. Each chart's size legend names its own quantity; do not "unify" them by
 * relabelling one to match the other.
 *
 * Bound to TcrSelection like everything else on the page: hover a row to light that
 * structure up, click it to select it everywhere.
 */
(function () {

  const root = document.getElementById('interface-panel');
  if (!root) return;

  const DATA = JSON.parse(root.dataset.panel);
  const CDR_LOOPS = DATA.cdr_loops;
  const MHC_REGIONS = DATA.mhc_regions;
  const selection = window.TcrSelection;

  const NS = 'http://www.w3.org/2000/svg';

  /* Geometry, in SVG user units. The grid is 6 CDR groups of 3 sub-columns (one per
   * MHC region), with the alpha and beta halves pushed apart by a rule — the layout
   * of the grant's figures. */
  const SUB = 34;            // sub-column pitch: one MHC region
  const GROUP = SUB * 3;     // one CDR loop's group of three
  const GROUP_GAP = 14;      // between CDR loops
  const HALF_GAP = 30;       // between the alpha and beta halves, where the rule goes
  const ROW = 52;            // row pitch: one structure
  const LEFT = 210;          // room for the row labels (PDB + peptide)
  const TOP = 54;            // room for the CDR labels
  const REGION_LABELS = 62;  // the rotated region labels under the grid
  const BOTTOM = 96;         // the size legend, below a separating rule
  const RIGHT = 78;          // the Sc colour ramp
  const MAX_RADIUS = 21;     // a bubble at the global trimmed-area max

  /* Viridis, sampled at 16 stops — the same scale as the structure page's matrix and
   * the grant's figures. Perceptually uniform and colour-blind safe. */
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

  // Area ∝ trimmed area, so radius ∝ sqrt(area). Putting the quantity on the radius
  // would square it and exaggerate the big cells.
  const radiusFor = (area) =>
    MAX_RADIUS * Math.sqrt(Math.max(0, area) / DATA.trimmed_area_max);

  // x of a sub-column: which CDR group, then which region within it.
  const xFor = (cdrIndex, mhcIndex) =>
    LEFT + cdrIndex * (GROUP + GROUP_GAP) + (cdrIndex >= 3 ? HALF_GAP : 0)
         + mhcIndex * SUB + SUB / 2;

  const yFor = (rowIndex) => TOP + rowIndex * ROW + ROW / 2;

  const GRID_RIGHT = xFor(CDR_LOOPS.length - 1, MHC_REGIONS.length - 1) + SUB / 2;
  const WIDTH = GRID_RIGHT + RIGHT;
  const GRID_BOTTOM = TOP + DATA.rows.length * ROW;
  const HEIGHT = GRID_BOTTOM + REGION_LABELS + BOTTOM;

  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  };

  const text = (content, attrs) => {
    const node = el('text', attrs);
    node.textContent = content;
    return node;
  };

  const fmt = (v, dp) =>
    v === null || v === undefined ? '—' : v.toFixed(dp === undefined ? 1 : dp);

  const tooltip = document.getElementById('panel-tooltip');

  /* --- build ---------------------------------------------------------------- */

  const svg = el('svg', {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    class: 'panel-svg',
    role: 'img',
    'aria-label': 'Shape complementarity and trimmed area for each CDR loop against '
                + 'each MHC region, for every structure of this TCR',
  });

  // CDR group labels across the top
  CDR_LOOPS.forEach((loop, cdrIndex) => {
    svg.appendChild(text(DATA.cdr_labels[loop], {
      x: xFor(cdrIndex, 1), y: 30,
      'text-anchor': 'middle', class: 'matrix-label matrix-label-cdr',
    }));
  });

  // the alpha | beta divider
  const rule = LEFT + 3 * (GROUP + GROUP_GAP) + HALF_GAP / 2 - GROUP_GAP / 2;
  svg.appendChild(el('line', {
    x1: rule, y1: TOP - 16, x2: rule, y2: GRID_BOTTOM + 6, class: 'matrix-split',
  }));

  DATA.rows.forEach((row, rowIndex) => {
    const y = yFor(rowIndex);

    // A band behind the whole row: the hover/selection target, and the only thing
    // big enough to click comfortably — the bubbles are far too small.
    const band = el('rect', {
      x: 6, y: TOP + rowIndex * ROW, width: GRID_RIGHT - 6, height: ROW,
      class: 'panel-band', 'data-pdb': row.pdb_id,
    });
    svg.appendChild(band);

    /* Two lines, or three where the allele varies across this TCR's structures — on
     * LC13 or TK3 a row labelled with only a peptide would imply an MHC that is not
     * constant. Lines tighten to fit rather than the row growing. */
    const lines = DATA.allele_varies
      ? [[-13, row.pdb_id, 'panel-pdb'],
         [1, row.peptide || '', 'panel-peptide'],
         [15, row.allele || '', 'panel-allele']]
      : [[-5, row.pdb_id, 'panel-pdb'],
         [11, row.peptide || '', 'panel-peptide']];

    lines.forEach(([dy, content, className]) => {
      svg.appendChild(text(content, {
        x: LEFT - 16, y: y + dy, 'text-anchor': 'end', class: className,
      }));
    });

    row.cells.forEach((cell) => {
      const cdrIndex = CDR_LOOPS.indexOf(cell.cdr_loop);
      const mhcIndex = MHC_REGIONS.indexOf(cell.mhc_region);
      const x = xFor(cdrIndex, mhcIndex);

      const area = cell.trimmed_area || 0;

      // No patch at all — that loop never reaches that region. Draw nothing: an
      // empty cell IS the finding, and a dot would read as a small contact.
      if (area <= 0) return;

      const bubble = el('circle', {
        cx: x, cy: y, r: Math.max(1.5, radiusFor(area)),
        class: cell.sc === null ? 'matrix-bubble is-unknown' : 'matrix-bubble',
        fill: cell.sc === null
          ? '#ffffff'
          : viridis((cell.sc - DATA.sc_min) / (DATA.sc_max - DATA.sc_min)),
      });
      svg.appendChild(bubble);
    });

    // The hit band goes on top of the bubbles so the row is hoverable everywhere,
    // and carries the tooltip for whichever cell is under the pointer.
    const hit = el('rect', {
      x: 6, y: TOP + rowIndex * ROW, width: GRID_RIGHT - 6, height: ROW,
      class: 'panel-hit', 'data-pdb': row.pdb_id,
    });

    hit.addEventListener('mouseenter', () => band.classList.add('is-hot'));
    hit.addEventListener('mouseleave', () => {
      band.classList.remove('is-hot');
      if (tooltip) tooltip.style.display = 'none';
    });
    hit.addEventListener('mousemove', (event) => showTooltip(event, row));
    hit.addEventListener('click', () => {
      selection.select(row.pdb_id, { scroll: false, source: 'panel' });
    });

    svg.appendChild(hit);
    band.dataset.row = rowIndex;
  });

  /* --- region labels, under the grid ---------------------------------------- */

  CDR_LOOPS.forEach((loop, cdrIndex) => {
    MHC_REGIONS.forEach((region, mhcIndex) => {
      const x = xFor(cdrIndex, mhcIndex);
      const y = GRID_BOTTOM + 10;
      svg.appendChild(text(DATA.mhc_labels[region], {
        x, y, 'text-anchor': 'end', class: 'matrix-legend-text',
        transform: `rotate(-90 ${x} ${y})`,
      }));
    });
  });

  /* --- legends -------------------------------------------------------------- */

  const legendY = GRID_BOTTOM + REGION_LABELS + 34;

  svg.appendChild(el('line', {
    x1: 6, y1: GRID_BOTTOM + REGION_LABELS, x2: GRID_RIGHT,
    y2: GRID_BOTTOM + REGION_LABELS, class: 'matrix-rule',
  }));

  svg.appendChild(text('Trimmed area', {
    x: 6, y: legendY - 14, class: 'matrix-legend-text',
  }));

  // Reference circles. The largest is the real global max, so nothing on any panel
  // is ever bigger than the biggest thing in the key.
  const REFERENCE = [50, 120, Math.round(DATA.trimmed_area_max)];
  let cursor = 24;
  REFERENCE.forEach((area) => {
    const r = radiusFor(area);
    cursor += r + 14;
    svg.appendChild(el('circle', {
      cx: cursor, cy: legendY, r, class: 'matrix-bubble is-legend',
    }));
    svg.appendChild(text(`${area} Å²`, {
      x: cursor, y: legendY + MAX_RADIUS + 16,
      'text-anchor': 'middle', class: 'matrix-legend-text',
    }));
    cursor += r + 14;
  });

  // Sc ramp, down the right-hand side of the grid.
  const RAMP_X = GRID_RIGHT + 22;
  const RAMP_W = 12;
  const gradient = el('linearGradient', {
    id: 'panel-sc-ramp', x1: '0', y1: '1', x2: '0', y2: '0',
  });
  for (let i = 0; i <= 10; i += 1) {
    gradient.appendChild(el('stop', {
      offset: `${i * 10}%`, 'stop-color': viridis(i / 10),
    }));
  }
  const defs = el('defs', {});
  defs.appendChild(gradient);
  svg.appendChild(defs);

  svg.appendChild(el('rect', {
    x: RAMP_X, y: TOP, width: RAMP_W, height: GRID_BOTTOM - TOP,
    fill: 'url(#panel-sc-ramp)', class: 'matrix-bubble',
  }));
  svg.appendChild(text(fmt(DATA.sc_max, 1), {
    x: RAMP_X + RAMP_W + 5, y: TOP + 9, class: 'matrix-legend-text',
  }));
  svg.appendChild(text(fmt(DATA.sc_min, 1), {
    x: RAMP_X + RAMP_W + 5, y: GRID_BOTTOM, class: 'matrix-legend-text',
  }));
  svg.appendChild(text('Sc', {
    x: RAMP_X + RAMP_W + 5, y: (TOP + GRID_BOTTOM) / 2, class: 'matrix-legend-text',
  }));

  root.appendChild(svg);

  /* --- tooltip -------------------------------------------------------------- */

  function showTooltip(event, row) {
    if (!tooltip) return;

    // Which cell is the pointer nearest? The bubbles do not receive events (the hit
    // band is over them), so work it out from the x.
    const box = svg.getBoundingClientRect();
    const scale = WIDTH / box.width;
    const x = (event.clientX - box.left) * scale;

    let nearest = null;
    let best = Infinity;
    row.cells.forEach((cell) => {
      const cx = xFor(CDR_LOOPS.indexOf(cell.cdr_loop),
                      MHC_REGIONS.indexOf(cell.mhc_region));
      const distance = Math.abs(cx - x);
      if (distance < best) { best = distance; nearest = cell; }
    });

    const near = nearest && best <= SUB / 2 + 2 ? nearest : null;

    tooltip.innerHTML = `
      <div class="tt-title">${row.pdb_id} &middot; ${row.peptide || ''}${
        row.allele ? ' &middot; ' + row.allele : ''}</div>
      ${near ? `
        <div class="tt-sub-plain">${DATA.cdr_labels[near.cdr_loop]} &rarr; ${
          DATA.mhc_labels[near.mhc_region]}</div>
        <table>
          <tr><td class="tt-k">Trimmed area</td><td>${
            near.trimmed_area ? fmt(near.trimmed_area) + ' Å²' : 'no contact'}</td></tr>
          <tr><td class="tt-k">Sc</td><td>${
            near.sc === null
              ? (near.trimmed_area ? 'could not be computed' : '—')
              : fmt(near.sc, 2)}</td></tr>
        </table>` : '<div class="tt-sub-plain">Click to select this structure</div>'}`;

    tooltip.style.display = 'block';
    const pad = 14;
    const tip = tooltip.getBoundingClientRect();
    let left = event.clientX + pad;
    let top = event.clientY + pad;
    if (left + tip.width > window.innerWidth) left = event.clientX - tip.width - pad;
    if (top + tip.height > window.innerHeight) top = event.clientY - tip.height - pad;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  /* --- the shared selection ------------------------------------------------- */

  const bandFor = (pdb) => svg.querySelector(`.panel-band[data-pdb="${pdb}"]`);

  selection.subscribe((pdbId) => {
    svg.querySelectorAll('.panel-band.is-selected')
      .forEach(node => node.classList.remove('is-selected'));
    if (pdbId) bandFor(pdbId)?.classList.add('is-selected');
  });

  // A selection already made — from ?structure= on load, or by another view before
  // we subscribed.
  if (selection.current()) bandFor(selection.current())?.classList.add('is-selected');
})();
