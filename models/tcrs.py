import json
import os

import duckdb

from models.model import Model


# The parquet index JSON-encodes its list columns; decode them back to lists
# for the browse templates. Domain annotation lives in the model module,
# mirroring the mimotopesdb house pattern (annotate_record in tcrs.py).
INDEX_LIST_COLUMNS = [
    'clonotype_ids', 'trav', 'trbv', 'alleles', 'peptides', 'antigen_types', 'pdb_ids',
]

# ?sort= values -> a validated ORDER BY fragment. Six orderings, sorted
# server-side in DuckDB. 'deposition_desc' is the default (newest first).
SORT_ORDERINGS = {
    'deposition_desc': 'first_deposition_date DESC',
    'deposition_asc': 'first_deposition_date ASC',
    'name_asc': 'tcr_name ASC',
    'name_desc': 'tcr_name DESC',
    'structures_desc': 'n_structures DESC, first_deposition_date DESC',
    'structures_asc': 'n_structures ASC, first_deposition_date DESC',
}
DEFAULT_SORT = 'deposition_desc'


def annotate_index_record(record: dict) -> dict:
    """Decode the JSON-encoded list columns of an index row into real lists."""
    for column in INDEX_LIST_COLUMNS:
        value = record.get(column)
        if isinstance(value, str):
            record[column] = json.loads(value)
    return record


def annotate_chains(tcr: dict, representative: dict | None) -> dict:
    """Add `tcr['chains']` — the alpha/beta gene + CDR panel shown at the top of
    the TCR page.

    The per-TCR bundle carries only V genes, so the panel is assembled from a
    representative structure bundle, which carries V/J genes and all three CDRs
    for both chains. CDR1 and CDR2 are germline (V-gene encoded) and CDR3 defines
    the clonotype, so they are constant across a TCR's structures — with one
    exception: an affinity-engineered variant may carry a mutated CDR3. The
    representative is therefore the first NON-engineered structure, so the panel
    always shows the parent TCR rather than a variant. Residue-level engineering
    detail stays on the clonotype page.
    """
    if not representative:
        tcr['chains'] = {}
        return tcr

    cdrs = representative.get('cdrs') or {}

    tcr['chains'] = {
        'alpha': {
            'v_gene': representative.get('tcr_alpha_v_gene'),
            'j_gene': representative.get('tcr_alpha_j_gene'),
            **(cdrs.get('alpha') or {}),
        },
        'beta': {
            'v_gene': representative.get('tcr_beta_v_gene'),
            'j_gene': representative.get('tcr_beta_j_gene'),
            **(cdrs.get('beta') or {}),
        },
    }
    tcr['representative_pdb_id'] = representative.get('pdb_id')
    return tcr


def representative_pdb_id(tcr: dict) -> str | None:
    """The PDB id whose bundle best represents the parent TCR: the first structure
    that is not an affinity-engineered variant, else simply the first."""
    structures = tcr.get('structures') or []
    if not structures:
        return None
    for structure in structures:
        if not structure.get('is_engineered_variant'):
            return structure.get('pdb_id')
    return structures[0].get('pdb_id')


class Tcr(Model):
    """
    TCR data access. Two shapes, mirroring the house DuckDB/JSON split:
      - get_all(sort=...) : the sortable browse index, DuckDB over the parquet.
      - get_one(tcr_id)   : the per-TCR detail bundle, a prebaked JSON file read.
    """

    def __init__(self):
        self.index_file = 'data/tcrs.parquet'
        self.detail_dir = 'data/tcr'
        self.base_query = self.build_base_query(self.index_file)

    def get_all(self, sort: str = DEFAULT_SORT):
        """Return the browse index, ordered by one of the six validated sort keys."""
        order_by = SORT_ORDERINGS.get(sort, SORT_ORDERINGS[DEFAULT_SORT])
        sql_query = f"{self.base_query} ORDER BY {order_by}"
        results = duckdb.query(sql_query).to_df().to_dict(orient='records')
        return [annotate_index_record(result) for result in results]

    def get_one(self, tcr_id: str):
        """Return the prebaked per-TCR JSON bundle, or None if it doesn't exist."""
        detail_path = os.path.join(self.detail_dir, f'{tcr_id}.json')
        if not os.path.exists(detail_path):
            return None
        with open(detail_path) as detail_file:
            return json.load(detail_file)
