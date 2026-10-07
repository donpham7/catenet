import requests


def fetch_rates(url):
    return requests.get(url, timeout=5).json()
