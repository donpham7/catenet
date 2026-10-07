from acme_billing.invoice import issue_invoice


def test_issue_invoice_in_cents():
    assert issue_invoice(1.5) == {"total_cents": 150}
