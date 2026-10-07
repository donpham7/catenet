from pybasic.reports.report import Report


def test_report_renders_amount():
    assert Report(2).render() == "$2.00"
