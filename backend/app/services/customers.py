from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Customer


def get_or_create_customer(db: Session, phone: str, full_name: str) -> Customer:
    """Telefon bo'yicha mijozni topadi yoki yaratadi.

    Mavjud mijozning ismi saytdan kelgan so'rov bilan o'zgartirilmaydi — begona odam
    birovning raqamini yozib, ismini almashtira olmasligi uchun.
    Bir vaqtda kelgan ikki so'rov uchun ON CONFLICT ishlatiladi.
    """
    db.execute(
        insert(Customer)
        .values(phone=phone, full_name=full_name)
        .on_conflict_do_nothing(index_elements=[Customer.phone])
    )
    return db.scalars(select(Customer).where(Customer.phone == phone)).one()
