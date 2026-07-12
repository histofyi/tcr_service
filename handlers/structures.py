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


def structure_handler(tcr_id: str, pdb_id: str) -> dict:
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
        context.update({
            'matrix': interface_matrix(structure),
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
