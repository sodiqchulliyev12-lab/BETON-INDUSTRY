"""O'zbekiston telefon raqamlarini yagona ko'rinishga keltirish: +998XXXXXXXXX."""
import re

_NON_DIGITS = re.compile(r"\D")


def normalize_phone(raw: str) -> str:
    """'+998 (90) 123-45-67', '998901234567', '90 123 45 67' → '+998901234567'.

    Raises:
        ValueError: raqam to'liq bo'lmasa.
    """
    digits = _NON_DIGITS.sub("", raw or "")
    if digits.startswith("998"):
        digits = digits[3:]
    if len(digits) != 9:
        raise ValueError("Telefon raqami to‘liq emas. Namuna: +998 90 123-45-67")
    return f"+998{digits}"
