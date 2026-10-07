__all__ = ["format_currency", "round_amount"]


def round_amount(x):
    return round(x, 2)


def format_currency(x):
    return f"${round_amount(x):.2f}"
