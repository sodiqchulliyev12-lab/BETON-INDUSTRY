"""Boshqaruv buyruqlari (backend/ papkasidan ishga tushiriladi).

    python -m app.cli create-admin              # birinchi administratorni yaratish
    python -m app.cli check-db                  # bazaga ulanishni tekshirish
    python -m app.cli seed-demo                 # DEMO markalar va loyiha qo'shish (aniq belgilangan)
    python -m app.cli clear-demo                # DEMO ma'lumotlarni olib tashlash

Hech bir buyruq standart parol yaratmaydi — parol har doim qo'lda kiritiladi.
"""
import argparse
import getpass
import os
import sys
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.orm import Session

from app.auth import hash_password, password_problems
from app.database import SessionLocal
from app.models import ConcretePrice, ConcreteProduct, OrderItem, Project, User
from app.models.enums import UserRole

# --- DEMO ma'lumotlar: haqiqiy zavod mahsuloti yoki narxi EMAS. Saytda "DEMO" belgisi bilan chiqadi. ---
DEMO_PRODUCTS = [
    {
        "slug": "demo-b15",
        "name": "DEMO marka B15",
        "grade_class": "B15",
        "description": "Namuna yozuv. Haqiqiy mahsulot admin panel orqali kiritiladi.",
        "specs": [{"label": "Namuna xususiyat", "value": "DEMO"}],
        "price": Decimal("100000"),
    },
    {
        "slug": "demo-b25",
        "name": "DEMO marka B25",
        "grade_class": "B25",
        "description": "Namuna yozuv — narxi belgilanmagan holatni ko‘rsatadi.",
        "specs": [{"label": "Namuna xususiyat", "value": "DEMO"}],
        "price": None,
    },
]


def _print(message: str) -> None:
    print(message, flush=True)


def check_db(_: argparse.Namespace) -> int:
    with SessionLocal() as db:
        version = db.execute(text("SHOW server_version")).scalar_one()
        revision = db.execute(text("SELECT version_num FROM alembic_version")).scalar_one_or_none()
    _print(f"PostgreSQL {version} — ulanish muvaffaqiyatli. Migratsiya versiyasi: {revision or 'yo‘q'}")
    return 0


def create_admin(args: argparse.Namespace) -> int:
    username = (args.username or input("Login (username): ")).strip().lower()
    if not username or len(username) < 3 or not username.replace("_", "").replace(".", "").isalnum():
        _print("Xato: login kamida 3 ta belgi, faqat lotin harflari, raqam, '_' yoki '.' bo‘lishi kerak.")
        return 1
    full_name = (args.full_name or input("To‘liq ism: ")).strip()
    if len(full_name) < 2:
        _print("Xato: to‘liq ismni kiriting.")
        return 1

    if args.password_stdin:
        password = sys.stdin.readline().rstrip("\n")
    else:
        password = getpass.getpass("Parol: ")
        if password != getpass.getpass("Parolni takrorlang: "):
            _print("Xato: parollar mos kelmadi.")
            return 1

    problems = password_problems(password)
    if problems:
        _print("Xato: parol talabga javob bermaydi — " + ", ".join(problems) + ".")
        return 1

    with SessionLocal() as db:
        if db.scalar(select(User.id).where(func.lower(User.username) == username)):
            _print(f"Xato: '{username}' loginli foydalanuvchi allaqachon mavjud.")
            return 1
        db.add(User(username=username, full_name=full_name, password_hash=hash_password(password), role=UserRole.ADMIN))
        db.commit()
    _print(f"Administrator '{username}' yaratildi.")
    return 0


