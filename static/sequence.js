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

  /* The interaction map's residues. A CDR or peptide residue has a cell here; an α1/α2
   * one has only an arc over there — but it is just as selectable, and a click on it
   * in Mol* must be honoured. So the set of selectable residues is the union of the
   * two, and it is what stops a click on, say, β2-microglobulin writing a ?residue=
   * the server would only reject on reload. */
  const chordRoot = document.getElementById('chord-diagram');
  const chordTokens = new Set(
    chordRoot
      ? (JSON.parse(chordRoot.dataset.chord).nodes || [])
          .map(node => node.token).filter(Boolean)
      : [],
  );

  const selectable = (token) => byToken.has(token) || chordTokens.has(token);

  /* Say what is selected now, so the other views of it can follow. The interaction map
   * listens: it rings the arc, holds its ribbons lit and stands its card up. */
  function broadcast(token) {
    document.dispatchEvent(new CustomEvent('histotcr:selection', {
      detail: { token: token || null },
    }));
  }

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
    broadcast(cell.dataset.residue);

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

  /* A residue the interaction map shows but the sequences do not — an α1 or α2 one. It
   * has no cell to mark, but it is still THE selection: it goes in the URL and it is
   * broadcast, so the map rings its arc and stands its card up. */
  function selectMapOnly(token) {
    markOnly(null);
    updateUrl(token);
    broadcast(token);
  }

  function clearSelection() {
    markOnly(null);
    updateUrl(null);
    broadcast(null);
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
        const token = tokenFor(residue.chain, residue.resnum, residue.icode);
        const cell = byToken.get(token);

        // A residue with a cell: light up the sequence. One with only an arc on the
        // interaction map (α1/α2): still the selection — the map shows it.
        // Anything else — β2m, the MHC framework, the TCR constant domains — is not
        // part of the interface the page describes, and clicking it selects nothing
        // rather than wiping what you had.
        if (cell) select(cell, { focus: false });
        else if (chordTokens.has(token)) selectMapOnly(token);
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
    selectMapOnly(event.detail.token);
  });

  /* The map asking for a reset — a click on its background, or on a ribbon, which is a
   * pair rather than a residue. Same reset as clicking empty space in Mol*. */
  document.addEventListener('histotcr:residue-clear', () => clearSelection());

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
