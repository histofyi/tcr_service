/* Clickable residues in the CDR loops and the peptide, kept in step with Mol* and
 * with the URL.
 *
 * Four ways in, one selection:
 *
 *   sequence -> Mol*   click a residue: zoom to it and show its interactions
 *   Mol* -> sequence   click a residue in 3D: light it up in the sequences, IF it
 *                      is one of the interface residues the page shows
 *   URL -> both        ?residue=e112a lands with the residue already selected
 *   both -> URL        selecting anything rewrites ?residue=, so it is shareable
 *
 * Clicking empty background in Mol* clears all of it.
 *
 * The residue's real number and insertion code come from the coordinate file
 * server-side (functions/residues.py) — they can't be derived from the sequence,
 * because a CDR loop is shorter than its IMGT range and insertion codes are not
 * always in ascending order.
 */
(function () {

  const cells = [...document.querySelectorAll('.aa-click[data-residue]')];
  if (!cells.length) return;

  const VIEWER_ID = 'structure-viewer';
  const URL_PARAM = 'residue';

  const viewer = () => (window.HistoTCR || {}).viewers?.[VIEWER_ID];

  // The residues the page actually shows, by token — this is also the test for
  // "is this residue part of the interface?" when a click comes back from Mol*.
  const byToken = new Map(cells.map(cell => [cell.dataset.residue, cell]));

  // chain-resnum[icode], e.g. e-112a. The chain is part of the key: numbering
  // restarts per chain, so D:28 and E:28 are different residues.
  const tokenFor = (chain, resnum, icode) =>
    `${chain}-${resnum}${icode || ''}`.toLowerCase();

  /* Reflect the selection in the URL. replaceState, not pushState — clicking
   * through a dozen residues shouldn't bury the previous page under a dozen
   * back-button steps. */
  function updateUrl(token) {
    try {
      const url = new URL(window.location.href);
      if (token) url.searchParams.set(URL_PARAM, token);
      else url.searchParams.delete(URL_PARAM);
      window.history.replaceState(null, '', url.toString());
    } catch (e) { /* history unavailable — the in-page selection still works */ }
  }

  function markOnly(cell) {
    cells.forEach(other => other.classList.remove('is-selected'));
    if (cell) cell.classList.add('is-selected');
  }

  /* Select a residue from any origin. `focus` moves the camera (we don't when the
   * click came FROM Mol*, since it's already in view). */
  function select(cell, opts) {
    opts = opts || {};
    markOnly(cell);
    updateUrl(cell.dataset.residue);

    const active = viewer();
    if (!active) return;

    if (opts.focus !== false) {
      HistoTCR.focusResidue(
        active, cell.dataset.chain,
        parseInt(cell.dataset.resnum, 10), cell.dataset.icode || '',
      );
    }
    if (opts.scroll) {
      document.getElementById('structure-top')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function clearSelection() {
    markOnly(null);
    updateUrl(null);
    HistoTCR.clearFocus(viewer());
  }

  /* --- sequence -> Mol* --------------------------------------------------- */

  cells.forEach((cell) => {
    cell.addEventListener('mouseenter', () => {
      HistoTCR.highlightResidue(
        viewer(), cell.dataset.chain,
        parseInt(cell.dataset.resnum, 10), cell.dataset.icode || '',
      );
    });

    cell.addEventListener('mouseleave', () => {
      HistoTCR.highlightResidue(viewer(), null);
    });

    cell.addEventListener('click', () => select(cell, { scroll: true }));
  });

  /* --- Mol* -> sequence, and the URL-restored selection -------------------- */

  function wire(active) {
    if (!active) return;

    HistoTCR.subscribeClicks(
      active,
      (residue) => {
        // Only residues the page actually shows — clicking the MHC framework in
        // 3D has nothing to light up in a sequence, so leave the selection alone.
        const cell = byToken.get(tokenFor(residue.chain, residue.resnum, residue.icode));
        if (cell) select(cell, { focus: false });
      },
      // a click on empty background resets the view: clear the sequences too
      () => clearSelection(),
    );

    // A selection restored from ?residue= is already marked in the markup
    // (server-side), so it survives even with no JS. Now that the structure is
    // loaded, focus it too.
    const restored = cells.find(cell => cell.classList.contains('is-selected'));
    if (restored) {
      HistoTCR.focusResidue(
        active, restored.dataset.chain,
        parseInt(restored.dataset.resnum, 10), restored.dataset.icode || '',
      );
    }
  }

  /* --- chord -> sequences --------------------------------------------------
   *
   * The chord (static/chord.js) fires this when a residue arc is clicked, so a
   * fifth way in leads to the SAME selection: the sequences light up, the URL gets
   * its ?residue=, and the chord's click is not a separate, disagreeing thing.
   *
   * Cancelling the event tells the chord we have taken the residue and will focus
   * it. We only take the residues this page has a CELL for — the CDR loops and the
   * peptide. An α1/α2 helix residue has an arc but no cell, so the chord focuses
   * that one itself.
   *
   * But it still goes in the URL. A helix residue is every bit as selectable as a
   * CDR one — it is just selected somewhere else on the page — and a link to it is
   * every bit as worth sharing. So we clear the sequence cells (nothing there is
   * selected any more) and write the token anyway; the server accepts it because
   * the interaction map can show it. */
  document.addEventListener('histotcr:residue', (event) => {
    const cell = byToken.get(event.detail.token);
    if (cell) {
      select(cell, { scroll: true });
      event.preventDefault();
      return;
    }
    markOnly(null);
    updateUrl(event.detail.token);
  });

  /* The viewer is created asynchronously by viewer.js's autoInit, so it may not
   * exist yet. Poll briefly rather than racing it. */
  let waited = 0;
  const waitForViewer = setInterval(() => {
    const active = viewer();
    if (active) {
      clearInterval(waitForViewer);
      wire(active);
    } else if ((waited += 200) > 30000) {
      clearInterval(waitForViewer);   // Mol* never loaded; sequences still hover
    }
  }, 200);
})();
