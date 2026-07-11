from .templating import render
from functools import wraps

from quart import current_app


def templated(template):
    """Quart decorator to render a template from a view function's return value."""
    def decorator(f):
        @wraps(f)
        async def wrapper(*args, **kwargs):
            template_name = template

            ctx = await f(*args, **kwargs)

            return await render(template_name, ctx)

        return wrapper
    return decorator
