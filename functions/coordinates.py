"""
Resolving a PDB id to its aligned coordinate file.

The IMGT-renumbered, aligned structures live in `static/coordinates` with
lower-cased names, in one of three shapes:

    1ao7_aligned_1.pdb              — the usual case
    2ak4_aligned_1.pdb … _4.pdb     — several copies in the asymmetric unit
    2f53_aligned_1_altloca.pdb      — altlocs only; NO plain _aligned_1.pdb

76 of the 206 structures have altloc-only files, so a naive f-string
(`{pdb}_aligned_1.pdb`) 404s for a third of the set. Everything goes through
`coordinate_file()` instead.

Chains are always A = MHC α, B = β2m, C = peptide, D = TCR α, E = TCR β.
"""

import os
import re
from functools import lru_cache

COORDINATE_DIR = os.path.join('static', 'coordinates')
COORDINATE_ROUTE = '/static/coordinates'

FILENAME_PATTERN = re.compile(
    r'^(?P<pdb_id>[0-9a-z]{4})_aligned_(?P<copy>\d+)(?:_altloc(?P<altloc>[a-z]))?\.pdb$'
)


@lru_cache(maxsize=1)
def _coordinate_index() -> dict:
    """Map each PDB id to its coordinate filenames, best candidate first.

    Sorted by (copy number, altloc), so the preferred file — the first copy, and
    within that the first altloc — is always element 0.
    """
    index: dict = {}
    if not os.path.isdir(COORDINATE_DIR):
        return index

    for filename in os.listdir(COORDINATE_DIR):
        match = FILENAME_PATTERN.match(filename)
        if not match:
            continue
        index.setdefault(match.group('pdb_id'), []).append(
            (int(match.group('copy')), match.group('altloc') or '', filename)
        )

    return {
        pdb_id: [filename for _, _, filename in sorted(entries)]
        for pdb_id, entries in index.items()
    }


def coordinate_file(pdb_id: str) -> str | None:
    """The preferred coordinate filename for a PDB id, or None if we have none."""
    candidates = _coordinate_index().get(pdb_id.lower())
    return candidates[0] if candidates else None


def coordinate_url(pdb_id: str) -> str | None:
    """The static URL Mol* should load for a PDB id, or None if we have none."""
    filename = coordinate_file(pdb_id)
    return f'{COORDINATE_ROUTE}/{filename}' if filename else None


def coordinate_copies(pdb_id: str) -> list:
    """Every coordinate file for a PDB id (copies + altlocs), preferred first."""
    return list(_coordinate_index().get(pdb_id.lower(), []))


def coordinate_map() -> dict:
    """{ PDB_ID (upper): url } for every structure we hold coordinates for.

    The explore page's COM points identify a structure only by PDB id, so the
    client needs this map to know which file to load.
    """
    return {
        pdb_id.upper(): f'{COORDINATE_ROUTE}/{filenames[0]}'
        for pdb_id, filenames in _coordinate_index().items()
    }
