import json
import os

from models.model import Model


class Structure(Model):
    """
    Per-structure deep-dive data access. Structure bundles are prebaked static
    JSON (contacts, BSA, SC, COMs, completeness); no parquet index is needed for
    a single structure, so this model is a JSON file reader.
    """

    def __init__(self):
        self.detail_dir = 'data/structure'

    def get_one(self, pdb_id: str):
        """Return the prebaked per-structure JSON bundle, or None if absent.

        PDB ids are upper-case in the filenames; slugs arrive lower-case.
        """
        detail_path = os.path.join(self.detail_dir, f'{pdb_id.upper()}.json')
        if not os.path.exists(detail_path):
            return None
        with open(detail_path) as detail_file:
            return json.load(detail_file)
