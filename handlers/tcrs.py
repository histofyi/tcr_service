from models.tcrs import Tcr, SORT_ORDERINGS, DEFAULT_SORT


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
        'sort': sort,
        'sort_options': list(SORT_ORDERINGS.keys()),
        'tcr_count': len(tcrs),
        'current_navitem': 'tcrs',
    }


def tcr_handler(tcr_id: str) -> dict:
    """Per-TCR page context: the prebaked detail bundle for one TCR."""
    tcr = Tcr().get_one(tcr_id)
    return {'tcr': tcr, 'tcr_id': tcr_id, 'current_navitem': 'tcrs'}


def explore_handler() -> dict:
    """
    Context for the interactive COM viewer page. The viewer component itself is
    wired in a later pass; for now the route + template slot exist.
    """
    return {'current_navitem': 'explore'}
