class Model:
    """
    Thin base for the data-access layer, mirroring the mimotopesdb house pattern:
    small query-fragment builders that concrete object models reuse. No ORM.
    """

    def __init__(self):
        pass

    def build_read_fragment(self, data_file: str):
        if data_file.endswith('.parquet'):
            return f"read_parquet('{data_file}')"
        elif data_file.endswith('.csv'):
            return f"read_csv('{data_file}')"

    def build_base_query(self, data_file: str):
        if data_file.endswith('.parquet'):
            return f"SELECT * FROM read_parquet('{data_file}')"
        elif data_file.endswith('.csv'):
            return f"SELECT * FROM read_csv('{data_file}')"
