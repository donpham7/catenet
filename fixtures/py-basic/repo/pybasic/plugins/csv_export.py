from pybasic.core.money import format_currency


def to_csv(rows):
    return ",".join(format_currency(r) for r in rows)
