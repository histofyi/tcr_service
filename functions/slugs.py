def slugify_string(input_string: str) -> str:
    """
    Convert a string into a URL-friendly slug.

    Args:
        input_string (str): The input string to be converted into a slug.

    Returns:
        str: A URL-friendly slug version of the input string.
    """
    return input_string.lower().replace(' ', '_').replace(',', '_').replace('.', '_').replace(':', '_')


def slugify_allele(allele_number: str) -> str:
    """
    Convert an allele name into a URL-friendly slug (e.g. 'HLA-A*02:01' -> 'hla_a_02_01').

    Args:
        allele_number (str): The input allele string to be converted into a slug.

    Returns:
        str: A URL-friendly slug version of the input allele.
    """
    return allele_number.lower().replace('-', '_').replace('*', '_').replace(':', '_')


def de_slugify_allele(allele_slug: str) -> str:
    """
    Convert an allele slug back into its original display format (e.g. 'hla_a_02_01' -> 'HLA-A*02:01').

    Args:
        allele_slug (str): The input slug to be converted back into the allele display format.

    Returns:
        str: The allele display format corresponding to the input slug.
    """
    if allele_slug.startswith('h2'):
        return allele_slug.replace('_', '-').replace('h2', 'H-2')
    else:
        allele_components = allele_slug.split('_')
        if len(allele_components) >= 4:
            return f"{allele_components[0].upper()}-{allele_components[1].upper()}*{allele_components[2]}:{allele_components[3]}"


def de_slugify_string(slug: str) -> str:
    """
    Convert a URL-friendly slug back into a display string ('_' -> space, title-cased).

    Args:
        slug (str): The input slug to be converted back into a display string.

    Returns:
        str: The display string corresponding to the input slug.
    """
    return slug.replace('_', ' ').title()


def de_construct_url_slug(slug: str) -> str:
    """
    Convert a compound '__'-joined stored slug back into a '/'-joined URL path.

    Args:
        slug (str): The compound slug to be converted back into a URL path.

    Returns:
        str: The '/'-joined path corresponding to the input compound slug.
    """
    return slug.replace('__', '/')


def lowercase_params(*args):
    """
    Convert all input parameters to lowercase.

    Args:
        *args: Variable length argument list of strings to be converted to lowercase.

    Returns:
        list: A list of lowercase strings corresponding to the input parameters.
    """
    return [arg.lower() for arg in args]
