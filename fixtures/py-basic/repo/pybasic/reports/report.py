# Relative import through the package re-export, plus cross-file inheritance.
from ..core import format_currency
from .base import BaseReport


class Report(BaseReport):
    def __init__(self, amount):
        self.amount = amount

    def render(self):
        return format_currency(self.amount)
