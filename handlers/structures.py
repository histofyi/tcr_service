from models.structures import Structure
from models.tcrs import Tcr


def structure_handler(tcr_id: str, pdb_id: str) -> dict:
    """
    Per-structure deep-dive context. Loads the prebaked structure bundle plus a
    little parent context (the TCR the structure hangs under) for breadcrumbs.
    """
    structure = Structure().get_one(pdb_id)
    tcr = Tcr().get_one(tcr_id)
    return {
        'structure': structure,
        'tcr': tcr,
        'tcr_id': tcr_id,
        'pdb_id': pdb_id.upper(),
        'current_navitem': 'tcrs',
    }
