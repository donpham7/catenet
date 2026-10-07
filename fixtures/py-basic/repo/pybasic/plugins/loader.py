# importlib with a literal module name resolves only heuristically; an f-string name cannot be resolved.
import importlib


def load_builtin():
    return importlib.import_module("pybasic.plugins.csv_export")


def load_plugin(name):
    return importlib.import_module(f"pybasic.plugins.{name}")
