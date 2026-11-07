"""Bazasiz birlik testlari: telefon, narx hisobi, tokenlar."""
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.auth import TokenError, create_token, decode_token, hash_password, password_problems, verify_password
from app.models.enums import DeliveryPriceStatus
from app.services.pricing import calculate
from app.utils.phone import normalize_phone


@pytest.mark.parametrize("raw", ["+998 (90) 123-45-67", "998901234567", "90 123 45 67", "+998901234567"])
def test_normalize_phone(raw):
    assert normalize_phone(raw) == "+998901234567"


@pytest.mark.parametrize("raw", ["", "123", "+7 999 123 45 67", "+998 90 123 45 678"])
def test_normalize_phone_rejects(raw):
    with pytest.raises(ValueError):
        normalize_phone(raw)


def price(amount):
    return SimpleNamespace(price_per_m3=Decimal(amount), currency="UZS")


def test_calculate_delivery_pending():
    est = calculate(Decimal("12.5"), price("750000"), delivery_required=True)
    assert est.concrete_total == Decimal("9375000.00")
    assert est.delivery_price_status == DeliveryPriceStatus.PENDING
    assert est.delivery_price is None and est.grand_total is None


def test_calculate_confirmed_delivery_adds_up():
    est = calculate(Decimal("2"), price("500000"), delivery_required=True, delivery_price=Decimal("150000"))
    assert est.grand_total == Decimal("1150000.00")


def test_calculate_without_price():
    est = calculate(Decimal("5"), None, delivery_required=False)
    assert est.concrete_total is None and est.grand_total is None
    assert est.delivery_price_status == DeliveryPriceStatus.NOT_REQUIRED


def test_password_hash_and_policy():
    h = hash_password("Parol12345x")
    assert h.startswith("$argon2")
    assert verify_password("Parol12345x", h)
    assert not verify_password("boshqa", h)
    assert password_problems("qisqa") == ["kamida 10 ta belgi", "kamida bitta raqam"]


def test_tokens():
    access = create_token(7, "admin", "access")
    assert decode_token(access, "access")["sub"] == "7"
    with pytest.raises(TokenError):
        decode_token(access, "refresh")
    with pytest.raises(TokenError):
        decode_token(access + "x", "access")
