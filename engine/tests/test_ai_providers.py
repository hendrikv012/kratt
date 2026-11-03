import io
import json
import os
import stat
import time
import urllib.error
import uuid
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from memory_engine import ai_http, ai_providers, chatgpt_auth
from memory_engine.ai_http import ProviderError
from memory_engine.ai_providers import OnlineAi, ProviderStore


def test_keys_are_private_redacted_and_bound_to_endpoint(tmp_path):
    store = ProviderStore(tmp_path)
    store.save({"provider": "compatible", "baseUrl": "https://one.example/v1", "model": "example", "key": "sensitive-key"})
    assert "sensitive-key" not in json.dumps(store.settings())
    assert store.settings()["profiles"]["compatible"]["keySet"]
    if os.name != "nt":
        assert stat.S_IMODE(store.path.stat().st_mode) == 0o600
    store.save({"provider": "compatible", "baseUrl": "https://two.example/v1"})
    assert not store.settings()["profiles"]["compatible"]["keySet"]
    store.save({"provider": "anthropic", "key": "second", "model": "claude-test"})
    store.save({"provider": "anthropic", "key": None})
    assert "second" not in store.path.read_text()


@pytest.mark.parametrize("url", ["http://cloud.example/v1", "https://key:secret@api.example/v1", "file:///tmp/a", "https://api.example/v1?key=secret"])
def test_unsafe_endpoints_rejected(url):
    with pytest.raises(ProviderError):
        ai_http.endpoint(url)


@pytest.mark.parametrize("provider,path,response,expected", [
    ("openai", "/responses", {"status": "completed", "output": [{"content": [{"type": "output_text", "text": "API answer"}]}]}, "API answer"),
    ("anthropic", "/messages", {"content": [{"type": "text", "text": "Claude answer"}]}, "Claude answer"),
    ("compatible", "/chat/completions", {"choices": [{"message": {"content": "Other answer"}}]}, "Other answer"),
])
def test_provider_protocols(tmp_path, monkeypatch, provider, path, response, expected):
    ai = OnlineAi(tmp_path)
    ai.store.save({"provider": provider, "model": "test-model", "key": "private", "baseUrl": "https://custom.example/v1"})
    calls = []
    def transport(url, data=None, headers=None, **kwargs):
        calls.append((url, data, headers))
        return response
    monkeypatch.setattr(ai_providers, "request", transport)
    assert ai.ask("Selected notes only") == expected
    url, payload, headers = calls[0]
    assert url.endswith(path) and payload["model"] == "test-model"
    assert "Selected notes only" in json.dumps(payload)
    if provider == "anthropic":
        assert headers["x-api-key"] == "private" and headers["anthropic-version"] == "2023-06-01"
    else:
        assert headers["Authorization"] == "Bearer private"
    if provider == "openai":
        assert payload["store"] is False


def test_stream_requires_completed_and_rejects_usage_failure():
    def events(*rows):
        return io.BytesIO("".join('data: '+json.dumps(row)+'\n\n' for row in rows).encode())
    delta = {"type": "response.output_text.delta", "delta": "hello"}
    assert ai_http.read_response_stream(events(delta, {"type": "response.completed"})) == "hello"
    with pytest.raises(ProviderError, match="before the answer"):
        ai_http.read_response_stream(events(delta))
    with pytest.raises(ProviderError) as error:
        ai_http.read_response_stream(events(delta, {"type": "response.failed", "response": {"error": {"code": "subscription_sharing_usage_limit_exceeded"}}}))
    assert error.value.status == 429


def test_http_auth_errors_do_not_echo_credentials_or_response(monkeypatch):
    class Opener:
        def open(self, *args, **kwargs):
            raise urllib.error.HTTPError('https://api.example', 401, 'sensitive-key', {}, io.BytesIO(b'private provider body'))
    monkeypatch.setattr(ai_http.urllib.request, 'build_opener', lambda *args: Opener())
    with pytest.raises(ProviderError) as error:
        ai_http.request('https://api.example', headers={'Authorization': 'Bearer sensitive-key'})
    assert error.value.status == 401
    assert 'sensitive' not in str(error.value) and 'private provider' not in str(error.value)
    assert ai_http.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example') is None


