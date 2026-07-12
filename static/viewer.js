/* histo.fyi TCRs — Mol* helpers.
 *
 * Loads an IMGT-renumbered, aligned TCR:pMHC structure with Mol*'s own default
 * chain-id colouring, and adds ball-and-stick for the peptide, which is too short
 * to read as cartoon alone. Chains in these files are always:
 *
 *   A = MHC α (heavy chain)   B = β2-microglobulin   C = peptide
 *   D = TCR α                 E = TCR β
 *
 * The bundled Mol* (static/molstar.js) re-exports the selection API (MS, Script,
 * StructureSelection, StructureElement) which the CDN "viewer" build omits — that
 * is what lets us pick the peptide out as its own component and focus a residue.
 */
window.HistoTCR = (function () {

  const PEPTIDE_CHAIN = 'C';

  // The chains these files always carry. Used to look up what colour Mol*'s
  // chain-id theme gave each one, so the page legend matches the render.
  const CHAIN_LABELS = {
    A: 'MHC α (heavy chain)',
    B: 'β2-microglobulin',
    C: 'Peptide',
    D: 'TCR α',
    E: 'TCR β',
  };

  // Viewers created by autoInit, keyed by their container's DOM id, so a page can
  // reach in and swap the structure (the explore page does this on COM click).
  const viewers = {};

  function chainExpression(chainId) {
    const MS = molstar.MS;
    return MS.struct.generator.atomGroups({
      'chain-test': MS.core.rel.eq([
        MS.struct.atomProperty.macromolecular.auth_asym_id(), chainId,
      ]),
    });
  }

  /* Load `url` into an existing, empty viewer: the default preset (cartoon,
   * coloured by Mol*'s chain-id theme) plus ball-and-stick on the peptide. */
  async function renderStructure(viewer, url, opts) {
    opts = opts || {};
    const peptideChain = opts.peptideChain || PEPTIDE_CHAIN;
    const plugin = viewer.plugin;

    await viewer.loadStructureFromUrl(url, opts.format || 'pdb', false, {
      representationParams: { theme: { globalName: 'chain-id' } },
    });

    // Pull the peptide out as its own component so it can carry a second
    // representation. Its colour still comes from the chain-id theme, so it stays
    // consistent with the cartoon behind it.
    const structures = plugin.managers.structure.hierarchy.current.structures;
    if (structures && structures.length) {
      const component = await plugin.builders.structure.tryCreateComponentFromExpression(
        structures[0].cell, chainExpression(peptideChain), 'peptide', { label: 'Peptide' },
      );
      if (component) {
        await plugin.builders.structure.representation.addRepresentation(component, {
          type: 'ball-and-stick',
          color: 'chain-id',
        });
      }
    }

    if (plugin.canvas3d) {
      plugin.canvas3d.setProps({
        renderer: {
          backgroundColor: 0xffffff,
          highlightColor: 0x514c7d,
          selectColor: 0x28a299,
        },
      });
    }
  }

  /* Read the colour Mol*'s chain-id theme actually gave each chain, so the page
   * legend can be painted to match rather than hard-coding a guess at the
   * palette. Returns { A: '#rrggbb', ... } for the chains present in the file. */
  function chainThemeColors(viewer) {
    const colors = {};
    try {
      const plugin = viewer.plugin;
      const entry = plugin.managers.structure.hierarchy.current.structures[0];
      const structure = entry.cell.obj.data;

      const provider =
        plugin.representation.structure.themes.colorThemeRegistry.get('chain-id');
      const ctx = { structure };
      const params = provider.getParams ? provider.getParams(ctx) : {};
      const values = {};
      Object.keys(params).forEach(k => { values[k] = params[k].defaultValue; });
      const theme = provider.factory(ctx, values);

      for (const chainId of Object.keys(CHAIN_LABELS)) {
        const loci = molstar.StructureSelection.toLociWithSourceUnits(
          molstar.Script.getStructureSelection(chainExpression(chainId), structure));
        if (molstar.StructureElement.Loci.isEmpty(loci)) continue;
        const location = molstar.StructureElement.Loci.getFirstLocation(loci);
        const color = theme.color(location, false);
        colors[chainId] = '#' + ('000000' + color.toString(16)).slice(-6);
      }
    } catch (e) { /* legend just stays unpainted */ }
    return colors;
  }

  /* Paint the swatches of the legend belonging to `viewerId`. */
  function paintLegend(viewerId, viewer) {
    const colors = chainThemeColors(viewer);
    document
      .querySelectorAll(`.mol-legend[data-viewer="${viewerId}"] .swatch[data-chain]`)
      .forEach(swatch => {
        const color = colors[swatch.dataset.chain];
        if (color) {
          swatch.style.background = color;
          swatch.closest('span').hidden = false;
        } else {
          // chain absent from this file — don't advertise it
          swatch.closest('span').hidden = true;
        }
      });
  }

  // Chrome stripped back to Reset Camera + Full window; the rest is noise on a
  // page that already says what the structure is.
  const VIEWER_SPEC = {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowSequence: false,
    layoutShowLog: false,
    collapseLeftPanel: true,
    viewportShowExpand: true,
    viewportShowControls: false,
    viewportShowSettings: false,
    viewportShowSelectionMode: false,
    viewportShowAnimation: false,
    viewportShowTrajectoryControls: false,
  };

  /* An empty viewer, ready for a later replace() — the explore page's lower panel
   * before a COM has been clicked. */
  async function emptyViewer(el) {
    if (!window.molstar) {
      el.innerHTML = '<p><small>Mol* failed to load.</small></p>';
      return null;
    }
    const viewer = await molstar.Viewer.create(el, VIEWER_SPEC);
    if (viewer.plugin.canvas3d) {
      viewer.plugin.canvas3d.setProps({
        renderer: { backgroundColor: 0xffffff },
      });
    }
    return viewer;
  }

  /* Create a viewer in `el` and load `url`. Returns the viewer, or null if Mol*
   * is unavailable. */
  async function load(el, url, opts) {
    if (!window.molstar) {
      el.innerHTML = '<p><small>Mol* failed to load.</small></p>';
      return null;
    }

    const viewer = await molstar.Viewer.create(el, VIEWER_SPEC);

    try {
      await renderStructure(viewer, url, opts);
    } catch (e) {
      el.insertAdjacentHTML('beforeend',
        '<p><small>Could not load this structure.</small></p>');
    }
    return viewer;
  }

  /* Swap the structure shown in an existing viewer (the explore page does this
   * when a COM is clicked). On failure the previous structure is left up rather
   * than blanking the panel. */
  async function replace(viewer, url, opts) {
    if (!viewer) return null;
    try {
      await viewer.plugin.clear();
      await renderStructure(viewer, url, opts);
      if (opts && opts.viewerId) paintLegend(opts.viewerId, viewer);
    } catch (e) { /* keep whatever was there */ }
    return viewer;
  }

  /* Zoom to (auth chain, auth residue number) and show its interactions. */
  function focusResidue(viewer, chainId, resnum) {
    if (!viewer || !molstar.MS) return;
    const structures =
      viewer.plugin.managers.structure.hierarchy.current.structures;
    if (!structures || !structures.length || !structures[0].cell.obj) return;
    const structure = structures[0].cell.obj.data;

    const MS = molstar.MS;
    const expr = MS.struct.generator.atomGroups({
      'chain-test': MS.core.rel.eq([
        MS.struct.atomProperty.macromolecular.auth_asym_id(), chainId,
      ]),
      'residue-test': MS.core.rel.eq([
        MS.struct.atomProperty.macromolecular.auth_seq_id(), resnum,
      ]),
    });
    const loci = molstar.StructureSelection.toLociWithSourceUnits(
      molstar.Script.getStructureSelection(expr, structure));
    if (molstar.StructureElement.Loci.isEmpty(loci)) return;

    viewer.plugin.managers.camera.focusLoci(loci);
    viewer.plugin.managers.structure.focus.setFromLoci(loci);
  }

  /* Every `.molstar-box[data-structure-url]` on the page becomes a viewer, keyed
   * by its DOM id in HistoTCR.viewers. A box with an empty data-structure-url is
   * created empty, ready for a later replace() — that is the explore page's lower
   * panel before anything has been clicked. */
  async function autoInit() {
    const boxes = document.querySelectorAll('.molstar-box[data-structure-url]');
    for (const box of boxes) {
      const url = box.dataset.structureUrl;
      if (url) {
        const viewer = await load(box, url);
        viewers[box.id] = viewer;
        if (viewer) paintLegend(box.id, viewer);
      } else {
        viewers[box.id] = await emptyViewer(box);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', autoInit);

  return { load, replace, focusResidue, renderStructure, paintLegend, viewers };
})();
