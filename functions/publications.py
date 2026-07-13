"""
Publication authors, from `data/pdbe_publications.json`.

The structure bundles already carry a paper's title, journal, year, DOI and PMID —
everything except who wrote it. This adds the authors, and covers all 206 structures.

**The author lists are truncated to three, and the file does not say to what.** 1AO7's
paper has six authors (Garboczi, Ghosh, Utz, Fan, Biddison and Wiley); the file gives
three. 198 of the 207 entries have exactly three, so the cap is plain enough — but
nothing records the true count, so a three-author entry cannot be told apart from the
first three of thirty. See DATA.md #18.

That is why nothing here renders a bare list of three names: it would assert an
authorship that is usually false. At the cap the names are given as a citation would
give them — first authors, then *et al.* — which is true whether the paper has four
authors or forty. Below the cap the list is complete and is shown as such.
"""

import json
import os
from functools import lru_cache

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
PUBLICATIONS_FILE = os.path.join(DATA_DIR, 'pdbe_publications.json')

# What the export truncates author lists to. At this many names we cannot know whether
# the list is complete, so we must assume it is not.
AUTHOR_CAP = 3


@lru_cache(maxsize=1)
def _publications() -> dict:
    """{ PDB_ID: record } — upper-cased keys, matching the ids we hold."""
    if not os.path.exists(PUBLICATIONS_FILE):
        return {}

    with open(PUBLICATIONS_FILE) as publications_file:
        payload = json.load(publications_file)

    return {
        pdb_id.upper(): record
        for pdb_id, record in (payload.get('pubs') or {}).items()
    }


def publication_authors(pdb_id: str) -> dict | None:
    """{ 'names': [...], 'truncated': bool } for a structure's paper, or None.

    `truncated` is True when the list is at the export's cap and so cannot be trusted
    to be complete — the template renders *et al.* on the strength of it.
    """
    record = _publications().get((pdb_id or '').upper())
    if not record:
        return None

    names = [name.strip() for name in (record.get('authors') or '').split(';') if name.strip()]
    if not names:
        return None

    return {'names': names, 'truncated': len(names) >= AUTHOR_CAP}
