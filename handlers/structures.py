from functions.annotations import external_links, iedb_annotation
from functions.com_distribution import com_distributions
from functions.publications import publication_authors
from functions.residues import cdr_residues, parse_residue_token, peptide_residues
from functions.interface import (
    CDR_LABELS,
    CDR_LOOPS,
    CDR_SELECTIONS,
    MHC_LABELS,
    MHC_REGIONS,
    MHC_SELECTIONS,
    SC_MAX,
    SC_MIN,
    interface_matrix,
    residue_chord,
)
from models.structures import Structure
from models.tcrs import Tcr


def structure_handler(tcr_id: str, pdb_id: str, selected_residue: str | None = None) -> dict:
    """
    Per-structure deep-dive context. Loads the prebaked structure bundle plus a
    little parent context (the TCR the structure hangs under) for breadcrumbs,
    and the 6x3 CDR-loop x MHC-region interface matrix that the bubble chart and
    its Mol* interaction are driven from.
    """
    structure = Structure().get_one(pdb_id)
    tcr = Tcr().get_one(tcr_id)

    context = {
        'structure': structure,
        'tcr': tcr,
        'tcr_id': tcr_id,
        'pdb_id': pdb_id.upper(),
    }

    if structure:
        # The real residue numbers behind each CDR loop and the peptide, read from
        # the coordinate file so a residue can be clicked through to Mol*. Empty if
        # the coordinates disagree with the sequence — better no interaction than
        # one that focuses the wrong residue. See functions/residues.py.
        cdrs = structure.get('cdrs') or {}
        sequences = {
            f'{chain}_{loop}': cdr_residues(
                pdb_id, chain, loop, (cdrs.get(chain) or {}).get(loop),
            )
            for chain in ('alpha', 'beta')
            for loop in ('cdr1', 'cdr2', 'cdr3')
        }
        sequences['peptide'] = peptide_residues(pdb_id, structure.get('peptide_seq'))

        # footprint_spread_A lives on the TCR bundle's variability[], keyed by pdb.
        # It is the spread ACROSS COPIES of this structure — a precision figure, not
        # a biological one — so it sits beside the ASU copy count.
        variability = next(
            (row for row in ((tcr or {}).get('variability') or [])
             if row.get('pdb_id') == pdb_id.upper()),
            None,
        )

        # The same contacts at residue grain: one arc per contacting residue, one
        # ribbon per contacting residue pair. Drives the interaction map.
        chord = residue_chord(pdb_id)

        # Every residue the map can select. The CDR loops and the peptide have a
        # sequence cell; the α1/α2 helix residues have only an arc — but an arc is a
        # perfectly good thing to select, and its residue is just as shareable.
        chord_tokens = {
            node['token']
            for node in (chord or {}).get('nodes') or []
            if node.get('token')
        }

        context.update({
            'variability': variability,
            'sequences': sequences,
            # ?residue=e112a — a shareable selection, validated against the
            # residues this structure actually shows (it comes from the URL).
            'selected_residue': parse_residue_token(
                selected_residue, sequences, also=chord_tokens,
            ),
            'iedb': iedb_annotation(pdb_id),
            'external_links': external_links(pdb_id),
            # The one thing the bundle's `publication` lacks: who wrote it.
            'authors': publication_authors(pdb_id),
            # Context for the mini COM viewer: the spread of every structure's COM
            # (black) and of this structure's antigen class (coloured), per layer.
            'com_distributions': com_distributions(structure.get('antigen_type')),
            # Keyed off the coordinate file the viewer loads, so the matrix always
            # describes the copy actually on screen — no longer averaged.
            'matrix': interface_matrix(pdb_id),
            'chord': chord,
            'cdr_loops': list(CDR_LOOPS),
            'mhc_regions': list(MHC_REGIONS),
            'cdr_labels': CDR_LABELS,
            'mhc_labels': MHC_LABELS,
            'cdr_selections': CDR_SELECTIONS,
            'mhc_selections': MHC_SELECTIONS,
            'sc_min': SC_MIN,
            'sc_max': SC_MAX,
        })

    return context
