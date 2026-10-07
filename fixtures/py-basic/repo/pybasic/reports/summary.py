# Star import, limited by money.__all__.
from pybasic.core.money import *


def summary(amount):
    return "Total: " + format_currency(amount)
