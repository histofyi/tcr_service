from functions.annotations import external_links, iedb_annotation
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

        context.update({
            'sequences': sequences,
            # ?residue=e112a — a shareable selection, validated against the
            # residues this structure actually shows (it comes from the URL).
            'selected_residue': parse_residue_token(selected_residue, sequences),
            'iedb': iedb_annotation(pdb_id),
            'external_links': external_links(pdb_id),
            # Keyed off the coordinate file the viewer loads, so the matrix always
            # describes the copy actually on screen — no longer averaged.
            'matrix': interface_matrix(pdb_id),
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
