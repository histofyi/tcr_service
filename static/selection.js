/* The selected structure on a TCR page — one store, several views.
 *
 * A TCR page shows the same set of structures four ways: the structure table, the
 * publication list, the COM viewer and the superposition. Selecting a structure in
 * any of them has to light it up in all of them, and put it in the URL so the view
 * can be shared. That is one piece of state, so it lives in one place rather than
 * being owned by whichever component happened to need it first.
 *
 * The store owns the parts of the selection that are not any one component's: the
 * table and publication highlights, and the ?structure= query arg. Components
 * subscribe for the rest.
 *
 * `source` on a change lets a component ignore the echo of its own action — the
 * superposition drives the selection when it is narrowed to a single structure, and
 * must not then re-apply that selection to its own toggles.
 */
(function () {

  const URL_PARAM = 'structure';

  const root = document.getElementById('tcr-selection');
  // Server-validated against this TCR's own structures — an unknown or foreign PDB
  // id in the URL arrives here as empty.
  let selected = (root && root.dataset.selected) || null;

  const listeners = [];

  /* Reflect the selection in the URL so it can be shared. The id goes in lower-case,
   * matching the PDB ids in the site's paths; the handler reads it case-insensitively,
   * so a hand-typed ?structure=3PWP works too.
   *
   * replaceState, not pushState — clicking through a dozen COMs shouldn't bury the
   * previous page under a dozen back-button steps. */
  function updateUrl(pdbId) {
    try {
      const url = new URL(window.location.href);
      if (pdbId) url.searchParams.set(URL_PARAM, pdbId.toLowerCase());
      else url.searchParams.delete(URL_PARAM);
      window.history.replaceState(null, '', url.toString());
    } catch (e) { /* history unavailable — the in-page selection still works */ }
  }

  /* Light up the structure's row, and any publication that reported it. */
  function highlight(pdbId) {
    document.querySelectorAll('.structure-table tr.is-selected, [data-structures].is-selected')
      .forEach(node => node.classList.remove('is-selected'));

    if (!pdbId) return null;

    const row = document.getElementById(`structure-row-${pdbId}`);
    if (row) row.classList.add('is-selected');

    document.querySelectorAll('[data-structures]').forEach((publication) => {
      const reported = publication.dataset.structures.split(/\s+/);
      if (reported.includes(pdbId)) publication.classList.add('is-selected');
    });

    return row;
  }

  function change(pdbId, opts) {
    const options = opts || {};
    selected = pdbId;

    const row = highlight(pdbId);
    if (row && options.scroll !== false) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    updateUrl(pdbId);

    listeners.forEach(listener => listener(pdbId, options));
  }

  window.TcrSelection = {
    current: () => selected,
    select: (pdbId, opts) => change(pdbId, opts),
    clear: (opts) => change(null, opts),
    subscribe: (listener) => { listeners.push(listener); },
  };
})();
