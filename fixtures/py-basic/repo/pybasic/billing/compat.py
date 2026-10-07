# Import inside try/except is still a real dependency.
try:
    from pybasic.core.dates import format_date
except ImportError:
    format_date = None
