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

  const CHAIN_LABELS = {
    A: 'MHC α (heavy chain)',
    B: 'β2-microglobulin',
    C: 'Peptide',
    D: 'TCR α',
    E: 'TCR β',
  };

  /* Mol*'s own chain-id palette (Dark2), but pinned to the chain LETTER.
   *
   * Mol*'s chain-id theme colours by chain INDEX — the order the chains first
   * appear in the file — not by their id. 10 of the 206 structures have a
   * non-standard chain order (9ZCL's file starts with chain C; 7L1D and three
   * others start D,E,A,B,C), so the same colour meant a different chain on those
   * pages: the peptide came out MHC-green. The palette is Mol*'s, so the site
   * looks unchanged; the assignment is ours, so it is the same everywhere.
   *
   * These are the exact colours Mol* gives a canonical A-B-C-D-E file.
   */
  const CHAIN_COLOURS = {
    A: 0x1b9e77,   // MHC α — green
    B: 0xd95f02,   // β2m — orange
    C: 0x7570b3,   // peptide — purple
    D: 0xe7298a,   // TCR α — pink
    E: 0x66a61e,   // TCR β — olive
  };

  const hex = (value) => '#' + ('000000' + value.toString(16)).slice(-6);

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

  /* Load `url` into an existing, empty viewer: one cartoon component per chain, in
   * the house colours, plus ball-and-stick on the peptide.
   *
   * A component per chain — rather than the chain-id theme over the whole
   * structure — is what lets the colour be pinned to the chain id instead of the
   * chain's position in the file. See CHAIN_COLOURS. */
  async function renderStructure(viewer, url, opts) {
    opts = opts || {};
    const peptideChain = opts.peptideChain || PEPTIDE_CHAIN;
    const plugin = viewer.plugin;
    const builders = plugin.builders.structure;

    const data = await plugin.builders.data.download({ url, isBinary: false });
    const trajectory = await builders.parseTrajectory(data, opts.format || 'pdb');
    const model = await builders.createModel(trajectory);
    const structure = await builders.createStructure(model);

    for (const chainId of Object.keys(CHAIN_COLOURS)) {
      const component = await builders.tryCreateComponentFromExpression(
        structure, chainExpression(chainId), `chain-${chainId}`, { label: chainId },
      );
      // A chain can be absent — 9RU5 has no β2-microglobulin.
      if (!component) continue;

      await builders.representation.addRepresentation(component, {
        type: 'cartoon',
        color: 'uniform',
        colorParams: { value: CHAIN_COLOURS[chainId] },
      });

      // The peptide is short and reads poorly as cartoon alone.
      if (chainId === peptideChain) {
        await builders.representation.addRepresentation(component, {
          type: 'ball-and-stick',
          color: 'uniform',
          colorParams: { value: CHAIN_COLOURS[chainId] },
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

  /* Which chains this structure actually has, and their colour. The colour is now
   * ours (pinned to the chain id), so this only has to establish presence — 9RU5
   * has no β2-microglobulin, and its legend must not advertise one. */
  function chainThemeColors(viewer) {
    const colors = {};
    try {
      const structure = currentStructure(viewer);
      if (!structure) return colors;

      for (const chainId of Object.keys(CHAIN_COLOURS)) {
        const loci = molstar.StructureSelection.toLociWithSourceUnits(
          molstar.Script.getStructureSelection(chainExpression(chainId), structure));
        if (molstar.StructureElement.Loci.isEmpty(loci)) continue;
        colors[chainId] = hex(CHAIN_COLOURS[chainId]);
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

  /* Mol*'s focus representation — the side chains and contacts it draws when you
   * focus a residue — is left at its defaults: element-symbol, whose CARBON atoms
   * take a `chain-id` sub-theme. So side chains come out coloured by their chain
   * with CPK heteroatoms (red O, blue N), which is what you want to see.
   *
   * That theme colours by chain INDEX, so it only agrees with our cartoon while
   * the coordinate files letter their chains A,B,C,D,E in that order — which the
   * revised drop guarantees. It did NOT hold before: 9ZCL's file used to run
   * C,A,B,D,E, so focusing a peptide residue drew its side chains MHC-green and the
   * MHC's b2m-orange, contradicting the cartoon behind them (BUGS.md #12).
   *
   * The CARTOON is pinned to the chain letter (CHAIN_COLOURS) and so is safe either
   * way. If a file with an odd chain order ever reappears, the focus side chains are
   * where it will show first.
   */

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

  /* Superpose several structures of the same TCR in one viewer.
   *
   * The coordinates are all on the 1hhk-aligned frame, so they overlay directly —
   * there is no fitting to do. What varies between them is where the receptor sits
   * on the groove, so the groove is drawn ONCE (from the reference structure, in
   * the usual chain colours) and every structure's TCR chains are drawn over it,
   * one colour per structure.
   *
   * `entries` is [{ pdb, url, colour }], reference first.
   */
  async function overlay(el, entries, opts) {
    opts = opts || {};
    if (!window.molstar) {
      el.innerHTML = '<p><small>Mol* failed to load.</small></p>';
      return null;
    }

    const viewer = await molstar.Viewer.create(el, VIEWER_SPEC);
    const plugin = viewer.plugin;
    const builders = plugin.builders.structure;

    const load = async (url) => {
      const data = await plugin.builders.data.download({ url, isBinary: false });
      const trajectory = await builders.parseTrajectory(data, 'pdb');
      const model = await builders.createModel(trajectory);
      return builders.createStructure(model);
    };

    // The TCR variable domains — the thing that moves. MS.core.set.has is how Mol*
    // expresses "chain is one of these".
    const tcrChains = () => {
      const MS = molstar.MS;
      return MS.struct.generator.atomGroups({
        'chain-test': MS.core.set.has([
          MS.set(...(opts.tcrChains || ['D', 'E'])),
          MS.struct.atomProperty.macromolecular.auth_asym_id(),
        ]),
      });
    };

    try {
      for (const [index, entry] of entries.entries()) {
        const structure = await load(entry.url);

        // The groove, once, from the reference — it is the fixed frame everything
        // else is read against, so drawing it per structure would just thicken it.
        if (index === 0) {
          for (const chainId of ['A', 'B', 'C']) {
            const component = await builders.tryCreateComponentFromExpression(
              structure, chainExpression(chainId), `ref-${chainId}`, { label: chainId },
            );
            if (!component) continue;
            await builders.representation.addRepresentation(component, {
              type: 'cartoon',
              color: 'uniform',
              colorParams: { value: CHAIN_COLOURS[chainId] },
              typeParams: { alpha: 0.45 },
            });
            if (chainId === PEPTIDE_CHAIN) {
              await builders.representation.addRepresentation(component, {
                type: 'ball-and-stick',
                color: 'uniform',
                colorParams: { value: CHAIN_COLOURS[chainId] },
              });
            }
          }
        }

        const receptor = await builders.tryCreateComponentFromExpression(
          structure, tcrChains(), `tcr-${entry.pdb}`, { label: entry.pdb },
        );
        if (!receptor) continue;

        await builders.representation.addRepresentation(receptor, {
          type: 'cartoon',
          color: 'uniform',
          colorParams: { value: hexToInt(entry.colour) },
        });

        viewers[`overlay-${entry.pdb}`] = viewer;
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
      plugin.managers.camera.reset();
    } catch (e) {
      el.insertAdjacentHTML('beforeend',
        '<p><small>Could not build the overlay.</small></p>');
    }

    return viewer;
  }

  const hexToInt = (colour) =>
    typeof colour === 'number' ? colour : parseInt(String(colour).replace('#', ''), 16);

  /* Show or hide one structure's TCR chains in an overlay. */
  function toggleOverlayEntry(viewer, pdb, visible) {
    try {
      const plugin = viewer.plugin;
      const entry = plugin.managers.structure.hierarchy.current.structures
        .flatMap(s => s.components)
        .find(c => c.cell.obj && c.cell.obj.label === pdb);
      if (!entry) return;
      plugin.managers.structure.component.toggleVisibility([entry], !visible);
    } catch (e) { /* nothing to toggle */ }
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

  function currentStructure(viewer) {
    const structures =
      viewer && viewer.plugin.managers.structure.hierarchy.current.structures;
    if (!structures || !structures.length || !structures[0].cell.obj) return null;
    return structures[0].cell.obj.data;
  }

  /* A loci for a whole chain, or for an inclusive residue range within it.
   * Pass start/end as null for the entire chain (that's how the peptide is
   * selected — it is chain C in its entirety). */
  function rangeLoci(viewer, chainId, start, end) {
    if (!viewer || !molstar.MS) return null;
    const structure = currentStructure(viewer);
    if (!structure) return null;

    const MS = molstar.MS;
    const seqId = MS.struct.atomProperty.macromolecular.auth_seq_id();
    const tests = {
      'chain-test': MS.core.rel.eq([
        MS.struct.atomProperty.macromolecular.auth_asym_id(), chainId,
      ]),
    };
    if (start !== null && start !== undefined && end !== null && end !== undefined) {
      tests['residue-test'] = MS.core.logic.and([
        MS.core.rel.gre([seqId, start]),
        MS.core.rel.lte([seqId, end]),
      ]);
    }

    const loci = molstar.StructureSelection.toLociWithSourceUnits(
      molstar.Script.getStructureSelection(
        MS.struct.generator.atomGroups(tests), structure));
    return molstar.StructureElement.Loci.isEmpty(loci) ? null : loci;
  }

  /* A loci for a single residue, identified by (chain, number, insertion code).
   *
   * The insertion code matters: 57 structures have one in the TCR chains, and
   * 1AO7 has both E:112 and E:112A — both inside CDR3β. Selecting on the number
   * alone would light up two residues when the reader clicked one. */
  function residueLoci(viewer, chainId, resnum, icode) {
    if (!viewer || !molstar.MS) return null;
    const structure = currentStructure(viewer);
    if (!structure) return null;

    const MS = molstar.MS;
    // The insertion-code test is ALWAYS applied, including when there isn't one.
    // Mol* reports '' for a residue with no insertion code, so testing for ''
    // correctly excludes 112A when you asked for 112 — omit the test and clicking
    // E:112 lights up both E:112 and E:112A.
    const tests = {
      'chain-test': MS.core.rel.eq([
        MS.struct.atomProperty.macromolecular.auth_asym_id(), chainId,
      ]),
      'residue-test': MS.core.logic.and([
        MS.core.rel.eq([
          MS.struct.atomProperty.macromolecular.auth_seq_id(), resnum,
        ]),
        MS.core.rel.eq([
          MS.struct.atomProperty.macromolecular.pdbx_PDB_ins_code(), icode || '',
        ]),
      ]),
    };

    const loci = molstar.StructureSelection.toLociWithSourceUnits(
      molstar.Script.getStructureSelection(
        MS.struct.generator.atomGroups(tests), structure));
    return molstar.StructureElement.Loci.isEmpty(loci) ? null : loci;
  }

  /* Mol* -> page: read (chain, resnum, icode, resname) out of a clicked loci.
   * The bundle exposes StructureElement but not StructureProperties, so read
   * straight off the model's atomic hierarchy. Returns null on a background click
   * or any unexpected shape. */
  function readLociResidue(loci) {
    try {
      const SE = molstar.StructureElement;
      if (!SE || !SE.Loci || !loci || loci.kind !== 'element-loci') return null;
      if (SE.Loci.isEmpty(loci)) return null;

      const location = SE.Loci.getFirstLocation(loci);
      if (!location || !location.unit) return null;

      const hierarchy = location.unit.model.atomicHierarchy;
      const element = location.element;
      const residueIndex = hierarchy.residueAtomSegments.index[element];
      const chainIndex = hierarchy.chainAtomSegments.index[element];

      let icode = '';
      try {
        icode = String(
          hierarchy.residues.pdbx_PDB_ins_code.value(residueIndex) || '',
        ).trim();
      } catch (e) { /* no insertion codes in this model */ }

      return {
        chain: String(hierarchy.chains.auth_asym_id.value(chainIndex)),
        resnum: hierarchy.residues.auth_seq_id.value(residueIndex),
        icode: icode,
        resname: String(hierarchy.atoms.label_comp_id.value(element)),
      };
    } catch (e) {
      return null;
    }
  }

  /* Subscribe to canvas clicks: a residue click -> onSelect(residue); a click on
   * empty background -> onClear(). */
  function subscribeClicks(viewer, onSelect, onClear) {
    try {
      const click = viewer?.plugin?.behaviors?.interaction?.click;
      if (!click || !click.subscribe) return false;

      click.subscribe((event) => {
        // Mol* fires a spurious empty-loci click with no mouse button on
        // load/focus; ignore those or they wipe a URL-restored selection.
        if (!event || !event.button) return;
        const residue = readLociResidue(event.current && event.current.loci);
        if (residue) onSelect(residue);
        else onClear();
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Zoom to one residue and show its interactions. */
  function focusResidue(viewer, chainId, resnum, icode) {
    const loci = residueLoci(viewer, chainId, resnum, icode);
    if (!loci) return;
    viewer.plugin.managers.camera.focusLoci(loci);
    viewer.plugin.managers.structure.focus.setFromLoci(loci);
  }

  /* Transiently highlight one residue (hover), without moving the camera. */
  function highlightResidue(viewer, chainId, resnum, icode) {
    if (!viewer) return;
    const interactivity = viewer.plugin.managers.interactivity;
    if (!interactivity) return;
    if (chainId === undefined || chainId === null) {
      interactivity.lociHighlights.clearHighlights();
      return;
    }
    const loci = residueLoci(viewer, chainId, resnum, icode);
    if (loci) interactivity.lociHighlights.highlightOnly({ loci });
  }

  /* Zoom to a residue range — a CDR loop or an MHC helix. */
  function focusRange(viewer, chainId, start, end) {
    const loci = rangeLoci(viewer, chainId, start, end);
    if (!loci) return;
    viewer.plugin.managers.camera.focusLoci(loci);
    viewer.plugin.managers.structure.focus.setFromLoci(loci);
  }

  /* Transiently highlight a residue range (hover), without moving the camera.
   * Call with no selection to clear. */
  function highlightRange(viewer, chainId, start, end) {
    if (!viewer) return;
    const interactivity = viewer.plugin.managers.interactivity;
    if (!interactivity) return;
    if (chainId === undefined || chainId === null) {
      interactivity.lociHighlights.clearHighlights();
      return;
    }
    const loci = rangeLoci(viewer, chainId, start, end);
    if (loci) interactivity.lociHighlights.highlightOnly({ loci });
  }

  /* Drop the focus/highlight state set by a focusRange(). */
  function clearFocus(viewer) {
    if (!viewer) return;
    try {
      viewer.plugin.managers.structure.focus.clear();
      viewer.plugin.managers.interactivity.lociHighlights.clearHighlights();
    } catch (e) { /* nothing focused */ }
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

  return {
    load, replace, renderStructure, paintLegend, viewers,
    focusResidue, highlightResidue, focusRange, highlightRange, clearFocus,
    subscribeClicks, readLociResidue,
    overlay, toggleOverlayEntry,
  };
})();
