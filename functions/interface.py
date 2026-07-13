"""
The TCR:pMHC interface — 6 CDR loops x 3 MHC regions.

Reads `data/interactions/`, the per-structure interaction export:

* `sasa_by_structure.json` — buried surface area per CDR-loop x MHC-region
* `shape_complementarity_by_structure.json` — Sc, median distance, trimmed area
* `contacts_by_structure.json` — bond-typed atom-pair counts (the chord layer)
* `neighbours_by_structure.json` — distance-based proximity pairs

All four are keyed by **structure id** — the coordinate-file stem,
`<PDB>_aligned_<complex>[_altloc<X>]` (e.g. `1AO7_aligned_1`,
`3PWP_aligned_1_altlocA`). That matters: a structure with several copies in the
asymmetric unit has a separate record per copy, so the interface can be described
for **the copy actually on screen** rather than averaged across all of them.

(The older prebaked structure bundles could not do this: their BSA rows carried
the *system* slug as `complex`, identical across copies, so BSA could not be
attributed to a copy at all and had to be averaged. See DATA.md #11.)

The structure id shown is therefore derived from the coordinate file the Mol*
viewer is loading, so the matrix and the 3D view always describe the same
coordinates.
"""

import json
import math
import os
from functools import lru_cache

from functions.coordinates import coordinate_file

INTERACTION_DIR = os.path.join('data', 'interactions')

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

# The contacts/neighbours files label the loops `CDR1_alpha`; SASA/SC use
# `alpha_cdr1`. Same six loops — normalise everything to the SASA/SC style.
CONTACT_LOOP_ALIASES = {
    f'CDR{n}_{chain}': f'{chain}_cdr{n}'
    for chain in ('alpha', 'beta')
    for n in (1, 2, 3)
}

# Where each patch sits in the coordinate files, so a cell can be focused in Mol*.
#
# Chains D (TCR alpha) and E (TCR beta) are IMGT-renumbered, so the CDR loops are
# at their canonical IMGT positions in every structure — that is what makes this a
# lookup rather than a per-structure annotation. Chain A (MHC heavy) is not
# renumbered, but class I heavy chains share a common numbering. Bounds per the
# interaction_export README: alpha1 = A 1-90, alpha2 = A 91-180, peptide = all of C.
CDR_SELECTIONS = {
    'alpha_cdr1': {'chain': 'D', 'start': 27, 'end': 38},
    'alpha_cdr2': {'chain': 'D', 'start': 56, 'end': 65},
    'alpha_cdr3': {'chain': 'D', 'start': 105, 'end': 117},
    'beta_cdr1': {'chain': 'E', 'start': 27, 'end': 38},
    'beta_cdr2': {'chain': 'E', 'start': 56, 'end': 65},
    'beta_cdr3': {'chain': 'E', 'start': 105, 'end': 117},
}

# PENDING CHANGE — these are the WHOLE-DOMAIN bounds, matching the data we have
# today (interaction_export: alpha1 = A 1-90, alpha2 = A 91-180). The region
# definition has since been settled as HELIX-ONLY (alpha1 = A 50-86, alpha2 =
# A 137-180), which is what the TCR actually reads — the beta-sheet floor beneath
# the helices is not part of the recognised surface.
#
# Do NOT change these until the regenerated helix-only data lands: the highlight
# ranges must describe the same residues the figures are computed over, or clicking
# an "alpha1" cell would light up a region the number does not refer to. Switch
# both together. See briefs/residue_contacts/BRIEF.md section 4, and DATA.md #13.
MHC_SELECTIONS = {
    'alpha1': {'chain': 'A', 'start': 1, 'end': 90},
    'alpha2': {'chain': 'A', 'start': 91, 'end': 180},
    'peptide': {'chain': 'C', 'start': None, 'end': None},
}

# Sc is a correlation-like score in [0, 1]. The grant's figures clamp the colour
# scale at 0.85; our set reaches 0.97, so the full range is used rather than
# flattening the best-packed cells into one colour.
SC_MIN, SC_MAX = 0.0, 1.0

# `proximal` is Arpeggio's "these atoms are near each other" catch-all rather than
# a specific chemistry, and it dominates the counts (typically 10x the rest). It
# is kept, but flagged, so a chord can separate real bonds from mere proximity.
NON_SPECIFIC_BONDS = ('proximal',)


def _clean(value):
    """NaN/inf -> None. `NaN` is not valid JSON and breaks JSON.parse(). DATA.md #2."""
    if value is None:
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


