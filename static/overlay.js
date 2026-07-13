/* The structure overlay on a TCR page.
 *
 * Every structure of this TCR, superposed. The coordinates are all on the
 * 1hhk-aligned frame, so they overlay directly — there is nothing to fit. The
 * groove is drawn once from the reference structure and each structure's TCR
 * chains are drawn over it in their own colour, so you can see how far the
 * receptor's docking geometry moves between them.
 *
 * Loaded LAZILY, when the section first scrolls into view: a TCR can have ten
 * structures and each coordinate file is ~400KB, so eagerly fetching 4MB would
 * slow the page down for everyone who never scrolls this far.
 *
 * Bound both ways to TcrSelection (selection.js). Selecting a structure — in the
 * URL, the COM viewer, anywhere — narrows the overlay to that one structure, because
 * a superposition of ten is the wrong thing to be looking at once you have picked
 * one out. And narrowing the overlay by hand to a single structure IS a selection, so
 * it lights that structure up in the table, the publications and the COM viewer, and
 * puts it in the URL.
 */
(function () {

  const root = document.getElementById('structure-overlay');
  if (!root) return;

  const ENTRIES = JSON.parse(root.dataset.structures);
  const box = root.querySelector('.molstar-box');
  const status = root.querySelector('.overlay-status');
  const selection = window.TcrSelection;

  let viewer = null;
  let started = false;

  async function build() {
    if (started) return;
    started = true;

    status.textContent = `Loading ${ENTRIES.length} structures…`;

    viewer = await HistoTCR.overlay(box, ENTRIES);
    if (!viewer) {
      status.textContent = 'Mol* failed to load.';
      return;
    }

    status.hidden = true;

    // Each structure can be toggled off, which is the only way to read a busy
    // overlay — ten cartoons on top of each other is a hairball otherwise.
    // NB the toggles live in the column BESIDE the viewer, not inside #structure-overlay.
    const toggles = Array.from(document.querySelectorAll('.overlay-toggle'));

    /* Drive the viewer from the checkboxes. toggleOverlayEntry is state-aware — it
     * no-ops on a structure already in the state asked for — so this can just push
     * every toggle's state through without tracking what changed. */
    function render() {
      toggles.forEach((toggle) => {
        HistoTCR.toggleOverlayEntry(viewer, toggle.dataset.pdb, toggle.checked);
      });
    }

    /* Show exactly the structures named, or all of them if `pdbIds` is null.
     * Programmatic — setting .checked fires no change event, so this cannot loop
     * back into publish(). */
    function show(pdbIds) {
      toggles.forEach((toggle) => {
        toggle.checked = !pdbIds || pdbIds.includes(toggle.dataset.pdb);
      });
      render();
    }

    /* The overlay narrowed to a single structure IS a selection of that structure.
     * Any other count — none, some, all — is not a selection of one thing, so it
     * clears. Never scrolls: the user is looking at the viewer, and yanking the page
     * down to the structure table would take it away from them. */
    function publish() {
      const shown = toggles.filter(toggle => toggle.checked);
      if (shown.length === 1) {
        selection.select(shown[0].dataset.pdb, { scroll: false, source: 'overlay' });
      } else if (selection.current()) {
        selection.clear({ source: 'overlay' });
      }
    }

    toggles.forEach((toggle) => {
      toggle.disabled = false;
      toggle.addEventListener('change', () => { render(); publish(); });
    });

    document.querySelectorAll('.overlay-btns button').forEach((button) => {
      button.disabled = false;
    });
    document.querySelector('.overlay-all')
      .addEventListener('click', () => { show(null); publish(); });
    document.querySelector('.overlay-none')
      .addEventListener('click', () => { show([]); publish(); });

    // A selection made elsewhere narrows the overlay to it; clearing it brings them
    // all back. Ignore our own echo — publish() has already put the toggles where
    // they should be, and re-applying would fight the user's own ticking.
    selection.subscribe((pdbId, opts) => {
      if (opts && opts.source === 'overlay') return;
      show(pdbId ? [pdbId] : null);
    });

    // A structure already selected on load — from ?structure= — narrows the overlay
    // as soon as it builds. It builds lazily, so this cannot be done by the
    // subscription above.
    if (selection.current()) show([selection.current()]);
  }

  // Build when the section comes into view; fall back to building immediately if
  // IntersectionObserver isn't available.
  if (!('IntersectionObserver' in window)) {
    build();
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting)) {
      observer.disconnect();
      build();
    }
  }, { rootMargin: '200px' });

  observer.observe(root);
})();
