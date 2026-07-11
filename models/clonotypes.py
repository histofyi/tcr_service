import json
import os

import duckdb

from models.model import Model


# The clonotype parquet index JSON-encodes these list columns.
INDEX_LIST_COLUMNS = ['engineered_variant_pdbs', 'alleles', 'peptides', 'pdb_ids']

SORT_ORDERINGS = {
    'deposition_desc': 'first_deposition_date DESC',
    'deposition_asc': 'first_deposition_date ASC',
    'name_asc': 'tcr_name ASC, clonotype_id ASC',
    'name_desc': 'tcr_name DESC, clonotype_id DESC',
    'structures_desc': 'n_structures DESC, first_deposition_date DESC',
    'structures_asc': 'n_structures ASC, first_deposition_date DESC',
}
DEFAULT_SORT = 'deposition_desc'


def annotate_index_record(record: dict) -> dict:
    for column in INDEX_LIST_COLUMNS:
        value = record.get(column)
        if isinstance(value, str):
            record[column] = json.loads(value)
    return record


class Clonotype(Model):
    """
    Clonotype data access — the finer grain below TCR. Same DuckDB-index /
    JSON-detail split as the Tcr model.
    """

    def __init__(self):
        self.index_file = 'data/clonotypes.parquet'
        self.detail_dir = 'data/clonotype'
        self.base_query = self.build_base_query(self.index_file)

    def get_all(self, sort: str = DEFAULT_SORT):
        order_by = SORT_ORDERINGS.get(sort, SORT_ORDERINGS[DEFAULT_SORT])
        sql_query = f"{self.base_query} ORDER BY {order_by}"
        results = duckdb.query(sql_query).to_df().to_dict(orient='records')
        return [annotate_index_record(result) for result in results]

    def get_one(self, clonotype_id: str):
        # Clonotype ids (e.g. CL001) are upper-case in the filenames; slugs may
        # arrive lower-case. Try the id as given, then its upper-case form.
        for candidate in (clonotype_id, clonotype_id.upper()):
            detail_path = os.path.join(self.detail_dir, f'{candidate}.json')
            if os.path.exists(detail_path):
                with open(detail_path) as detail_file:
                    return json.load(detail_file)
        return None
