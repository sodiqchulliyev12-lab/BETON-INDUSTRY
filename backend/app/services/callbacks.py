from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CallbackRequest, Customer
from app.schemas.callback import CallbackCreate


def create_callback(db: Session, data: CallbackCreate) -> CallbackRequest:
    """Qayta qo'ng'iroq so'rovini saqlaydi. Mijoz bazada bo'lsa unga bog'lanadi (yangi mijoz yaratilmaydi)."""
    customer_id = db.scalar(select(Customer.id).where(Customer.phone == data.phone))
    request = CallbackRequest(
        name=data.name,
        phone=data.phone,
        message=data.message,
        source_page=data.source_page,
        customer_id=customer_id,
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request
