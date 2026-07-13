/* The contact chord — six CDR loops (top) against three MHC regions (bottom).
 *
 * A ribbon is one CDR-loop x MHC-region pair; its width is the number of
 * contacting atom pairs. Arc length is that node's total, so a loop that does
 * more of the binding takes up more of the ring.
 *
 * Ported as GEOMETRY from the grant's draw_chord_diagrams.py — the ribbon is the
 * same quadratic Bezier through the origin that D3's chord layout draws, and the
 * palette and the top/bottom split are the grant's. Two deliberate differences:
 *
 *   - The grant's chord is residue x residue. Ours is LOOP x REGION, because that
 *     is what the data has: contacts_by_structure.json aggregates to the loop.
 *     Residue-level pairs would let this be redrawn at the grant's resolution.
 *   - The grant sizes every chord endpoint identically, for comparability across
 *     figures. Here the ribbon width carries the contact count, which is the
 *     thing worth seeing on a single structure.
 *
 * `proximal` is Arpeggio's "these atoms are near each other" catch-all, not a
 * specific chemistry, and it is ~90% of all atom pairs. The toggle drops it, so
 * you can see the actual bonds rather than the proximity.
 */
(function () {

  const root = document.getElementById('chord-diagram');
  if (!root) return;

  const CELLS = JSON.parse(root.dataset.cells);
  const CDR_LABELS = JSON.parse(root.dataset.cdrLabels);
  const MHC_LABELS = JSON.parse(root.dataset.mhcLabels);
  const CDR_SELECTIONS = JSON.parse(root.dataset.cdrSelections);
  const MHC_SELECTIONS = JSON.parse(root.dataset.mhcSelections);
  const VIEWER_ID = root.dataset.viewer;

  const NS = 'http://www.w3.org/2000/svg';

  /* The grant's IBM colour-blind-safe palette (palette.json). MHC is the
   * orange/amber family, TCR alpha magenta, TCR beta blue; within a chain CDR1 is
   * lightest and CDR3 darkest. */
  const COLOURS = {
    alpha1: '#FE8133', peptide: '#FFB000', alpha2: '#FE6100',
    alpha_cdr1: '#EA7DB2', alpha_cdr2: '#DC267F', alpha_cdr3: '#9A1B59',
    beta_cdr1: '#92B1FF', beta_cdr2: '#648FFF', beta_cdr3: '#4664B2',
  };

  // Reading left to right along the top of the ring, and along the bottom.
  const CDR_ORDER = ['alpha_cdr1', 'alpha_cdr2', 'alpha_cdr3',
                     'beta_cdr3', 'beta_cdr2', 'beta_cdr1'];
  const MHC_ORDER = ['alpha1', 'peptide', 'alpha2'];

  /* Layout constants, taken from draw_chord_diagrams.py so this reads as the same
   * diagram as the grant's figures. Polar degrees, 0 = 3 o'clock, CCW positive.
   * TCR sweeps the top 180 deg clockwise; MHC the bottom 150 deg anti-clockwise,
   * with a 15 deg gap either side separating the two halves. */
  const TCR_LEFT = 180, TCR_RIGHT = 0;
  const MHC_LEFT = 195, MHC_RIGHT = 345;
  const GAP = 2.5;         // between CDR loops within a chain (grant: 2.5)
  const CHAIN_GAP = 10;    // at 12 o'clock, between alpha and beta (grant: 10)
  const MHC_GAP = 5;       // between MHC regions (grant: 5)

  const SIZE = 460;
  const CENTRE = SIZE / 2;
  const OUTER = 168;
  const RING = Math.round(OUTER * 0.05);   // grant: RING_WIDTH 0.05 of OUTER 1.0
  const CHORD_R = OUTER - RING;
  const LABEL_R = Math.round(OUTER * 1.08);  // grant: LABEL_RADIUS 1.08

  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  };

  // SVG y grows downward, so negate the sine to keep "counter-clockwise positive".
  const polar = (deg, r) => {
    const rad = deg * Math.PI / 180;
    return [CENTRE + r * Math.cos(rad), CENTRE - r * Math.sin(rad)];
  };

  const tooltip = document.getElementById('chord-tooltip');
  const viewerFor = () => (window.HistoTCR || {}).viewers?.[VIEWER_ID];

  const BOND_LABELS = {
    hbond: 'H-bond', ionic: 'Ionic', aromatic: 'Aromatic',
    hydrophobic: 'Hydrophobic', vdw: 'VdW', vdw_clash: 'VdW clash',
    polar: 'Polar', weak_polar: 'Weak polar', weak_hbond: 'Weak H-bond',
    carbonyl: 'Carbonyl', proximal: 'Proximal',
  };

  /* The weight of a cell under the current mode: every atom pair, or only those
   * with a specific bond type. */
  function weight(cell, specificOnly) {
    return specificOnly ? cell.n_specific_pairs : cell.n_atom_pairs;
  }

  function render(specificOnly) {
    root.querySelector('svg')?.remove();

    const svg = el('svg', {
      viewBox: `0 0 ${SIZE} ${SIZE}`,
      class: 'chord-svg',
      role: 'img',
      'aria-label': 'Contacts between each CDR loop and each region of the MHC',
    });

    const links = CELLS
      .map(c => ({ ...c, value: weight(c, specificOnly) }))
      .filter(c => c.value > 0);

    if (!links.length) {
      const message = el('text', {
        x: CENTRE, y: CENTRE, 'text-anchor': 'middle', class: 'chord-empty',
      });
      message.textContent = specificOnly
        ? 'No specific bonds at this interface'
        : 'No contacts recorded';
      svg.appendChild(message);
      root.appendChild(svg);
      return;
    }

    // Node totals drive arc length.
    const total = (key, field) =>
      links.filter(l => l[field] === key).reduce((s, l) => s + l.value, 0);

    const cdrTotals = Object.fromEntries(CDR_ORDER.map(k => [k, total(k, 'cdr_loop')]));
    const mhcTotals = Object.fromEntries(MHC_ORDER.map(k => [k, total(k, 'mhc_region')]));

    const cdrNodes = CDR_ORDER.filter(k => cdrTotals[k] > 0);
    const mhcNodes = MHC_ORDER.filter(k => mhcTotals[k] > 0);

    const arcs = {};

    // --- TCR, across the top: 180 deg -> 0 deg, sweeping clockwise.
    const cdrSum = cdrNodes.reduce((s, k) => s + cdrTotals[k], 0);
    const cdrGaps = (cdrNodes.length - 1) * GAP
      + (cdrNodes.some(k => k.startsWith('alpha')) && cdrNodes.some(k => k.startsWith('beta'))
         ? CHAIN_GAP - GAP : 0);
    let span = (TCR_LEFT - TCR_RIGHT) - cdrGaps;
    let cursor = TCR_LEFT;

    cdrNodes.forEach((key, i) => {
      const width = span * (cdrTotals[key] / cdrSum);
      arcs[key] = { from: cursor - width, to: cursor, value: cdrTotals[key] };
      cursor -= width;
      if (i < cdrNodes.length - 1) {
        // the wider gap sits at 12 o'clock, between the alpha and beta chains
        const crossesChains = !cdrNodes[i + 1].startsWith(key.slice(0, 4));
        cursor -= crossesChains ? CHAIN_GAP : GAP;
      }
    });

    // --- MHC, across the bottom: 195 deg -> 345 deg, sweeping anti-clockwise.
    const mhcSum = mhcNodes.reduce((s, k) => s + mhcTotals[k], 0);
    span = (MHC_RIGHT - MHC_LEFT) - (mhcNodes.length - 1) * MHC_GAP;
    cursor = MHC_LEFT;

    mhcNodes.forEach((key, i) => {
      const width = span * (mhcTotals[key] / mhcSum);
      arcs[key] = { from: cursor, to: cursor + width, value: mhcTotals[key] };
      cursor += width + (i < mhcNodes.length - 1 ? MHC_GAP : 0);
    });

    /* Ribbon endpoints: each node's arc is divided among its partners in
     * proportion to the contacts they share, ordered by where the partner sits so
     * the ribbons fan out without crossing each other unnecessarily. */
    const endpoints = {};
    const centreOf = (key) => (arcs[key].from + arcs[key].to) / 2;

    [...cdrNodes, ...mhcNodes].forEach((key) => {
      const isCdr = key in CDR_LABELS;
      const field = isCdr ? 'cdr_loop' : 'mhc_region';
      const partnerField = isCdr ? 'mhc_region' : 'cdr_loop';

      const mine = links.filter(l => l[field] === key)
        .sort((a, b) => centreOf(a[partnerField]) - centreOf(b[partnerField]));

      const arc = arcs[key];
      const width = arc.to - arc.from;
      let at = arc.from;

      mine.forEach((link) => {
        const slice = width * (link.value / arc.value);
        endpoints[`${link.cdr_loop}|${link.mhc_region}|${key}`] = [at, at + slice];
        at += slice;
      });
    });

    /* The ribbon: a quadratic Bezier through the origin from one arc to the other
     * and back. This is the shape D3's chord layout draws. */
    function ribbon(a, b) {
      const [a1x, a1y] = polar(a[0], CHORD_R);
      const [a2x, a2y] = polar(a[1], CHORD_R);
      const [b1x, b1y] = polar(b[0], CHORD_R);
      const [b2x, b2y] = polar(b[1], CHORD_R);
      return `M ${a1x} ${a1y}`
           + ` Q ${CENTRE} ${CENTRE} ${b2x} ${b2y}`
           + ` L ${b1x} ${b1y}`
           + ` Q ${CENTRE} ${CENTRE} ${a2x} ${a2y}`
           + ' Z';
    }

    // Ribbons first, so the arcs drawn over them cover the endpoints cleanly.
    links.sort((a, b) => b.value - a.value).forEach((link) => {
      const cdrEnd = endpoints[`${link.cdr_loop}|${link.mhc_region}|${link.cdr_loop}`];
      const mhcEnd = endpoints[`${link.cdr_loop}|${link.mhc_region}|${link.mhc_region}`];
      if (!cdrEnd || !mhcEnd) return;

      const path = el('path', {
        d: ribbon(cdrEnd, mhcEnd),
        class: 'chord-ribbon',
        // coloured by the CDR loop, as the grant's figures are
        fill: COLOURS[link.cdr_loop],
      });

      const cdrSel = CDR_SELECTIONS[link.cdr_loop];

      path.addEventListener('mouseenter', () => {
        svg.querySelectorAll('.chord-ribbon').forEach(r => r.classList.add('is-dim'));
        path.classList.remove('is-dim');
        path.classList.add('is-hot');
        HistoTCR.highlightRange(viewerFor(), cdrSel.chain, cdrSel.start, cdrSel.end);
      });
      path.addEventListener('mousemove', (e) => showTooltip(e, link));
      path.addEventListener('mouseleave', () => {
        svg.querySelectorAll('.chord-ribbon').forEach(r => {
          r.classList.remove('is-dim'); r.classList.remove('is-hot');
        });
        hideTooltip();
        HistoTCR.highlightRange(viewerFor(), null);
      });
      path.addEventListener('click', () => {
        const viewer = viewerFor();
        if (!viewer) return;
        HistoTCR.focusRange(viewer, cdrSel.chain, cdrSel.start, cdrSel.end);
        document.getElementById('structure-top')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      svg.appendChild(path);
    });

    // --- arcs + labels
    Object.entries(arcs).forEach(([key, arc]) => {
      const [x1, y1] = polar(arc.from, OUTER);
      const [x2, y2] = polar(arc.to, OUTER);
      const [x3, y3] = polar(arc.to, OUTER - RING);
      const [x4, y4] = polar(arc.from, OUTER - RING);
      // sweep flags: our angles run anti-clockwise, which is clockwise on screen
      const large = (arc.to - arc.from) > 180 ? 1 : 0;

      svg.appendChild(el('path', {
        d: `M ${x1} ${y1} A ${OUTER} ${OUTER} 0 ${large} 0 ${x2} ${y2}`
         + ` L ${x3} ${y3} A ${OUTER - RING} ${OUTER - RING} 0 ${large} 1 ${x4} ${y4} Z`,
        class: 'chord-arc',
        fill: COLOURS[key],
      }));

      const mid = (arc.from + arc.to) / 2;
      const [lx, ly] = polar(mid, LABEL_R);
      const flip = mid > 90 && mid < 270;
      const label = el('text', {
        x: lx, y: ly,
        class: 'chord-label',
        'text-anchor': flip ? 'end' : 'start',
        'dominant-baseline': 'central',
        transform: `rotate(${flip ? -mid + 180 : -mid} ${lx} ${ly})`,
      });
      label.textContent = CDR_LABELS[key] || MHC_LABELS[key];
      svg.appendChild(label);
    });

    root.appendChild(svg);
  }

  function showTooltip(event, link) {
    if (!tooltip) return;
    const bonds = Object.entries(link.bonds || {})
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `<tr><td class="tt-k">${BOND_LABELS[t] || t}</td><td>${n}</td></tr>`)
      .join('');

    tooltip.innerHTML = `
      <div class="tt-title">${CDR_LABELS[link.cdr_loop]} &rarr; ${MHC_LABELS[link.mhc_region]}</div>
      <table>
        <tr><td class="tt-k">Atom pairs</td><td>${link.n_atom_pairs}</td></tr>
        <tr><td class="tt-k">Specific bonds</td><td>${link.n_specific_pairs}</td></tr>
      </table>
      <div class="tt-sub">By bond type</div>
      <table>${bonds}</table>`;
    tooltip.style.display = 'block';

    const pad = 14;
    const box = tooltip.getBoundingClientRect();
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + box.width > window.innerWidth) x = event.clientX - box.width - pad;
    if (y + box.height > window.innerHeight) y = event.clientY - box.height - pad;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  const hideTooltip = () => { if (tooltip) tooltip.style.display = 'none'; };

  const toggle = document.getElementById('chord-specific');
  if (toggle) toggle.addEventListener('change', e => render(e.target.checked));

  render(toggle ? toggle.checked : false);
})();
