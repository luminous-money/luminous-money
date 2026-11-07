"""Sealing what's kept secret (Amazon's password and the authenticator's setup key): AES-256-GCM
with SHOPS_ENCRYPTION_KEY, or AI_ENCRYPTION_KEY when that isn't set (every deployment has it, and
backups carry it with the data). Sealed text is `v1:<base64 nonce + ciphertext>`."""

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class NoKey(Exception):
    pass


def _key() -> bytes:
    text = os.environ.get("SHOPS_ENCRYPTION_KEY") or os.environ.get("AI_ENCRYPTION_KEY") or ""
    try:
        key = base64.b64decode(text, validate=True)
    except ValueError:
        key = b""
    if len(key) != 32:
        raise NoKey("SHOPS_ENCRYPTION_KEY (or AI_ENCRYPTION_KEY) isn't set to 32 bytes of base64")
    return key


def ready() -> bool:
    try:
        _key()
        return True
    except NoKey:
        return False


def seal(plain: str) -> str:
    nonce = os.urandom(12)
    sealed = AESGCM(_key()).encrypt(nonce, plain.encode(), None)
    return "v1:" + base64.b64encode(nonce + sealed).decode()


def unseal(sealed: str) -> str:
    raw = base64.b64decode(sealed.removeprefix("v1:"))
    return AESGCM(_key()).decrypt(raw[:12], raw[12:], None).decode()
