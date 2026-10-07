# Absolute module import with an alias; attribute access must resolve to money.py.
import pybasic.core.money as m


def invoice_line(amount):
    return "Invoice: " + m.format_currency(amount)
