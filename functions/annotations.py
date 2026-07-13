"""
The master annotation table — IEDB assignments and external database membership.

`data/class_i_annotation.csv` is the curated master table for the 206-structure
working set (one row per PDB entry). The prebaked structure bundles were built
from it but do not carry all of its columns, so the two fields the structure page
needs are read from it directly here:

* **IEDB** — `iedb_source_antigen`, `iedb_source_organism`,
  `iedb_antigen_accession`. 204 of 206 structures matched IEDB, but only 152 carry
  a source antigen, so the panel has to cope with a matched-but-unannotated
  peptide.

* **`sources`** — which external databases hold this entry (`stcrdab`, `tcr3d`,
  `atlas`). This is what gates the outbound links: a STCRDab link is only offered
  for the 159 entries STCRDab actually has.

On the external links, having checked each one:

* **PDBe** and **RCSB** have an entry page for every PDB id.
* **STCRDab** has one at `/pdb/<id>` for the 159 entries it holds. (Its
  `/summary/<id>` route returns a TSV, not a page.)
* **ATLAS** has one for the 139 entries it holds.
* **TCR3d** has NO per-structure page. Its class-I set is a single browse table
  with the rows embedded as JSON; the only per-PDB link it renders is out to
  ATLAS. So there is no TCR3d URL to link to, and none is offered — see
  `external_links()`.
"""

import csv
import os
import re
from functools import lru_cache

ANNOTATION_FILE = os.path.join('data', 'class_i_annotation.csv')

# The IEDB source-antigen accessions are NOT all UniProt — of the 80 distinct
# values, 17 are UniProtKB (`O43395.2`, `A0A1W2PQQ0.2`) and 63 are NCBI: GenBank
# protein accessions (`AAG31572.1`), bare GI numbers (`1125014`), and PDB chain
# references (`6VM8_C`). Linking them all at UniProt would 404 for most, so the
# namespace is detected and each goes to the resolver that actually holds it.
# Both were checked against the live services.
UNIPROT_ACCESSION = re.compile(
    r'^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(\.\d+)?$'
)


def accession_link(accession: str) -> dict | None:
    """{source, url} for a peptide-source accession, or None if there isn't one.

    UniProt is queried without the version suffix; NCBI resolves its accessions,
    GI numbers and PDB chain refs as given.
    """
    accession = (accession or '').strip()
    if not accession:
        return None

    if UNIPROT_ACCESSION.match(accession):
        base = accession.split('.')[0]
        return {
            'source': 'UniProt',
            'url': f'https://www.uniprot.org/uniprotkb/{base}/entry',
        }

    return {
        'source': 'NCBI Protein',
        'url': f'https://www.ncbi.nlm.nih.gov/protein/{accession}',
    }


@lru_cache(maxsize=1)
def _annotations() -> dict:
    """{ PDB_ID: row } for the master table. Read once and cached."""
    if not os.path.exists(ANNOTATION_FILE):
        return {}

    with open(ANNOTATION_FILE) as annotation_file:
        return {
            row['pdb_id'].upper(): row
            for row in csv.DictReader(annotation_file)
        }


def annotation(pdb_id: str) -> dict:
    """The master-table row for a PDB id, or {} if it isn't in the working set."""
    return _annotations().get(pdb_id.upper(), {})


def iedb_annotation(pdb_id: str) -> dict | None:
    """The IEDB source-antigen assignment for a peptide, or None.

    None covers both "not matched to IEDB" and "matched, but IEDB has no source
    antigen for it" — from the page's point of view there is nothing to show
    either way.
    """
    row = annotation(pdb_id)
    antigen = (row.get('iedb_source_antigen') or '').strip()
    if not antigen:
        return None

    accession = (row.get('iedb_antigen_accession') or '').strip()

    return {
        'source_antigen': antigen,
        'source_organism': (row.get('iedb_source_organism') or '').strip(),
        'accession': accession,
        'accession_link': accession_link(accession),
    }


def external_links(pdb_id: str) -> list:
    """The external database entries for this structure, in [{label, url}] form.

    Only databases that actually hold the entry are linked — `sources` on the
    master table says which. TCR3d is deliberately absent: it holds every one of
    these structures but has no per-structure page to link to.
    """
    pdb_id = pdb_id.upper()
    sources = {
        source.strip()
        for source in (annotation(pdb_id).get('sources') or '').split(',')
        if source.strip()
    }

    links = [{
        'label': 'PDBe',
        'url': f'https://www.ebi.ac.uk/pdbe/entry/pdb/{pdb_id.lower()}',
    }]

    if 'stcrdab' in sources:
        links.append({
            'label': 'STCRDab',
            'url': f'https://opig.stats.ox.ac.uk/webapps/stcrdab-stcrpred/pdb/{pdb_id.lower()}',
        })

    if 'atlas' in sources:
        links.append({
            'label': 'ATLAS',
            'url': f'http://atlas.ibbr.umd.edu/web/search_results_pdb.php?pdbid={pdb_id}',
        })

    return links