def bootstrap_admin(_: argparse.Namespace) -> int:
    """Birinchi administratorni muhit o'zgaruvchilaridan yaratish (Railway kabi hostinglar uchun).

    ADMIN_USERNAME va ADMIN_PASSWORD (ixtiyoriy: ADMIN_FULL_NAME) berilgan bo'lsa VA tizimda hali
    birorta ham administrator bo'lmasa — yaratadi. Aks holda hech narsa qilmaydi. Deploy'ni hech qachon
    to'xtatmaydi (har doim 0 qaytaradi); parol logga yozilmaydi.
    Administrator yaratilgach, o'zgaruvchilarni hostingdan o'chirib qo'yish tavsiya etiladi.
    """
    username = (os.environ.get("ADMIN_USERNAME") or "").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD") or ""
    full_name = (os.environ.get("ADMIN_FULL_NAME") or "").strip() or "Administrator"
    if not username or not password:
        return 0
    if len(username) < 3 or not username.replace("_", "").replace(".", "").isalnum():
        _print("[bootstrap-admin] ADMIN_USERNAME noto‘g‘ri: kamida 3 belgi, lotin harflari, raqam, '_' yoki '.'.")
        return 0
    problems = password_problems(password)
    if problems:
        _print("[bootstrap-admin] ADMIN_PASSWORD talabga javob bermaydi — " + ", ".join(problems) + ". Administrator yaratilmadi.")
        return 0

    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(User).where(User.role == UserRole.ADMIN)):
            _print("[bootstrap-admin] Administrator allaqachon mavjud — hech narsa o‘zgartirilmadi. "
                   "ADMIN_USERNAME / ADMIN_PASSWORD o‘zgaruvchilarini o‘chirib qo‘ying.")
            return 0
        if db.scalar(select(User.id).where(func.lower(User.username) == username)):
            _print(f"[bootstrap-admin] '{username}' loginli foydalanuvchi mavjud, lekin administrator emas — o‘zgartirilmadi.")
            return 0
        db.add(User(username=username, full_name=full_name, password_hash=hash_password(password), role=UserRole.ADMIN))
        db.commit()
    _print(f"[bootstrap-admin] Administrator '{username}' yaratildi. Endi ADMIN_PASSWORD o‘zgaruvchisini o‘chirib qo‘ying.")
    return 0


def seed_demo(_: argparse.Namespace) -> int:
    with SessionLocal() as db:
        created = 0
        for item in DEMO_PRODUCTS:
            if db.scalar(select(ConcreteProduct.id).where(ConcreteProduct.slug == item["slug"])):
                continue
            product = ConcreteProduct(
                slug=item["slug"],
                name=item["name"],
                grade_class=item["grade_class"],
                description=item["description"],
                specs=item["specs"],
                is_demo=True,
            )
            db.add(product)
            db.flush()
            if item["price"] is not None:
                db.add(ConcretePrice(product_id=product.id, price_per_m3=item["price"], note="DEMO narx"))
            created += 1

        if not db.scalar(select(Project.id).where(Project.slug == "demo-loyiha")):
            db.add(
                Project(
                    slug="demo-loyiha",
                    title="DEMO loyiha",
                    description="Namuna yozuv. Haqiqiy loyihalar admin panel orqali qo‘shiladi.",
                    completed_at=date.today(),
                    is_published=True,
                    is_demo=True,
                )
            )
            created += 1
        db.commit()
    _print(f"DEMO yozuvlar qo‘shildi: {created}. Saytda ular 'DEMO' belgisi bilan ko‘rinadi.")
    return 0


def clear_demo(_: argparse.Namespace) -> int:
    with SessionLocal() as db:
        demo_ids = list(db.scalars(select(ConcreteProduct.id).where(ConcreteProduct.is_demo.is_(True))))
        used_ids = set(db.scalars(select(OrderItem.product_id).where(OrderItem.product_id.in_(demo_ids)))) if demo_ids else set()
        removable = [pid for pid in demo_ids if pid not in used_ids]
        if removable:
            db.execute(delete(ConcreteProduct).where(ConcreteProduct.id.in_(removable)))
        if used_ids:  # buyurtmada ishlatilgan — o'chirilmaydi, faqat katalogdan olinadi
            db.execute(update(ConcreteProduct).where(ConcreteProduct.id.in_(used_ids)).values(is_active=False))
        projects = db.execute(delete(Project).where(Project.is_demo.is_(True))).rowcount
        db.commit()
    _print(
        f"O‘chirildi: {len(removable)} ta DEMO marka, {projects} ta DEMO loyiha. "
        f"Buyurtmada ishlatilgani uchun nofaol qilindi: {len(used_ids)}."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="BETON INDUSTRY boshqaruv buyruqlari")
    sub = parser.add_subparsers(dest="command", required=True)

    p_admin = sub.add_parser("create-admin", help="Administrator yaratish")
    p_admin.add_argument("--username")
    p_admin.add_argument("--full-name")
    p_admin.add_argument("--password-stdin", action="store_true", help="Parolni stdin'dan o‘qish (avtomatlashtirish uchun)")
    p_admin.set_defaults(func=create_admin)

    sub.add_parser("bootstrap-admin", help="Birinchi administratorni ADMIN_USERNAME/ADMIN_PASSWORD dan yaratish").set_defaults(func=bootstrap_admin)
    sub.add_parser("check-db", help="Bazaga ulanishni tekshirish").set_defaults(func=check_db)
    sub.add_parser("seed-demo", help="DEMO ma'lumot qo'shish").set_defaults(func=seed_demo)
    sub.add_parser("clear-demo", help="DEMO ma'lumotni olib tashlash").set_defaults(func=clear_demo)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
