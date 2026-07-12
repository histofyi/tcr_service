/* The scoped COM viewer on a TCR page.
 *
 * The same projection as /tcrs/explore — every centre of mass mapped onto the
 * 1hhk antigen-binding domain — but showing only this TCR's structures, and
 * wired the other way round: clicking a COM does NOT load a structure, it
 * highlights that structure's row in the list above. The list is the subject of
 * the page; the projection is a way into it.
 */
(function () {

  const root = document.getElementById('com-scope');
  if (!root) return;

  const POINTS = JSON.parse(root.dataset.points);
  const LAYERS = JSON.parse(root.dataset.layers);
  const COLORS = JSON.parse(root.dataset.antigenColors);
  const W = parseFloat(root.dataset.width);
  const H = parseFloat(root.dataset.height);
  const REF = JSON.parse(root.dataset.ref);   // the ABD's own centre of mass

  const bg = root.querySelector('.com-scope-bg');
  const cv = root.querySelector('.com-scope-canvas');
  const wrap = root.querySelector('.com-scope-wrap');
  const select = root.querySelector('.com-scope-type');
  const card = root.querySelector('.com-scope-card');
  const ctx = cv.getContext('2d');

  const RADIUS = 11;

  let layer = 'footprint';   // where the whole interface sits, the best default
  let scale = 1;
  let selected = null;
  let hovered = null;

  const visible = () =>
    POINTS.filter(p => p.com_px && p.com_px[layer]);

  const at = (p) => ({ x: p.com_px[layer].x * scale, y: p.com_px[layer].y * scale });

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);

    visible().forEach((p) => {
      const { x, y } = at(p);
      const colour = COLORS[p.antigen_type] || '#999999';
      const isOn = p.pdb_id === selected || p.pdb_id === hovered;

      ctx.beginPath();
      ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.globalAlpha = isOn ? 0.75 : 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = isOn ? 2.5 : 1;
      ctx.strokeStyle = isOn ? '#0a0039' : colour;
      ctx.stroke();
    });

    // The antigen-binding domain's own centre of mass — the fixed point every
    // COM is read against. Drawn last so it sits above the circles, and to the
    // same recipe as the explore viewer.
    if (REF) {
      ctx.beginPath();
      ctx.arc(REF.x * scale, REF.y * scale, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  function layout() {
    const width = root.querySelector('.com-scope-stage').clientWidth;
    const height = width * H / W;
    const dpr = window.devicePixelRatio || 1;

    wrap.style.width = `${width}px`;
    wrap.style.height = `${height}px`;
    cv.width = width * dpr;
    cv.height = height * dpr;
    cv.style.width = `${width}px`;
    cv.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    scale = width / W;
    draw();
  }

  /* The nearest point within the marker radius, or null. */
  function pick(mx, my) {
    let best = null;
    let bestDistance = RADIUS * RADIUS;
    visible().forEach((p) => {
      const { x, y } = at(p);
      const dx = x - mx;
      const dy = y - my;
      const distance = dx * dx + dy * dy;
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = p;
      }
    });
    return best;
  }

  const rowFor = (pdbId) => document.getElementById(`structure-row-${pdbId}`);

  function selectStructure(pdbId) {
    selected = pdbId;
    draw();

    document.querySelectorAll('.structure-table tr.is-selected')
      .forEach(row => row.classList.remove('is-selected'));

    const row = rowFor(pdbId);
    if (row) {
      row.classList.add('is-selected');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function showCard(event, p) {
    card.innerHTML = `
      <div class="pdb">${p.pdb_id}</div>
      <table>
        <tr><td class="k">Allele</td><td>${p.allele}</td></tr>
        <tr><td class="k">Peptide</td><td class="mono">${p.peptide}</td></tr>
        <tr><td class="k">Antigen</td><td>${p.antigen_label}</td></tr>
        <tr><td class="k">Resolution</td><td>${p.resolution ? p.resolution + ' Å' : '—'}</td></tr>
      </table>`;
    card.style.display = 'block';

    const pad = 14;
    const box = card.getBoundingClientRect();
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + box.width > window.innerWidth) x = event.clientX - box.width - pad;
    if (y + box.height > window.innerHeight) y = event.clientY - box.height - pad;
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }

  cv.addEventListener('mousemove', (e) => {
    const r = cv.getBoundingClientRect();
    const p = pick(e.clientX - r.left, e.clientY - r.top);
    if (!p) {
      card.style.display = 'none';
      cv.style.cursor = 'default';
      if (hovered !== null) { hovered = null; draw(); }
      return;
    }
    cv.style.cursor = 'pointer';
    if (hovered !== p.pdb_id) { hovered = p.pdb_id; draw(); }
    showCard(e, p);
  });

  cv.addEventListener('mouseleave', () => {
    card.style.display = 'none';
    if (hovered !== null) { hovered = null; draw(); }
  });

  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const p = pick(e.clientX - r.left, e.clientY - r.top);
    // Clicking empty background clears the selection, same as the explore viewer.
    if (p) selectStructure(p.pdb_id);
    else {
      selected = null;
      draw();
      document.querySelectorAll('.structure-table tr.is-selected')
        .forEach(row => row.classList.remove('is-selected'));
    }
  });

  // The reverse link: hovering a row lights up its COM.
  POINTS.forEach((p) => {
    const row = rowFor(p.pdb_id);
    if (!row) return;
    row.addEventListener('mouseenter', () => { hovered = p.pdb_id; draw(); });
    row.addEventListener('mouseleave', () => { hovered = null; draw(); });
  });

  Object.entries(LAYERS).forEach(([key, label]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = label;
    if (key === layer) option.selected = true;
    select.appendChild(option);
  });

  select.addEventListener('change', (e) => { layer = e.target.value; draw(); });
  window.addEventListener('resize', layout);

  bg.onload = layout;
  bg.src = root.dataset.background;
  if (bg.complete) layout();
})();
