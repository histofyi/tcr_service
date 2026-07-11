from typing import Dict

from quart import render_template
from quart import current_app


async def render(template_name: str, variables: Dict) -> str:
    """
    This function renders a template with the given variables.

    Args:
        template_name (string): name of the template, with or without the file extension if it's an HTML template
        variables (dictionary): dictionary of variables to be shown in the templated response

    Returns:
        A string containing the rendered html (or other format)
    """
    if ".html" not in template_name:
        template_name += ".html"

    variables['static_route'] = current_app.config['STATIC_ROUTE']
    variables['site_title'] = current_app.config['SITE_TITLE']
    variables['navitems'] = current_app.config['NAVIGATION_ITEMS']
    variables['antigen_colors'] = current_app.config['ANTIGEN_COLORS']
    variables['aa_colors'] = current_app.config['AA_COLORS']
    # Nav highlight: a handler may set 'current_navitem' explicitly in its context
    # (preferred here, since our template names don't map cleanly to nav slugs);
    # otherwise fall back to the mimotopesdb convention of deriving it from the
    # template name (basename before the first '_').
    if not variables.get('current_navitem'):
        variables['current_navitem'] = template_name.split('_')[0]
    variables['git_commit'] = current_app.config['git_commit']

    return await render_template(template_name, **variables)
