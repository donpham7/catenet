from .money import to_cents


def issue_invoice(amount):
    return {"total_cents": to_cents(amount)}
