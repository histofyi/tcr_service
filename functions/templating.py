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
    variables['histo_route'] = current_app.config['HISTO_ROUTE']
    variables['site_title'] = current_app.config['SITE_TITLE']
    variables['navitems'] = current_app.config['NAVIGATION_ITEMS']
    variables['antigen_colors'] = current_app.config['ANTIGEN_COLORS']
    variables['aa_colors'] = current_app.config['AA_COLORS']
    variables['chain_labels'] = current_app.config['CHAIN_LABELS']
    variables['com_projection'] = current_app.config['COM_PROJECTION']
    # This whole microapp is the "TCRs" item in the histo.fyi navbar — every page it
    # serves (TCRs, explore, clonotypes, structure deep dives) sits under that item,
    # so the nav highlight is constant. The other nav items link out to histo.fyi.
    variables['current_navitem'] = 'tcrs'
    variables['git_commit'] = current_app.config['git_commit']

    return await render_template(template_name, **variables)
