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
 */
(function () {

  const root = document.getElementById('structure-overlay');
  if (!root) return;

  const ENTRIES = JSON.parse(root.dataset.structures);
  const box = root.querySelector('.molstar-box');
  const status = root.querySelector('.overlay-status');

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
    document.querySelectorAll('.overlay-toggle').forEach((toggle) => {
      toggle.disabled = false;
      toggle.addEventListener('change', () => {
        HistoTCR.toggleOverlayEntry(viewer, toggle.dataset.pdb, toggle.checked);
      });
    });
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
