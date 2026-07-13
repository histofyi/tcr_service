/* The contact chord — ONE ARC PER RESIDUE, one ribbon per contacting residue pair.
 *
 * This is the grant's figure (bsi_career_enhancing_grant/code/draw_chord_diagrams.py),
 * redrawn as SVG and made live. Reading round the ring:
 *
 *   top     the CDR loops, left to right: α CDR1, CDR2, CDR3 | β CDR3, CDR2, CDR1
 *   bottom  the MHC, left to right: α1 helix, peptide, α2 helix
 *
 * Every contacting residue gets its own arc, coloured by the loop or region it
 * belongs to; every contacting residue PAIR gets a ribbon, coloured by the CDR loop
 * — so the ring says which residues do the binding, and the ribbons say what they
 * bind to. It replaces the loop × region chord the page carried while the export
 * only aggregated to the loop (DATA.md #11, now resolved by `residues[]`).
 *
 * The geometry is the grant's, constant for constant: the angular spans, the gaps
 * between the loops, the 10° gap at 12 o'clock between the α and β chains, the
 * label radius, and the ribbon — a quadratic Bezier THROUGH THE ORIGIN, which is
 * the shape D3's chord layout draws. Two things are ours:
 *
 *   - The grant draws every ribbon at ONE FIXED WIDTH, so its figures are comparable
 *     with each other. Here the ribbon width carries `n_atom_pairs`, which is the
 *     thing worth seeing on a single structure. Arcs stay equally sized (the grant's
 *     layout) because the counts span 1..91 atom pairs: sizing arcs by them would
 *     leave a one-contact residue a 0.3° sliver, unlabelable and unclickable.
 *   - It is interactive: hover a ribbon to highlight both residues in the structure,
 *     click to zoom to them.
 *
 * `proximal` is Arpeggio's "these atoms are near each other" catch-all, not a
 * specific chemistry, and it is on nearly every pair. The toggle keeps only pairs
 * held by something else — the actual bonds rather than the proximity.
 *
 * Insertion codes: a contact names its residue by number, with no insertion code —
 * and the number is not always unique (1AO7's chain E has both E:112 and E:112A,
 * both GLY, both in CDR3β). It reads as an ambiguity, but it is a HOLE: the export
 * never refers to an inserted residue at all, so every row means the icode-free
 * residue, and the inserted ones are missing from the data entirely. Every arc is
 * therefore wired to exactly the right residue — and the page NAMES the residues the
 * data cannot show it. See functions/interface.py::_resolve and DATA.md #16.
 */
