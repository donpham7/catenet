-- Protected-path candidate: applied migrations are immutable.
CREATE TABLE invoices (id INTEGER PRIMARY KEY, total_cents INTEGER NOT NULL);
