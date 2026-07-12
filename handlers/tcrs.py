from functions.coordinates import coordinate_map
from models.structures import Structure
from models.tcrs import (
    Tcr,
    SORT_ORDERINGS,
    DEFAULT_SORT,
    annotate_chains,
    annotate_structure_publications,
    browse_structures,
    representative_pdb_id,
)


def tcrs_handler(sort: str = DEFAULT_SORT) -> dict:
    """
    Index page context: the sortable list of TCRs for the card grid + accordion.
    Sorting is done server-side in the model (DuckDB ORDER BY); the template
    needs no client JS for the six orderings.
    """
    if sort not in SORT_ORDERINGS:
        sort = DEFAULT_SORT
    tcrs = Tcr().get_all(sort=sort)
    return {
        'tcrs': tcrs,
        'structures_by_tcr': browse_structures(),
        'sort': sort,
        'sort_options': list(SORT_ORDERINGS.keys()),
        'tcr_count': len(tcrs),
    }


def tcr_handler(tcr_id: str) -> dict:
    """Per-TCR page context: the prebaked detail bundle for one TCR, plus the
    alpha/beta gene + CDR panel shown at the top of the page.

    That panel needs CDR1/CDR2, which the per-TCR bundle doesn't carry — they are
    germline (V-gene encoded) and so live in the structure bundles. It is
    assembled from a representative structure; see models.tcrs.annotate_chains.
    """
    tcr = Tcr().get_one(tcr_id)
    if tcr:
        representative = Structure().get_one(representative_pdb_id(tcr) or '')
        annotate_chains(tcr, representative)
        annotate_structure_publications(tcr)
    return {'tcr': tcr, 'tcr_id': tcr_id}


def explore_handler() -> dict:
    """Context for the interactive COM viewer page.

    The viewer's COM points carry a PDB id but no filename, and 76 of the 206
    structures exist only as altloc files — so the coordinate path can't be built
    from a naming convention on the client. Resolve it server-side and hand the
    page a { PDB_ID: url } map for the Mol* panel to load on click.
    """
    return {'coordinates': coordinate_map()}