(function () {

  const root = document.getElementById('chord-diagram');
  if (!root) return;

  const CHORD = JSON.parse(root.dataset.chord || 'null');
  const CDR_LABELS = JSON.parse(root.dataset.cdrLabels);
  const MHC_LABELS = JSON.parse(root.dataset.mhcLabels);
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

  const GROUP_LABELS = { ...CDR_LABELS, ...MHC_LABELS };

  /* Layout, from draw_chord_diagrams.py. Polar degrees, 0 = 3 o'clock, CCW positive.
   * The TCR sweeps the top 180° CLOCKWISE from 9 o'clock; the MHC the bottom 150°
   * ANTI-CLOCKWISE, leaving a 15° gap on each side between the two halves. */
  const TCR_LEFT = 180, TCR_RIGHT = 0;
  const MHC_LEFT = 195, MHC_RIGHT = 345;

  /* The gap AFTER each group, reading round the ring. 2.5° between the loops of one
   * chain, 10° at 12 o'clock between the α and β chains, 5° between MHC regions —
   * the grant's numbers. Reserved whether or not the group has any residues, so the
   * ring does not reflow when the "specific bonds only" toggle empties a loop. */
  const CDR_GAPS = {
    alpha_cdr1: 2.5, alpha_cdr2: 2.5, alpha_cdr3: 10,
    beta_cdr3: 2.5, beta_cdr2: 2.5, beta_cdr1: 0,
  };
  const MHC_GAPS = { alpha1: 5, peptide: 5, alpha2: 0 };

  const CDR_GAP_TOTAL = CDR_ORDER.reduce((sum, k) => sum + CDR_GAPS[k], 0);   // 20
  const MHC_GAP_TOTAL = MHC_ORDER.reduce((sum, k) => sum + MHC_GAPS[k], 0);   // 10

  const SIZE = 560;
  const CENTRE = SIZE / 2;
  const OUTER = 205;
  const RING = Math.round(OUTER * 0.05);     // grant: RING_WIDTH 0.05 of OUTER 1.0
  const CHORD_R = OUTER - RING;
  const LABEL_R = Math.round(OUTER * 1.08);  // grant: LABEL_RADIUS 1.08

  /* Ribbon endpoints, in degrees. A residue's arc is shared out among its partners
   * in proportion to their atom pairs, on a scale (deg per atom pair) shared by the
   * whole diagram — so a ribbon means the same thing wherever it lands, and the two
   * ends of one ribbon are the same width. FLOOR is what keeps a one-atom-pair
   * contact visible and hoverable at all; PAD separates neighbouring ribbons. */
  const RIBBON_FLOOR = 0.55;   // ~2px at this radius — the grant's fixed width is 0.65°
  const RIBBON_PAD = 0.12;
  const ARC_FILL = 0.95;   // grant: chords occupy 95% of the arc they sit on

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

  /* What Mol* needs to select a residue. `icode: null` — the insertion code we could
   * not pin down — makes HistoTCR select the whole residue-number group. */
  const molstarResidue = (node) => ({
    chain: node.chain, resnum: node.resnum, icode: node.icode,
  });

  /* Hand the click to sequence.js, which owns the page's ?residue= selection, so the
   * sequences, the URL and the chord all agree. It cancels the event when it has
   * taken the residue (it only shows the CDR loops and the peptide — an α1/α2 helix
   * residue is not one of its cells, and we focus that ourselves). */
  function handOff(node) {
    if (!node.token) return false;
    const event = new CustomEvent('histotcr:residue', {
      detail: { token: node.token, chain: node.chain, resnum: node.resnum, icode: node.icode },
      cancelable: true,
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  }

  const scrollToViewer = () =>
    document.getElementById('structure-top')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  function render(specificOnly) {
    root.querySelector('svg')?.remove();

    const svg = el('svg', {
      viewBox: `0 0 ${SIZE} ${SIZE}`,
      class: 'chord-svg',
      role: 'img',
      'aria-label': 'Every contacting residue pair between the TCR and the peptide-MHC',
    });

    const links = (CHORD?.links || []).filter(l => !specificOnly || l.specific);

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

    // Only the residues that still have a contact under the current mode. The
    // server's order is the order round the ring, so keep it.
    const live = new Set(links.flatMap(l => [l.tcr, l.mhc]));
    const nodes = CHORD.nodes.filter(n => live.has(n.id));
    const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));

    const inGroup = (group) => nodes.filter(n => n.group === group);
    const tcrCount = nodes.filter(n => n.side === 'tcr').length;
    const mhcCount = nodes.length - tcrCount;

    /* --- arcs: equal angular space per residue within each half, gaps reserved --- */
    const arcs = {};
    const tcrWidth = ((TCR_LEFT - TCR_RIGHT) - CDR_GAP_TOTAL) / (tcrCount || 1);
    const mhcWidth = ((MHC_RIGHT - MHC_LEFT) - MHC_GAP_TOTAL) / (mhcCount || 1);

    // Top: 180° -> 0°, clockwise (decreasing polar).
    let cursor = TCR_LEFT;
    CDR_ORDER.forEach((group) => {
      inGroup(group).forEach((node) => {
        arcs[node.id] = { from: cursor - tcrWidth, to: cursor, width: tcrWidth };
        cursor -= tcrWidth;
      });
      cursor -= CDR_GAPS[group];
    });

    // Bottom: 195° -> 345°, anti-clockwise (increasing polar).
    cursor = MHC_LEFT;
    MHC_ORDER.forEach((group) => {
      inGroup(group).forEach((node) => {
        arcs[node.id] = { from: cursor, to: cursor + mhcWidth, width: mhcWidth };
        cursor += mhcWidth;
      });
      cursor += MHC_GAPS[group];
    });

    /* --- ribbon endpoints ---------------------------------------------------
     * Each residue's partners are ordered by WHERE THE PARTNER SITS, so the ribbons
     * leaving an arc fan out in the order they arrive and do not cross each other
     * needlessly. (draw_chord_diagrams.py::compute_ribbon_endpoints.) */
    const other = (link, id) => (link.tcr === id ? link.mhc : link.tcr);
    const centreOf = (id) => (arcs[id].from + arcs[id].to) / 2;

    const partners = {};
    links.forEach((link) => {
      (partners[link.tcr] ||= []).push(link);
      (partners[link.mhc] ||= []).push(link);
    });
    Object.entries(partners).forEach(([id, mine]) => {
      mine.sort((a, b) => centreOf(other(a, id)) - centreOf(other(b, id)));
    });

    /* Degrees per atom pair, one scale for the whole diagram: the largest value that
     * still lets every residue's ribbons sit side by side inside its own arc. The
     * binding residue is whichever is busiest relative to the space it has — usually
     * a peptide anchor, whose arcs are the narrower of the two halves. */
    let scale = Infinity;
    Object.entries(partners).forEach(([id, mine]) => {
      const usable = arcs[id].width * ARC_FILL;
      const slack = usable - RIBBON_PAD * (mine.length - 1);
      const total = mine.reduce((sum, l) => sum + l.n_atom_pairs, 0);
      if (total > 0 && slack > 0) scale = Math.min(scale, slack / total);
    });
    if (!isFinite(scale) || scale <= 0) scale = RIBBON_FLOOR;

    const endpoints = {};   // `${link.tcr}|${link.mhc}|${nodeId}` -> [low, high]
    Object.entries(partners).forEach(([id, mine]) => {
      const arc = arcs[id];
      const usable = arc.width * ARC_FILL;

      let widths = mine.map(l => Math.max(RIBBON_FLOOR, scale * l.n_atom_pairs));
      let pad = RIBBON_PAD;
      let block = widths.reduce((s, w) => s + w, 0) + pad * (mine.length - 1);

      // Only the FLOOR can push a block past its arc (the scale above guarantees the
      // rest fits). Compress rather than spill into the neighbouring residue.
      if (block > usable) {
        const squeeze = usable / block;
        widths = widths.map(w => w * squeeze);
        pad *= squeeze;
        block = usable;
      }

      let at = arc.from + (arc.width - block) / 2;
      mine.forEach((link, index) => {
        endpoints[`${link.tcr}|${link.mhc}|${id}`] = [at, at + widths[index]];
        at += widths[index] + pad;
      });
    });

    /* The ribbon: a quadratic Bezier through the origin from one arc to the other and
     * back, with a straight line across the far arc. This is the shape D3's chord
     * layout draws, and the grant's. */
    function ribbonPath(a, b) {
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

    const dimAll = () =>
      svg.querySelectorAll('.chord-ribbon').forEach(r => r.classList.add('is-dim'));
    const undimAll = () =>
      svg.querySelectorAll('.chord-ribbon').forEach(r => {
        r.classList.remove('is-dim'); r.classList.remove('is-hot');
      });

    /* --- ribbons. Widest first, so a thin ribbon is never buried under a fat one. */
    const ribbons = {};
    [...links].sort((a, b) => b.n_atom_pairs - a.n_atom_pairs).forEach((link) => {
      const tcr = nodeById[link.tcr];
      const mhc = nodeById[link.mhc];
      const path = el('path', {
        d: ribbonPath(
          endpoints[`${link.tcr}|${link.mhc}|${link.tcr}`],
          endpoints[`${link.tcr}|${link.mhc}|${link.mhc}`],
        ),
        class: 'chord-ribbon',
        // coloured by the CDR loop, as the grant's figures are
        fill: COLOURS[link.cdr_loop],
        'data-pair': `${link.tcr}|${link.mhc}`,
      });
      (ribbons[link.tcr] ||= []).push(path);
      (ribbons[link.mhc] ||= []).push(path);

      path.addEventListener('mouseenter', () => {
        dimAll();
        path.classList.remove('is-dim');
        path.classList.add('is-hot');
        // both ends of the contact light up in the structure
        HistoTCR.highlightResidues(
          viewerFor(), [molstarResidue(tcr), molstarResidue(mhc)]);
      });
      path.addEventListener('mousemove', e => showLinkTooltip(e, link, tcr, mhc));
      path.addEventListener('mouseleave', () => {
        undimAll();
        hideTooltip();
        HistoTCR.highlightResidues(viewerFor(), []);
      });
      path.addEventListener('click', () => {
        // a ribbon IS the pair, so zoom to both residues and show what holds them
        HistoTCR.focusResidues(
          viewerFor(), [molstarResidue(tcr), molstarResidue(mhc)]);
        scrollToViewer();
      });

      svg.appendChild(path);
    });

    /* --- arcs, over the ribbons, so the ribbon endpoints are covered cleanly. */
    nodes.forEach((node) => {
      const arc = arcs[node.id];
      const [x1, y1] = polar(arc.from, OUTER);
      const [x2, y2] = polar(arc.to, OUTER);
      const [x3, y3] = polar(arc.to, OUTER - RING);
      const [x4, y4] = polar(arc.from, OUTER - RING);

      const wedge = el('path', {
        // our angles run anti-clockwise, which is clockwise on screen
        d: `M ${x1} ${y1} A ${OUTER} ${OUTER} 0 0 0 ${x2} ${y2}`
         + ` L ${x3} ${y3} A ${OUTER - RING} ${OUTER - RING} 0 0 1 ${x4} ${y4} Z`,
        class: 'chord-arc',
        fill: COLOURS[node.group],
        'data-residue': node.id,
      });

      const mine = partners[node.id] || [];

      wedge.addEventListener('mouseenter', () => {
        dimAll();
        (ribbons[node.id] || []).forEach((r) => {
          r.classList.remove('is-dim'); r.classList.add('is-hot');
        });
        HistoTCR.highlightResidues(viewerFor(), [molstarResidue(node)]);
      });
      wedge.addEventListener('mousemove', e => showNodeTooltip(e, node, mine));
      wedge.addEventListener('mouseleave', () => {
        undimAll();
        hideTooltip();
        HistoTCR.highlightResidues(viewerFor(), []);
      });
      wedge.addEventListener('click', () => {
        // sequence.js takes it if the page shows this residue (a CDR loop or the
        // peptide) — then the sequences and the URL move with the chord.
        if (!handOff(node)) {
          HistoTCR.focusResidues(viewerFor(), [molstarResidue(node)]);
        }
        scrollToViewer();
      });

      svg.appendChild(wedge);

      /* Labels: one-letter code + residue number, at 1.08 x the radius, rotated to
       * read outward and flipped on the left half so they stay right-side-up. The
       * ring tops out at 33 residues in a half (4.2° each), which still leaves ~16px
       * between labels — so every residue keeps its label; none are thinned. */
      const mid = (arc.from + arc.to) / 2;
      const [lx, ly] = polar(mid, LABEL_R);
      const flip = mid > 90 && mid < 270;
      const label = el('text', {
        x: lx, y: ly,
        class: node.unresolved ? 'chord-label is-unresolved' : 'chord-label',
        'text-anchor': flip ? 'end' : 'start',
        'dominant-baseline': 'central',
        transform: `rotate(${flip ? -mid + 180 : -mid} ${lx} ${ly})`,
      });
      label.textContent = node.label;
      svg.appendChild(label);
    });

    root.appendChild(svg);
    fitViewBox(svg);
  }

  /* Shrink the viewBox onto what was actually drawn.
   *
   * The ring is laid out on a fixed SIZE x SIZE canvas, but the drawing never fills
   * it: the labels are the outermost thing and their extent depends on how many
   * residues contact, and how long their labels are. On 1AO7 that left ~36px of dead
   * space above the ring and ~44px below, pushing the diagram away from its heading.
   *
   * So measure the drawing and crop to it. getBBox() is the union of everything on
   * the canvas and needs layout, hence after appendChild. The rendered width doesn't
   * change (the SVG is width:100%), so cropping scales the diagram UP into the space
   * it was wasting. */
  function fitViewBox(svg) {
    const box = svg.getBBox();
    if (!box.width || !box.height) return;   // nothing drawn

    const PAD = 3;   // the labels' own stroke, and a hair of breathing room
    svg.setAttribute(
      'viewBox',
      `${box.x - PAD} ${box.y - PAD} ${box.width + PAD * 2} ${box.height + PAD * 2}`,
    );
  }

  /* --- tooltips ------------------------------------------------------------ */

  const bondRow = (bond) =>
    `<span class="tt-bond">${BOND_LABELS[bond] || bond}</span>`;

  /* The guard case: a residue the contacts name that we cannot find in the
   * coordinates. It does not fire on any structure we hold — but if it ever did, the
   * page must not pretend to know which residue it is. */
  const UNRESOLVED_NOTE = (node) => `
    <div class="tt-warn">
      Chain ${node.chain} has no single residue numbered ${node.resnum} that this
      contact can be pinned to, so selecting it shows every residue of that number.
    </div>`;

  function showLinkTooltip(event, link, tcr, mhc) {
    if (!tooltip) return;
    const bonds = (link.bond_types || []).map(bondRow).join(' ');
    const unresolved = [tcr, mhc].filter(n => n.unresolved);

    tooltip.innerHTML = `
      <div class="tt-title">${tcr.label} &rarr; ${mhc.label}</div>
      <div class="tt-sub-plain">
        ${GROUP_LABELS[link.cdr_loop]} &middot; ${GROUP_LABELS[link.mhc_region]}
      </div>
      <table>
        <tr><td class="tt-k">Atom pairs</td><td>${link.n_atom_pairs}</td></tr>
        <tr><td class="tt-k">Closest</td><td>${
          link.min_distance === null ? '&mdash;' : `${link.min_distance.toFixed(2)} Å`
        }</td></tr>
      </table>
      <div class="tt-sub">Bond types</div>
      <div>${bonds}</div>
      ${unresolved.map(UNRESOLVED_NOTE).join('')}`;
    place(event);
  }

  function showNodeTooltip(event, node, mine) {
    if (!tooltip) return;
    const total = mine.reduce((sum, l) => sum + l.n_atom_pairs, 0);

    tooltip.innerHTML = `
      <div class="tt-title">${node.resname} ${node.resnum}${
        node.icode || ''} &middot; chain ${node.chain}</div>
      <div class="tt-sub-plain">${GROUP_LABELS[node.group]}</div>
      <table>
        <tr><td class="tt-k">Contacts</td><td>${mine.length} residue${
          mine.length === 1 ? '' : 's'}</td></tr>
        <tr><td class="tt-k">Atom pairs</td><td>${total}</td></tr>
      </table>
      ${node.unresolved ? UNRESOLVED_NOTE(node) : ''}`;
    place(event);
  }

  function place(event) {
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
