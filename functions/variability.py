"""
How much a TCR's footprint moves.

Two different quantities, which are easy to confuse and belong on different pages:

**Within a structure** — `footprint_spread_A` on the TCR bundle's `variability[]`.
How far apart the footprint centres of the *copies of one structure* sit (ASU
copies and altlocs). This is a precision figure about the crystallography, not
about the biology, so it belongs on the structure page beside the copy count. It is
zero for the 143 single-copy structures — there is nothing to compare them against.

**Between structures** — computed here. How far apart the footprint centres of a
TCR's *different structures* sit. This is the interesting one on a TCR page: it says
how much the receptor's footprint shifts as the peptide, the crystal form or the
engineering changes. It needs at least two structures, so it is available for 33 of
the 123 TCRs.

The COM coordinates are in the projection's pixel space, so they are converted with
the same scale the explore viewer uses (`px_per_angstrom`, from config).
"""

import math


def footprint_spread(structures: list, px_per_angstrom: float) -> dict | None:
    """The spread of a TCR's footprint centres across its structures.

    Returns the RMS distance of each structure's footprint centre from their mean,
    in Ångström, plus the furthest pair — or None if there are fewer than two
    structures to compare.
    """
    points = [
        (structure['pdb_id'], structure['com_px']['footprint'])
        for structure in structures or []
        if (structure.get('com_px') or {}).get('footprint')
    ]
    if len(points) < 2:
        return None

    mean_x = sum(point[1]['x'] for point in points) / len(points)
    mean_y = sum(point[1]['y'] for point in points) / len(points)

    mean_square = sum(
        (point[1]['x'] - mean_x) ** 2 + (point[1]['y'] - mean_y) ** 2
        for point in points
    ) / len(points)
    rms = math.sqrt(mean_square) / px_per_angstrom

    # The two structures whose footprints sit furthest apart — the concrete pair a
    # reader can go and look at, which an RMS on its own doesn't give them.
    furthest = None
    for index, (pdb_a, a) in enumerate(points):
        for pdb_b, b in points[index + 1:]:
            distance = math.hypot(a['x'] - b['x'], a['y'] - b['y']) / px_per_angstrom
            if not furthest or distance > furthest['distance']:
                furthest = {'a': pdb_a, 'b': pdb_b, 'distance': distance}

    return {
        'rms_angstrom': rms,
        'n_structures': len(points),
        'furthest': furthest,
    }
