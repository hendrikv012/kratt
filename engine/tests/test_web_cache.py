from memory_engine.web_cache import cache_get, cache_put, url_hash


def test_url_normalization():
    assert url_hash("HTTPS://Docs.Python.org/3/library/#top") == url_hash("https://docs.python.org/3/library")


def test_cache_roundtrip_and_update(conn):
    assert cache_get(conn, "https://a.org/x") is None
    cache_put(conn, "https://a.org/x", "# One")
    cache_put(conn, "https://a.org/x/", "# Two")
    assert cache_get(conn, "https://a.org/x") == "# Two"
