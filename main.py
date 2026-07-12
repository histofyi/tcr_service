import subprocess

from quart import Quart, request

from datetime import datetime
import json
import os

from handlers import tcrs_handler, tcr_handler, explore_handler
from handlers import structure_handler
from handlers import clonotypes_handler, clonotype_handler

from functions.coordinates import coordinate_url
from functions.decorators import templated
from functions.slugs import (
    de_slugify_allele,
    de_slugify_string,
    slugify_allele,
    slugify_string,
)


def _git_commit():
    try:
        return subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'],
            stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return 'unknown'


def create_app():
    app = Quart(__name__)

    # Config is loaded from a local JSON file while developing; in production this
    # is overridden by environment variables / a secrets manager.
    config = json.load(open('config.json'))
    app.config.update(config)

    # Secrets from the environment (a .env file locally, real env vars in prod).
    app.config['secrets'] = {
        'AWS_ACCESS_KEY_ID': os.getenv('AWS_ACCESS_KEY_ID'),
        'AWS_SECRET_ACCESS_KEY': os.getenv('AWS_SECRET_ACCESS_KEY'),
    }

    app.config['aws'] = {
        'REGION': os.getenv('AWS_REGION'),
        'S3_BUCKET_NAME': os.getenv('AWS_S3_BUCKET_NAME'),
    }

    app.config['git_commit'] = _git_commit()

    # Trim templated whitespace so rendered HTML doesn't accumulate blank lines.
    app.jinja_env.trim_blocks = True
    app.jinja_env.lstrip_blocks = True

    return app


app = create_app()


### Template filters — all display formatting lives here, out of the handlers. ###

@app.template_filter('deslugify_allele')
def deslugify_allele(value):
    return de_slugify_allele(value)


@app.template_filter('deslugify_string')
def deslugify_string(value):
    return de_slugify_string(value)


@app.template_filter('slugify_allele')
def slugify_allele_filter(value):
    return slugify_allele(value)


@app.template_filter('slugify_string')
def slugify_string_filter(value):
    return slugify_string(value)


@app.template_filter('sequence_display')
def sequence_display_filter(sequence: str) -> str:
    """Wrap each residue in a coloured span for peptide/CDR display."""
    if sequence is not None:
        return ''.join([f"<span class='bg-{aa.lower()} aa'>{aa}</span>" for aa in sequence])
    return ''


@app.template_filter('date_display')
def date_display_filter(value: str) -> str:
    """ISO date -> the house display form: 2021-11-12 -> 12 Nov 2021."""
    if not value:
        return '—'
    try:
        return datetime.strptime(str(value)[:10], '%Y-%m-%d').strftime('%-d %b %Y')
    except ValueError:
        return str(value)


@app.template_filter('coordinate_url')
def coordinate_url_filter(pdb_id: str) -> str:
    """The static URL of a PDB id's aligned coordinate file, for Mol* to load."""
    return coordinate_url(pdb_id) or ''


@app.template_global('asset')
def asset(filename: str) -> str:
    """Cache-busting URL for one of our own static files.

    Quart serves /static with `cache-control: max-age=43200`, so an edited JS or
    CSS file is invisible to a browser that already has it for another 12 hours.
    Appending the file's mtime makes each edit a new URL. Coordinate files and the
    Mol* bundle are deliberately NOT routed through this — they never change, and
    the long cache is exactly what we want for them.
    """
    path = os.path.join('static', filename)
    try:
        return f'/static/{filename}?v={int(os.path.getmtime(path))}'
    except OSError:
        return f'/static/{filename}'


### Thin views — parse request args, delegate to a handler, let @templated render. ###

## TCRs — the primary page unit ##

@app.route('/tcrs')
@app.route('/tcrs/')
@templated('tcrs_index')
async def tcrs_view():
    sort = request.args.get('sort', 'deposition_desc')
    return tcrs_handler(sort)


@app.route('/tcrs/explore')
@app.route('/tcrs/explore/')
@templated('tcrs_explore')
async def tcrs_explore_view():
    return explore_handler()


@app.route('/tcrs/<tcr_id>')
@app.route('/tcrs/<tcr_id>/')
@templated('tcr_overview')
async def tcr_overview_view(tcr_id):
    return tcr_handler(tcr_id)


@app.route('/tcrs/<tcr_id>/structures/<pdb_id>')
@app.route('/tcrs/<tcr_id>/structures/<pdb_id>/')
@templated('structure_overview')
async def structure_overview_view(tcr_id, pdb_id):
    return structure_handler(tcr_id, pdb_id)


## Clonotypes — the finer grain ##

@app.route('/clonotypes')
@app.route('/clonotypes/')
@templated('clonotypes_index')
async def clonotypes_view():
    sort = request.args.get('sort', 'deposition_desc')
    return clonotypes_handler(sort)


@app.route('/clonotypes/<clonotype_id>')
@app.route('/clonotypes/<clonotype_id>/')
@templated('clonotype_overview')
async def clonotype_overview_view(clonotype_id):
    return clonotype_handler(clonotype_id)


if __name__ == "__main__":
    app.run()