@lru_cache(maxsize=4)
def _dataset(name: str) -> dict:
    """One of the four interaction files, keyed by structure id. Read once."""
    path = os.path.join(INTERACTION_DIR, f'{name}_by_structure.json')
    if not os.path.exists(path):
        return {}
    with open(path) as data_file:
        return json.load(data_file)


@lru_cache(maxsize=1)
def _structure_id_index() -> dict:
    """{ lower-cased structure id: the real key }.

    The two sides disagree on case: our coordinate files are lower-cased on disk
    (`7n2p_aligned_1_altloca.pdb`) while the export keys the altloc letter in
    upper case (`7N2P_aligned_1_altlocA`). Reconstructing the key from the
    filename therefore silently misses every altloc-only structure — a third of
    the set. Match case-insensitively against the keys that actually exist.
    """
    return {key.lower(): key for key in _dataset('contacts')}


def structure_id(pdb_id: str) -> str | None:
    """The interaction-data key for the copy the Mol* viewer is showing.

    Derived from the coordinate file itself, so the matrix and the 3D view can
    never describe different coordinates.
    """
    filename = coordinate_file(pdb_id)
    if not filename:
        return None

    return _structure_id_index().get(filename[:-4].lower())


def copies(pdb_id: str) -> list:
    """Every structure id for a PDB entry — one per ASU copy / altloc."""
    return sorted(
        key for key, record in _dataset('contacts').items()
        if record.get('pdb_id', '').upper() == pdb_id.upper()
    )


@lru_cache(maxsize=1)
def global_bsa_max() -> float:
    """The largest BSA cell across every structure.

    Bubble area is normalised against this rather than against a structure's own
    maximum, so a bubble means the same thing on every structure page and the
    matrices are comparable by eye. (The grant's figures do the same.)
    """
    largest = 0.0
    for record in _dataset('sasa').values():
        for pair in record.get('pairs') or []:
            value = _clean(pair.get('bsa_total'))
            if value is not None:
                largest = max(largest, value)
    return largest or 1.0


def interface_matrix(pdb_id: str) -> dict | None:
    """The 6x3 interface matrix for the copy of `pdb_id` that is on screen.

    A cell has BSA (area buried), Sc (how well the two surfaces mesh) and the
    bond-typed contact counts behind it. A cell with no BSA means that loop never
    reaches that region; a cell with BSA but no Sc means the two are in contact
    but Sc could not be computed for the pair — the page keeps those visually
    distinct.
    """
    key = structure_id(pdb_id)
    if not key:
        return None

    sasa = _dataset('sasa').get(key) or {}
    sc = _dataset('shape_complementarity').get(key) or {}
    contacts = _dataset('contacts').get(key) or {}
    neighbours = _dataset('neighbours').get(key) or {}

    sasa_pairs = {
        (p['cdr_loop'], p['mhc_region']): p for p in sasa.get('pairs') or []
    }
    sc_pairs = {
        (p['cdr_loop'], p['mhc_region']): p for p in sc.get('pairs') or []
    }

    # Bond-typed contacts, collapsed onto the same (loop, region) grid.
    bonds: dict = {}
    for bond in contacts.get('bonds') or []:
        loop = CONTACT_LOOP_ALIASES.get(bond['cdr_loop'], bond['cdr_loop'])
        cell = bonds.setdefault((loop, bond['region']), {})
        cell[bond['bond_type']] = cell.get(bond['bond_type'], 0) + bond['n_atom_pairs']

    cells = []
    for mhc_region in MHC_REGIONS:
        for cdr_loop in CDR_LOOPS:
            pair = (cdr_loop, mhc_region)
            sasa_cell = sasa_pairs.get(pair, {})
            sc_cell = sc_pairs.get(pair, {})
            bond_cell = bonds.get(pair, {})

            specific = sum(
                n for bond_type, n in bond_cell.items()
                if bond_type not in NON_SPECIFIC_BONDS
            )

            cells.append({
                'cdr_loop': cdr_loop,
                'mhc_region': mhc_region,
                'bsa_total': _clean(sasa_cell.get('bsa_total')),
                'bsa_cdr_side': _clean(sasa_cell.get('bsa_cdr_side')),
                'sc': _clean(sc_cell.get('sc')),
                'median_distance': _clean(sc_cell.get('median_distance')),
                'bonds': bond_cell,
                'n_atom_pairs': sum(bond_cell.values()),
                'n_specific_pairs': specific,
            })

    return {
        'structure_id': key,
        'cells': cells,
        'bsa_max': global_bsa_max(),
        'copies': copies(pdb_id),
        'iface_completeness_pct': sasa.get('iface_completeness_pct'),
        'total_atom_pairs': contacts.get('ct_total_atom_pairs'),
        'residue_contacts': neighbours.get('nb_residue_contacts'),
    }
