"""Deploydan keyingi tezkor tekshiruv (faqat standart kutubxona, hech narsa o'rnatish shart emas).

    python deploy/smoke_test.py https://beton.uz

Saytni o'zgartirmaydi: faqat GET so'rovlar va himoyalangan manzillarga tokensiz murojaat.
"""
import json
import sys
import urllib.error
import urllib.request

TIMEOUT = 15


def fetch(url: str) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "beton-smoke-test/1.0", "Accept-Encoding": "identity"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, {k.lower(): v for k, v in exc.headers.items()}, exc.read()


def main() -> int:
    if len(sys.argv) != 2:
        print("Foydalanish: python deploy/smoke_test.py https://sizning-domen.uz")
        return 2
    base = sys.argv[1].rstrip("/")
    https = base.startswith("https://")
    results: list[tuple[bool, str]] = []

    def check(ok: bool, text: str) -> None:
        results.append((ok, text))
        print(("  ✔ " if ok else "  ✘ ") + text)

    print(f"Tekshirilmoqda: {base}\n")

    status, _, body = fetch(f"{base}/api/v1/health")
    data = json.loads(body or b"{}") if status in (200, 503) else {}
    check(status == 200 and data.get("database") == "ok", f"Server va baza ishlayapti (/api/v1/health → {status}, baza: {data.get('database')})")

    status, headers, body = fetch(f"{base}/")
    check(status == 200 and b"BETON INDUSTRY" in body, f"Bosh sahifa ochiladi ({status})")
    check("content-security-policy" in headers, "Content-Security-Policy sarlavhasi bor")
    check(headers.get("x-frame-options") == "DENY", "X-Frame-Options: DENY")
    check(headers.get("x-content-type-options") == "nosniff", "X-Content-Type-Options: nosniff")
    check("server" not in headers or "uvicorn" not in headers.get("server", "").lower(), "Server versiyasi oshkor qilinmaydi")
    if https:
        check("strict-transport-security" in headers, "HSTS yoqilgan (faqat HTTPS uchun)")

    status, _, _ = fetch(f"{base}/admin/")
    check(status == 200, f"Admin panel sahifasi ochiladi ({status})")

    status, _, body = fetch(f"{base}/api/v1/public/products")
    check(status == 200 and isinstance(json.loads(body or b"null"), list), f"Mahsulotlar API ({status})")

    status, _, _ = fetch(f"{base}/api/v1/admin/dashboard")
    check(status == 401, f"Admin API tokensiz yopiq (→ {status}, kutilgan 401)")

    status, _, _ = fetch(f"{base}/api/docs")
    check(status == 404, f"API hujjatlari production'da yopiq (→ {status}, kutilgan 404)")

    status, _, _ = fetch(f"{base}/bunday-sahifa-yoq.html")
    check(status == 404, f"Noma'lum sahifa 404 qaytaradi ({status})")

    status, _, _ = fetch(f"{base}/.env")
    check(status == 404, f".env fayli ochiq emas (→ {status})")

    failed = [text for ok, text in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} tekshiruv o‘tdi.")
    if failed:
        print("Muammolar:\n - " + "\n - ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