def test_oidc_signature_audience_expiry_nonce_and_identity(monkeypatch):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    public['kid'] = 'test-key'
    monkeypatch.setattr(chatgpt_auth, 'request', lambda url: {'jwks_uri': 'https://auth.openai.com/keys'} if 'well-known' in url else {'keys': [public]})
    claims = {'sub': 'person', 'iss': chatgpt_auth.AUTH, 'aud': 'issued-client', 'iat': time.time(), 'exp': time.time()+600, 'nonce': 'nonce'}
    def token(values):
        return jwt.encode(values, private, algorithm='RS256', headers={'kid': 'test-key'})
    assert chatgpt_auth.validate_identity(token(claims), 'issued-client', 'nonce')['sub'] == 'person'
    for overrides in [{'aud': 'other'}, {'iss': 'https://evil.example'}, {'exp': time.time()-30}, {'nonce': 'wrong'}]:
        with pytest.raises(ProviderError):
            chatgpt_auth.validate_identity(token({**claims, **overrides}), 'issued-client', 'nonce')


def test_oauth_state_registration_and_existing_account_not_replaced(tmp_path, monkeypatch):
    ai = OnlineAi(tmp_path)
    try:
        result = ai.auth.start()
        params = parse_qs(urlparse(result['url']).query)
        assert params['client_id'] == ['dynamic_agent_client']
        assert params['agent_name_hint'] == ['Kratt']
        assert params['code_challenge_method'] == ['S256']
        host = params['ext_agent_host_id'][0]
        assert host.startswith('urn:uuid:') and uuid.UUID(host).version == 4
        assert ai.store.read()['chatgpt']['host'] == host
        pending = ai.auth.pending
        with pytest.raises(ProviderError, match='state'):
            ai.auth.complete(pending, {'state': 'wrong', 'code': 'code', 'client_id': 'issued'})
        with pytest.raises(ProviderError, match='registration'):
            ai.auth.complete(pending, {'state': pending['state'], 'code': 'code', 'client_id': 'dynamic_agent_client'})
        monkeypatch.setattr(chatgpt_auth, 'request', lambda *a, **k: {'access_token': 'secret', 'refresh_token': 'refresh', 'id_token': 'id', 'scope': chatgpt_auth.PLAN_SCOPE})
        monkeypatch.setattr(chatgpt_auth, 'validate_identity', lambda *a: {'sub': 'person', 'email': 'test@example.com'})
        ai.auth.complete(pending, {'state': pending['state'], 'code': 'code', 'client_id': 'issued'})
        assert ai.auth.status()['signedIn']
        assert 'secret' not in json.dumps(ai.settings())
        original = ai.store.read()['chatgpt']['accounts']['issued']
        ai.auth.start('issued')
        pending = ai.auth.pending
        monkeypatch.setattr(chatgpt_auth, 'validate_identity', lambda *a: {'sub': 'someone-else'})
        with pytest.raises(ProviderError, match='different identity'):
            ai.auth.complete(pending, {'state': pending['state'], 'code': 'code', 'client_id': 'issued'})
        assert ai.store.read()['chatgpt']['accounts']['issued'] == original
    finally:
        ai.close()


def test_refresh_rotates_and_logout_preserves_registration(tmp_path, monkeypatch):
    ai = OnlineAi(tmp_path)
    data = ai.store.read()
    data['chatgpt'] = {'host': 'host-id', 'active': 'issued', 'accounts': {'issued': {'sub': 'person', 'tokens': {'access_token': 'old', 'refresh_token': 'old-refresh', 'expires_at': 0, 'scope': chatgpt_auth.PLAN_SCOPE}}}}
    ai.store.write(data)
    calls = []
    def transport(url, **kwargs):
        calls.append((url,kwargs))
        return {'access_token': 'new', 'refresh_token': 'rotated', 'expires_in': 3600}
    monkeypatch.setattr(chatgpt_auth, 'request', transport)
    assert ai.auth.access_token() == 'new'
    assert ai.auth.access_token() == 'new' and len(calls) == 1
    assert calls[0][1]['form']['client_id'] == 'issued'
    assert ai.store.read()['chatgpt']['accounts']['issued']['tokens']['refresh_token'] == 'rotated'
    def offline(*args,**kwargs):
        raise ProviderError('offline')
    monkeypatch.setattr(chatgpt_auth, 'request', offline)
    ai.auth.sign_out()
    saved = ai.store.read()['chatgpt']
    assert saved['host'] == 'host-id' and saved['accounts']['issued']['sub'] == 'person'
    assert 'tokens' not in saved['accounts']['issued']
    assert 'not confirmed' in ai.auth.status()['message']


