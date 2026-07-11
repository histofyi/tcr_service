from models.clonotypes import Clonotype, SORT_ORDERINGS, DEFAULT_SORT


def clonotypes_handler(sort: str = DEFAULT_SORT) -> dict:
    """Index page context: the sortable list of clonotypes (the finer grain)."""
    if sort not in SORT_ORDERINGS:
        sort = DEFAULT_SORT
    clonotypes = Clonotype().get_all(sort=sort)
    return {
        'clonotypes': clonotypes,
        'sort': sort,
        'sort_options': list(SORT_ORDERINGS.keys()),
        'clonotype_count': len(clonotypes),
        'current_navitem': 'clonotypes',
    }


def clonotype_handler(clonotype_id: str) -> dict:
    """Per-clonotype page context: the prebaked detail bundle for one clonotype."""
    clonotype = Clonotype().get_one(clonotype_id)
    return {'clonotype': clonotype, 'clonotype_id': clonotype_id, 'current_navitem': 'clonotypes'}
