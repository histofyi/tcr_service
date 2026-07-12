"""
The TCR:pMHC interface matrix — 6 CDR loops x 3 MHC regions.

Each structure bundle carries `bsa` (buried surface area) and
`shape_complementarity` (SC) as flat lists of cells keyed by
(cdr_loop, mhc_region). Both are turned into one 6x3 matrix for the structure
page, where a cell is drawn as a bubble: area encodes BSA, colour encodes SC.

Two things about the source data drive the shape of this module.

**Copies.** A structure with n copies in the asymmetric unit has 18 cells *per
copy* (2AK4 has 4 copies, so 72 rows). The SC rows identify their copy
(`2AK4_aligned_1`), but the BSA rows' `complex` is the *system* slug, identical
across every copy — so BSA cannot be attributed to a copy at all. Cells are
therefore averaged over the copies, and `n_values` records how many went in.

**NaN.** 21% of SC cells are NaN (the SC calculation fails when a patch pair is
too far apart to generate molecular dots) and 35% of BSA cells are exactly zero
(that loop simply doesn't touch that region). Python's json module happily reads
NaN, but `NaN` is not valid JSON, so passing it to a template would emit a
payload that JSON.parse() rejects. Everything is sanitised to None here.
"""

import json
import math
import os
from functools import lru_cache

# Left-to-right across the matrix: the alpha chain's three loops, then beta's.
CDR_LOOPS = (
    'alpha_cdr1', 'alpha_cdr2', 'alpha_cdr3',
    'beta_cdr1', 'beta_cdr2', 'beta_cdr3',
)

# Top-to-bottom: the two helices that flank the groove, with the peptide between
# them — the order they sit in physically.
MHC_REGIONS = ('alpha1', 'peptide', 'alpha2')

CDR_LABELS = {
    'alpha_cdr1': 'α CDR1',
    'alpha_cdr2': 'α CDR2',
    'alpha_cdr3': 'α CDR3',
    'beta_cdr1': 'β CDR1',
    'beta_cdr2': 'β CDR2',
    'beta_cdr3': 'β CDR3',
}

MHC_LABELS = {
    'alpha1': 'α1 helix',
    'peptide': 'Peptide',
    'alpha2': 'α2 helix',
}

# Where each patch sits in the coordinate files, so a cell can be focused in Mol*.
#
# Chains D (TCR alpha) and E (TCR beta) are IMGT-renumbered, so the CDR loops are
# at their canonical IMGT positions in every structure — that is what makes this
# a lookup rather than a per-structure annotation. Chain A (MHC heavy) is NOT
# renumbered, but class I heavy chains already share a common numbering, and the
# helix bounds below are the ones the grant pipeline uses
# (bsi_career_enhancing_grant/structure_components.json). The peptide is chain C
# in its entirety.
CDR_SELECTIONS = {
    'alpha_cdr1': {'chain': 'D', 'start': 27, 'end': 38},
    'alpha_cdr2': {'chain': 'D', 'start': 56, 'end': 65},
    'alpha_cdr3': {'chain': 'D', 'start': 105, 'end': 117},
    'beta_cdr1': {'chain': 'E', 'start': 27, 'end': 38},
    'beta_cdr2': {'chain': 'E', 'start': 56, 'end': 65},
    'beta_cdr3': {'chain': 'E', 'start': 105, 'end': 117},
}

MHC_SELECTIONS = {
    'alpha1': {'chain': 'A', 'start': 50, 'end': 86},
    'alpha2': {'chain': 'A', 'start': 137, 'end': 180},
    'peptide': {'chain': 'C', 'start': None, 'end': None},
}

# SC is a correlation-like score in [0, 1]. The grant's figures clamp the colour
# scale at 0.85; our set reaches 0.967, so the full range is used here rather
# than flattening the best-packed cells into one colour.
SC_MIN, SC_MAX = 0.0, 1.0


def _clean(value):
    """NaN/inf -> None. `NaN` is not valid JSON and would break JSON.parse()."""
    if value is None:
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _mean(values: list):
    """Mean of the non-null values, or None if there are none."""
    present = [v for v in values if v is not None]
    return sum(present) / len(present) if present else None


def _group(rows: list, value_keys: tuple) -> dict:
    """Collect rows into { (cdr_loop, mhc_region): {key: [values...]} }."""
    grouped: dict = {}
    for row in rows or []:
        cell = grouped.setdefault(
            (row.get('cdr_loop'), row.get('mhc_region')),
            {key: [] for key in value_keys},
        )
        for key in value_keys:
            cell[key].append(_clean(row.get(key)))
    return grouped


@lru_cache(maxsize=1)
def global_bsa_max() -> float:
    """The largest BSA cell across every structure.

    Bubble area is normalised against this rather than against the structure's
    own maximum, so a bubble means the same thing on every structure page and the
    matrices are comparable by eye. (The grant's figures do the same, for the same
    reason.) Read once and cached.
    """
    largest = 0.0
    detail_dir = 'data/structure'

    for filename in os.listdir(detail_dir):
        if not filename.endswith('.json'):
            continue
        with open(os.path.join(detail_dir, filename)) as detail_file:
            structure = json.load(detail_file)
        for row in structure.get('bsa') or []:
            value = _clean(row.get('bsa_total'))
            if value is not None:
                largest = max(largest, value)

    return largest or 1.0


def interface_matrix(structure: dict) -> dict:
    """The 6x3 interface matrix for one structure.

    Returns a dict ready to hand to the template as JSON:

        {
          'cells': [ { 'cdr_loop', 'mhc_region', 'bsa_total', 'bsa_cdr_side',
                       'sc', 'median_distance', 'n_values' }, ... ],   # 18 of them
          'bsa_max': <global max, for the shared area scale>,
          'n_copies': <ASU copies the cells were averaged over>,
        }

    A cell with no BSA (the loop doesn't reach that region) keeps bsa_total 0 —
    the template draws nothing. A cell whose SC failed keeps sc None, and is
    drawn as an outline so "no contact" and "contact, SC unavailable" stay
    visually distinct.
    """
    bsa = _group(structure.get('bsa'), ('bsa_total', 'bsa_cdr_side'))
    sc = _group(structure.get('shape_complementarity'), ('sc', 'median_distance'))

    cells = []
    for mhc_region in MHC_REGIONS:
        for cdr_loop in CDR_LOOPS:
            key = (cdr_loop, mhc_region)
            bsa_cell = bsa.get(key, {})
            sc_cell = sc.get(key, {})

            bsa_totals = bsa_cell.get('bsa_total', [])
            cells.append({
                'cdr_loop': cdr_loop,
                'mhc_region': mhc_region,
                'bsa_total': _mean(bsa_totals),
                'bsa_cdr_side': _mean(bsa_cell.get('bsa_cdr_side', [])),
                'sc': _mean(sc_cell.get('sc', [])),
                'median_distance': _mean(sc_cell.get('median_distance', [])),
                'n_values': len([v for v in bsa_totals if v is not None]),
            })

    return {
        'cells': cells,
        'bsa_max': global_bsa_max(),
        'n_copies': structure.get('n_copies') or 1,
    }