def test_claude_uses_official_client_with_no_tools_or_vault(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, 'claude_binary', lambda: '/official/claude')
    captured = {}
    class Process:
        returncode = 0
        def __init__(self, command, **kwargs):
            captured.update(command=command, **kwargs)
        def communicate(self, prompt, timeout):
            captured['prompt'] = prompt
            return json.dumps({'result': 'Answer', 'is_error': False}), None
    monkeypatch.setattr(ai_providers.subprocess, 'Popen', Process)
    ai = OnlineAi(tmp_path)
    monkeypatch.setattr(ai, 'claude_status', lambda: {'signedIn': True})
    assert ai.claude_ask('Selected text', 'sonnet') == 'Answer'
    assert captured['prompt'] == 'Selected text'
    assert captured['command'][captured['command'].index('--tools')+1] == ''
    assert '--strict-mcp-config' in captured['command'] and '--no-session-persistence' in captured['command']
    assert 'Selected text' not in captured['command']
    assert str(tmp_path) not in captured['cwd']
    assert 'ANTHROPIC_API_KEY' not in captured['env']


def test_claude_subscription_rejects_api_authentication(tmp_path, monkeypatch):
    ai = OnlineAi(tmp_path)
    monkeypatch.setattr(ai_providers, 'claude_binary', lambda: '/official/claude')
    monkeypatch.setattr(ai, 'claude_status', lambda: {'signedIn': False})
    with pytest.raises(ProviderError, match='API billing is not used'):
        ai.claude_ask('Do not send this', 'sonnet')


def test_callback_rejects_wrong_state_and_cancel_invalidates_attempt(tmp_path):
    import urllib.request
    ai = OnlineAi(tmp_path)
    try:
        ai.auth.start()
        pending = ai.auth.pending
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(pending['redirect'] + '?state=wrong&code=fake', timeout=3)
        assert error.value.code == 400
        assert ai.auth.pending is pending
        assert ai.auth.cancel()['pending'] is False
        with pytest.raises(ProviderError, match='expired'):
            ai.auth.complete(pending, {'state': pending['state'], 'code': 'fake', 'client_id': 'fake'})
        assert not ai.auth.status()['signedIn']
    finally:
        ai.close()


@pytest.mark.parametrize('existing', [
    'c0ca8525-8659-4af2-a578-d22e60878f23',
    'urn:uuid:c0ca8525-8659-4af2-a578-d22e60878f23',
    'urn:ietf:params:oauth:jwk-thumbprint:sha-256:example',
    'did:key:example',
])
def test_host_id_migration_is_stable_and_preserves_accounts(tmp_path, existing):
    ai = OnlineAi(tmp_path)
    data = ai.store.read()
    accounts = {'issued': {'sub': 'person', 'tokens': {'access_token': 'fixture-secret'}}}
    data['chatgpt'] = {'host': existing, 'active': 'issued', 'accounts': accounts}
    ai.store.write(data)
    expected = existing if ':' in existing else 'urn:uuid:' + existing
    try:
        for account in (None, 'issued'):
            result = ai.auth.start(account)
            assert parse_qs(urlparse(result['url']).query)['ext_agent_host_id'] == [expected]
            stored = ai.store.read()['chatgpt']
            assert stored == {'host': expected, 'active': 'issued', 'accounts': accounts}
    finally:
        ai.close()
