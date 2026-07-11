import duckdb


def run_query(sql_query: str, return_format: str = 'dict'):
    """
    Generic DuckDB runner, mirroring the mimotopesdb house helper. Reserved for
    analytical / index queries; record access should go through the models.

    Args:
        sql_query (str): The SQL to execute.
        return_format (str): 'dict' (list of record dicts), 'polars', or 'pandas'.

    Returns:
        The query result in the requested format.
    """
    con = duckdb.connect()
    if return_format == 'polars':
        raw_data = con.execute(sql_query).pl()
        con.close()
        return raw_data
    raw_data = con.execute(sql_query).fetchdf()
    con.close()
    if return_format == 'pandas':
        return raw_data
    return raw_data.to_dict(orient='records')
