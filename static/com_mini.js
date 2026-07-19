/* The mini COM viewer on a structure page.
 *
 * The same 1hhk projection as /tcrs/explore and the scoped viewer on a TCR page, but
 * showing a SINGLE point — this structure's centre of mass — with a dropdown to switch
 * which centre of mass (the peptide's, the whole TCR's, the CDR loops', the footprint).
 * It answers "where does this one structure sit on the groove", beside the interface
 * figures that describe what it does there.
 *
 * No hover card, no selection: there is one point and it is this page's structure, so
 * there is nothing to pick.
 */
(function () {

  const root = document.getElementById('com-mini');
  if (!root) return;

  const POINT = JSON.parse(root.dataset.point);        // { layer: {x, y}, ... } in image px
  const LAYERS = JSON.parse(root.dataset.layers);      // { key: label }
  const REF = JSON.parse(root.dataset.ref);            // the ABD's own centre of mass
  const CROP = JSON.parse(root.dataset.crop);          // { top, height } — the visible band
  const W = parseFloat(root.dataset.width);            // projection width, image px
  const COLOUR = root.dataset.colour || '#0a0039';     // this structure's antigen colour

  const bg = root.querySelector('.com-mini-bg');
  const cv = root.querySelector('.com-mini-canvas');
  const wrap = root.querySelector('.com-mini-wrap');
  const select = root.querySelector('.com-mini-type');
  const ctx = cv.getContext('2d');

  const RADIUS = 9;

  // Footprint centre — where the whole interface sits — is the best default, matching
  // the scoped viewer on a TCR page.
  let layer = POINT.footprint ? 'footprint' : Object.keys(LAYERS)[0];
  let scale = 1;

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, CROP.top * scale, cv.width / dpr, CROP.height * scale);

    const p = POINT[layer];
    if (p) {
      ctx.beginPath();
      ctx.arc(p.x * scale, p.y * scale, RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = COLOUR;
      ctx.globalAlpha = 0.75;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0a0039';
      ctx.stroke();
    }

    // The antigen-binding domain's own centre of mass — the fixed point every COM is
    // read against. Drawn last, to the same recipe as the other viewers.
    if (REF) {
      ctx.beginPath();
      ctx.arc(REF.x * scale, REF.y * scale, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  function layout() {
    const width = root.querySelector('.com-mini-stage').clientWidth;
    const dpr = window.devicePixelRatio || 1;

    scale = width / W;
    const height = CROP.height * scale;
    const offset = CROP.top * scale;

    wrap.style.width = `${width}px`;
    wrap.style.height = `${height}px`;
    bg.style.top = `${-offset}px`;

    cv.width = width * dpr;
    cv.height = height * dpr;
    cv.style.width = `${width}px`;
    cv.style.height = `${height}px`;
    // translate by -offset so draw() keeps working in original image space
    ctx.setTransform(dpr, 0, 0, dpr, 0, -offset * dpr);

    draw();
  }

  // Only offer layers this structure actually has a point for.
  Object.entries(LAYERS).forEach(([key, label]) => {
    if (!POINT[key]) return;
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
