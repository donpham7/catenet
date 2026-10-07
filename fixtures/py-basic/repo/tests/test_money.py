from pybasic.core.money import format_currency


def test_format_currency():
    assert format_currency(1.5) == "$1.50"
