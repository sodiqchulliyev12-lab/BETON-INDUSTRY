# BETON INDUSTRY

Tayyor beton ishlab chiqaruvchi zavod uchun tijorat platformasi: ommaviy sayt, onlayn kalkulyator,
buyurtma tizimi, admin panel, transport va ishlab chiqarish boshqaruvi, Telegram xabarnomalari.

> **Muhim tamoyil:** zavodning haqiqiy ma'lumotlari (beton markalari, narxlar, telefon, manzil,
> ishlab chiqarish quvvati, transport, haydovchilar) kodga yozilmaydi. Ularning barchasi admin panel
> orqali kiritiladi. Ma'lumot kiritilmagan bo'lsa, sayt "Ma'lumot hali kiritilmagan" deb ko'rsatadi —
> soxta raqam yoki statistika chiqmaydi.

## Texnologiyalar

| Qism | Texnologiya |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES modules), build bosqichisiz |
| Backend | Python 3.12+, FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2 |
| Ma'lumotlar bazasi | PostgreSQL |
| Xavfsizlik | JWT, Argon2 parol hash, CORS allowlist, rate limit |
| Integratsiya | Telegram Bot API |
| Deploy | Docker → Railway yoki VPS (nginx + systemd) |

## Loyiha tuzilmasi

```
BETON INDUSTRY/
├── frontend/            # Ommaviy sayt va admin panel (statik fayllar)
│   ├── *.html           # 7 ta sahifa + 404
│   ├── css/             # Dizayn tizimi
│   ├── js/              # Umumiy modullar + pages/ (sahifa skriptlari)
│   └── assets/          # Logotip, illyustratsiyalar, ikonkalar
├── backend/             # FastAPI ilovasi, Alembic migratsiyalari, testlar
├── deploy/              # entrypoint.sh, nginx.conf, systemd, backup.sh, smoke_test.py
├── .github/workflows/   # CI: migratsiyalar + testlar
├── Dockerfile           # Production image (Railway / Docker)
├── railway.json         # Railway sozlamalari (healthcheck, restart)
├── docker-compose.yml   # Lokal PostgreSQL
└── README.md
```

## Bosqichlar holati

- [x] **0. Arxitektura** — tasdiqlangan
- [x] **1. Frontend dizayn va ommaviy sahifalar**
- [x] **2. Backend, PostgreSQL, Alembic, ochiq API**
- [x] **3. Auth va admin panel (asosiy bo'limlar)**
- [x] **4. Admin: transport, haydovchilar, ishlab chiqarish, galereya**
- [x] **5. Telegram integratsiyasi**
- [x] **6. Test va deploy**
- [x] **7. Xarita (OpenStreetMap)**

## Deploy

### Production muhit o'zgaruvchilari

| O'zgaruvchi | Majburiy | Izoh |
|---|---|---|
| `APP_ENV` | ha | `production` (Docker image'da standart). Swagger yopiladi, HSTS va `Secure` cookie yoqiladi |
| `DATABASE_URL` | ha | Railway Postgres beradigan `postgresql://...` ham qabul qilinadi |
| `SECRET_KEY` | ha | `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Namunadagi qiymat bilan server ishga tushmaydi |
| `ALLOWED_HOSTS` | tavsiya | Domenlar vergul bilan: `beton.uz,www.beton.uz,xxx.up.railway.app` |
| `PUBLIC_BASE_URL` | tavsiya | `https://beton.uz` — Telegram xabaridagi havola uchun |
| `TELEGRAM_BOT_TOKEN` | yo'q | Bo'sh bo'lsa xabarnomalar yuborilmaydi |
| `UPLOAD_DIR` | — | Docker'da `/data/uploads` (Volume ulanadigan joy) |
| `ALLOWED_ORIGINS` | yo'q | Frontend boshqa domendan ishlasa. Bitta domenda ishlasa bo'sh qoldiring |
| `WEB_CONCURRENCY` | yo'q | uvicorn jarayonlari soni (standart 2) |

### Variant A — Railway

1. Kodni GitHub'ga yuklang (`.env` yuklanmaydi — `.gitignore` da).
2. Railway → **New Project → Deploy from GitHub repo** → shu repozitoriy. Railway `Dockerfile` va
   `railway.json` ni o'zi topadi.
3. **+ New → Database → PostgreSQL** qo'shing. Ilova servisi → **Variables**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `SECRET_KEY` = yangi tasodifiy kalit
   - `ALLOWED_HOSTS`, `PUBLIC_BASE_URL`, kerak bo'lsa `TELEGRAM_BOT_TOKEN`
4. **Rasmlar uchun Volume (majburiy):** ilova servisi → **Settings → Volumes → New Volume**,
   mount path: `/data`. Volume'siz yuklangan rasmlar har deployda o'chib ketadi.
5. **Settings → Networking → Generate Domain** (yoki o'z domeningizni ulang) va domenni `ALLOWED_HOSTS` ga yozing.
6. **Birinchi administrator (eng oson yo'l):** servis → **Variables** ga `ADMIN_USERNAME` va
   `ADMIN_PASSWORD` qo'shing (parol kamida 10 belgi, harf va raqam). Servis qayta ishga tushganda
   administrator avtomatik yaratiladi — faqat tizimda hali admin bo'lmasa. Kirib bo'lgach,
   **`ADMIN_PASSWORD` o'zgaruvchisini o'chirib qo'ying.**

   Muqobil yo'l — konteyner ichida (Railway CLI'ning `railway ssh` buyrug'i yoki dashboarddagi servis konsoli orqali):
   ```bash
   railway ssh
   cd /app/backend && python -m app.cli create-admin
   ```
7. Tekshiring: `python deploy/smoke_test.py https://sizning-domen`

Migratsiyalar har deployda konteyner ishga tushganda avtomatik qo'llanadi (`deploy/entrypoint.sh`).

### Variant B — VPS (Ubuntu 22.04/24.04)

```bash
# 1. Paketlar
sudo apt update && sudo apt install -y python3.12 python3.12-venv postgresql nginx certbot python3-certbot-nginx git

# 2. Baza (parolni o'zingiznikiga almashtiring)
sudo -u postgres psql -c "CREATE USER beton WITH PASSWORD 'KUCHLI_PAROL';"
sudo -u postgres psql -c "CREATE DATABASE beton_industry OWNER beton;"

# 3. Kod va foydalanuvchi
sudo useradd --system --create-home --home-dir /opt/beton-industry --shell /usr/sbin/nologin beton
sudo -u beton git clone <REPO_URL> /opt/beton-industry
cd /opt/beton-industry/backend
sudo -u beton python3.12 -m venv .venv
sudo -u beton .venv/bin/pip install -r requirements.txt
sudo -u beton cp .env.example .env && sudo -u beton mkdir -p uploads
sudo -u beton nano .env      # APP_ENV=production, DATABASE_URL, SECRET_KEY, ALLOWED_HOSTS, PUBLIC_BASE_URL
sudo chmod 600 .env

# 4. Migratsiya va administrator
sudo -u beton .venv/bin/python -m alembic upgrade head
sudo -u beton .venv/bin/python -m app.cli create-admin

# 5. Xizmat
sudo cp ../deploy/beton-industry.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now beton-industry

# 6. nginx + HTTPS (deploy/nginx.conf ichidagi domenni almashtiring; snippet faylini ham yarating)
sudo cp ../deploy/nginx.conf /etc/nginx/sites-available/beton-industry
sudo ln -s /etc/nginx/sites-available/beton-industry /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d beton.uz -d www.beton.uz

# 7. Firewall: faqat SSH va veb
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

Yangilash: `cd /opt/beton-industry && sudo -u beton git pull && sudo -u beton backend/.venv/bin/pip install -r backend/requirements.txt && sudo systemctl restart beton-industry`
(migratsiya `ExecStartPre` da avtomatik).

### Zaxira nusxalar

- **VPS:** `deploy/backup.sh` — baza (`pg_dump`) + rasmlar, oxirgi 14 kun saqlanadi. Cron namunasi va
  tiklash buyrug'i skript boshida yozilgan. Zaxirani vaqti-vaqti bilan boshqa serverga ham ko'chiring.
- **Railway:** PostgreSQL servisi → **Backups** bo'limini yoqing; rasmlar Volume'da turadi.
- Tiklashni oldindan bir marta sinab ko'ring — tekshirilmagan zaxira zaxira emas.

### Deploydan keyin tekshirish

```bash
python deploy/smoke_test.py https://beton.uz
```

12 ta tekshiruv: server va baza, bosh sahifa, xavfsizlik sarlavhalari (CSP, X-Frame-Options, nosniff, HSTS),
admin API tokensiz yopiqligi, Swagger yopiqligi, `.env` ochiq emasligi.

Qo'lda: admin panelga kiring → sozlamalarda telefon/manzil kiriting → marka va narx qo'shing →
saytdan sinov buyurtmasi bering → Telegram xabari kelganini tekshiring → sinov buyurtmasini bekor qiling.

### Loglar va xatolar

| Joy | Buyruq |
|---|---|
| Railway | Servis → **Deployments → View logs** |
| VPS ilova | `sudo journalctl -u beton-industry -f` |
| VPS nginx | `/var/log/nginx/beton-industry.error.log` |

| Belgi | Sabab |
|---|---|
| Deploy healthcheck'dan o'tmaydi | `DATABASE_URL` noto'g'ri yoki migratsiya xatosi — logda `[entrypoint]` qatorlarini qarang |
| `Invalid host header` / 400 | domen `ALLOWED_HOSTS` da yo'q |
| Rasmlar deploydan keyin yo'qoladi | Railway Volume `/data` ga ulanmagan |
| Admin panelga kirgach darhol chiqarib yuboradi | sayt HTTP orqali ochilgan — production'da cookie faqat HTTPS'da ishlaydi |
| 429 | so'rovlar cheklovi (spam himoyasi), bir necha daqiqa kuting |

### Xavfsizlik ro'yxati (bajarilgan)

- Parollar Argon2id; JWT 30 daqiqa; refresh token `HttpOnly + Secure + SameSite=Strict` cookie;
  parol/rol o'zgarsa sessiyalar bekor qilinadi.
- Har bir admin endpoint ruxsatni tekshiradi; login va ochiq formalarga so'rovlar cheklovi.
- SQL faqat SQLAlchemy parametrlari orqali; kiruvchi ma'lumotlar Pydantic bilan tekshiriladi, ortiqcha maydonlar rad etiladi.
- CSP (inline skript va stil yo'q), X-Frame-Options, nosniff, Referrer-Policy, HSTS, `Server` sarlavhasi yashirilgan.
- So'rov hajmi chegarasi (6 MB), Host header tekshiruvi, rasm turi baytlar bo'yicha tekshiriladi.
- Maxfiy ma'lumotlar faqat `.env` da; `.env`, `uploads/` git va Docker image'ga kirmaydi.
- Konteyner root huquqisiz ishlaydi; VPS'da systemd himoya sozlamalari (`ProtectSystem=strict`).
- `pip-audit`: o'rnatilgan paketlarda ma'lum zaifliklar topilmadi (2026-11-07).

## Lokal ishga tushirish

### 1. PostgreSQL

Quyidagilardan biri:

- **Docker bilan:** `docker compose up -d db` (loyiha ildizida). `beton_industry` va `beton_test`
  bazalari avtomatik yaratiladi.
- **Docker'siz (Windows):** <https://www.postgresql.org/download/windows/> dan PostgreSQL 16 ni
  o'rnating, so'ng pgAdmin yoki `psql` orqali:
  ```sql
  CREATE USER beton WITH PASSWORD 'o-zingizning-parolingiz';
  CREATE DATABASE beton_industry OWNER beton;
  CREATE DATABASE beton_test OWNER beton;
  ```

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt
copy .env.example .env          # Linux/macOS: cp .env.example .env
```

`.env` ichida `DATABASE_URL` va `SECRET_KEY` ni to'ldiring. Kalit yaratish:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Jadvallarni yaratish va serverni ishga tushirish:

```bash
alembic upgrade head
python -m app.cli check-db
python -m app.cli create-admin
uvicorn app.main:app --reload --port 8000
```

- Sayt: <http://localhost:8000> (frontendni FastAPI o'zi tarqatadi)
- API hujjatlari (faqat development): <http://localhost:8000/api/docs>
- Holat: <http://localhost:8000/api/v1/health>

Ixtiyoriy — saytni namuna bilan ko'rish uchun `python -m app.cli seed-demo` (saytda "DEMO"
belgisi bilan chiqadi), olib tashlash: `python -m app.cli clear-demo`.

### 3. Testlar

Testlar haqiqiy PostgreSQL'da ishlaydi va `beton_test` bazasini **har safar tozalaydi**
(asosiy bazani bermang!):

```bash
set TEST_DATABASE_URL=postgresql+psycopg://beton:PAROL@localhost:5432/beton_test
pytest -q
```

Linux/macOS'da: `TEST_DATABASE_URL=... pytest -q`

### Frontendni alohida ishga tushirish (ixtiyoriy)

```bash
cd frontend
python -m http.server 5500
```

Frontend API manzilini o'zi aniqlaydi (`frontend/js/config.js`): `localhost` da 8000-portdan boshqa
portda ochilsa → `http://localhost:8000/api/v1`, boshqa hollarda → shu domendagi `/api/v1`.
Bunday holatda `.env` dagi `ALLOWED_ORIGINS` ga `http://localhost:5500` yozilgan bo'lishi kerak.

## Xatolarni tekshirish

| Belgi | Sabab va yechim |
|---|---|
| `alembic upgrade head` → `connection refused` | PostgreSQL ishlamayapti yoki `DATABASE_URL` dagi port/parol noto'g'ri |
| `SECRET_KEY ... at least 32 characters` | `.env` dagi `SECRET_KEY` juda qisqa |
| Saytda "Server bilan aloqa o'rnatilmadi" | backend ishlamayapti — `/api/v1/health` ni oching |
| Brauzer konsolida CORS xatosi | frontend manzili `ALLOWED_ORIGINS` ro'yxatida yo'q |
| Buyurtmada `429` | bir IP'dan daqiqasiga 5 tadan ko'p so'rov (spamdan himoya) |

- Server loglari uvicorn ishlayotgan terminalda chiqadi. Ichki xato tafsilotlari foydalanuvchiga
  ko'rsatilmaydi, faqat logga yoziladi.
- Brauzerda **F12 → Console / Network**: so'rovlar va javoblarni ko'rish.

## Admin panel

Manzil: <http://localhost:8000/admin/> (serverda: `https://sizning-domen/admin/`).

Birinchi administrator faqat buyruq orqali yaratiladi (standart parol yo'q):

```bash
python -m app.cli create-admin
```

Qolgan xodimlarni administrator panelning **Foydalanuvchilar** bo'limidan qo'shadi.

| Bo'lim | Holati |
|---|---|
| Dashboard | ✅ faqat haqiqiy ma'lumot; buyurtma bo'lmasa grafik o'rniga bo'sh holat |
| Buyurtmalar | ✅ ro'yxat, qidiruv, filtr, tafsilot, holat o'zgartirish, yetkazib berish narxini tasdiqlash |
| Beton markalari | ✅ qo'shish, tahrirlash, texnik xususiyatlar, faol/nofaol, sotuvda/sotuvda emas |
| Narxlar | ✅ narx kiritish, tarix, narxni olib tashlash |
| Mijozlar | ✅ ro'yxat, tafsilot, tahrirlash + qayta qo'ng'iroq so'rovlari |
| Foydalanuvchilar | ✅ yaratish, rol, bloklash, parolni almashtirish |
| Tizim sozlamalari | ✅ telefon, manzil, ish vaqti, "Biz haqimizda" matni, ishlab chiqarish quvvati |
| Transport | ✅ o'z va ijaraga olingan mashinalar, sig'im (noma'lum bo'lishi mumkin), holat, ta'mir + kunlik qatnovlar jadvali |
| Haydovchilar | ✅ ro'yxat, doimiy mashinaga biriktirish |
| Buyurtma → qatnovlar | ✅ bitta buyurtmaga bir nechta mashina/qatnov, ijara xarajati, yuklandi/yo'lda/yetkazildi |
| Ishlab chiqarish | ✅ kunlik reja, haqiqiy hajm, sifat nazorati, yuklangan/yetkazilgan/qolgan hajm |
| Loyihalar va galereya | ✅ loyihalar, rasm yuklash (JPG/PNG/WebP, 5 MB), muqova, nashr etish |
| Telegram sozlamalari | ✅ chat ID'lar, hodisalar, xabar shabloni, sinov xabari, xabarlar jurnali |

### Transport va qatnov qoidalari

- Ta'mirdagi yoki nofaol mashinaga qatnov biriktirilmaydi; yakunlanmagan qatnovi bor mashinani ta'mirga yuborib bo'lmaydi.
- Qatnovlar jami hajmi buyurtma hajmidan, bitta qatnov hajmi mashina sig'imidan (ma'lum bo'lsa) oshmaydi.
- Ijara xarajati faqat ijaraga olingan transport uchun yoziladi va buyurtma bo'yicha jamlanadi.
- Mashina holati (bo'sh/band) qatnovlarga qarab avtomatik o'zgaradi.
- Qatnovlarda qayd etilgan mashina yoki haydovchi o'chirilmaydi — nofaol qilinadi.

### Ishlab chiqarish

- Kunlik quvvat **Tizim sozlamalari**da kiritiladi. Kiritilmagan bo'lsa «Belgilanmagan» yoziladi va
  foydalanish foizi hisoblanmaydi.
- Ishlab chiqarish yozuvi «Sifat nazorati kutilmoqda» holatida yaratiladi; «O'tmadi» uchun sabab yozish shart.
  O'tmagan hajm ishlab chiqarilgan hajmga qo'shilmaydi.
- Buyurtma sahifasida: buyurtma → ishlab chiqarilgan → sifatdan o'tgan → yuklangan → yetkazilgan → qolgan hajm.

### Telegram xabarnomalari

1. Telegram'da **@BotFather** → `/newbot` → bot nomini bering va tokenni oling.
2. Serverdagi `backend/.env` fayliga yozing va serverni qayta ishga tushiring:
   ```
   TELEGRAM_BOT_TOKEN=123456789:AA...
   PUBLIC_BASE_URL=https://sizning-domen.uz
   ```
3. Botga `/start` yozing (yoki botni mas'ul xodimlar guruhiga qo'shib, guruhda xabar yozing).
4. Admin panel → **Telegram sozlamalari** → «Chat ID'ni topish» → chatni tanlang → «Saqlash».
5. «Sinov xabarini yuborish» bilan tekshiring va xabarnomalarni yoqing.

| Hodisa | Xabar mazmuni |
|---|---|
| Yangi buyurtma | raqam, mijoz, telefon, marka va hajm, manzil, sana, taxminiy summa, izoh, admin havolasi |
| Holat o'zgardi (ixtiyoriy) | eski → yangi holat, kim o'zgartirdi, bekor qilish sababi, izoh |
| Qayta qo'ng'iroq so'rovi | ism, telefon, xabar |

- Token faqat `.env` da; admin panelda, bazada, jurnalda va xato matnlarida ko'rinmaydi.
- Xabar fon vazifasida yuboriladi: Telegram ishlamasa ham buyurtma qabul qilinadi, xato **Oxirgi xabarlar**
  jurnaliga yoziladi. Tarmoq xatosi, 429 yoki 5xx bo'lsa bir marta qayta urinadi.
- Mijoz kiritgan matnlar HTML-escape qilinadi. Yangi buyurtma xabarini `{order_number}`, `{products}`,
  `{total}` kabi o'zgaruvchilar bilan o'zgartirish mumkin; shablonda HTML xato bo'lsa, xabar oddiy matn
  sifatida yuboriladi.

### Xarita (OpenStreetMap)

| Joy | Imkoniyat |
|---|---|
| Admin → Tizim sozlamalari | Zavod joylashuvi: manzilni qidirish yoki xaritani bosish |
| Sayt → Aloqa | Zavod xaritada + «Yo‘nalish olish» havolasi (joylashuv kiritilmagan bo‘lsa — xabar) |
| Sayt → Buyurtma | Ixtiyoriy: yetkazish nuqtasini xaritada belgilash; manzil matni avtomatik taklif qilinadi |
| Admin → Buyurtma | Zavod va yetkazish nuqtasi, to‘g‘ri chiziq masofasi, nuqtani o‘zgartirish |
| Telegram | Xabarda «📍 Xaritada ochish» havolasi (haydovchilar uchun) |

- **Masofa faqat ma'lumot uchun** (to‘g‘ri chiziq bo‘yicha). Yetkazib berish narxi avtomatik
  hisoblanmaydi — uni menejer belgilaydi.
- Leaflet 1.9.4 loyihaning o'zida (`frontend/assets/vendor/leaflet`, BSD-2 litsenziya) — CDN yo'q,
  CSP'da skriptlar faqat o'z domenimizdan. Xarita kutubxonasi faqat xarita kerak bo'lgan sahifada yuklanadi.
- Xarita plitkalari `tile.openstreetmap.org` dan (CSP `img-src` da ruxsat etilgan). Trafik juda katta
  bo'lsa, [OSM plitka siyosati](https://operations.osmfoundation.org/policies/tiles/) bo'yicha boshqa
  provayderga o'ting: `frontend/js/config.js` (`MAP.TILE_URL`) va `backend/app/main.py` (CSP) ni o'zgartiring.
- Manzil qidirish backend orqali (`/api/v1/public/geocode`) Nominatim'ga boradi: sekundiga 1 so'rov,
  24 soatlik kesh, mijoz IP manzili uchinchi tomonga ketmaydi. O'chirish: `.env` → `GEOCODER_ENABLED=false`
  (xaritani bosib belgilash ishlayveradi).
- Saytdan kelgan nuqta O'zbekiston hududida bo'lishi kerak; koordinatalar 6 xona aniqlikda saqlanadi.

### Yuklangan rasmlar

- `backend/uploads/` papkasida saqlanadi va `/uploads/...` manzilidan beriladi (git'ga tushmaydi).
- Fayl turi kengaytma bo'yicha emas, ichidagi baytlar bo'yicha tekshiriladi; SVG/HTML qabul qilinmaydi;
  fayl nomi tasodifiy yaratiladi.
- **Deploy uchun muhim:** Railway'da konteyner fayl tizimi qayta ishga tushganda tozalanadi — `UPLOAD_DIR`
  uchun doimiy disk (Volume) ulash kerak (6-bosqichda sozlanadi).

### Rollar

| Rol | Imkoniyatlari |
|---|---|
| Administrator | Hammasi, jumladan foydalanuvchilar va tizim sozlamalari |
| Menejer | Buyurtmalar (narx, tasdiqlash, bekor qilish), markalar, narxlar, mijozlar, transport, qatnovlar, ishlab chiqarish, loyihalar |
| Dispetcher | Buyurtmalarni ko'rish; transport, haydovchilar, qatnovlar; holatlar: rejalashtirildi, yuklandi, yo'lda, yetkazildi |
| Ishlab chiqarish | Buyurtmalarni ko'rish; reja, ishlab chiqarish yozuvlari, sifat nazorati; holatlar: ishlab chiqarilmoqda, sifat nazorati, yuklandi |
| Kuzatuvchi | Faqat ko'rish |

### Buyurtma qoidalari

- Holatlar ketma-ketligi: Yangi → Tasdiqlandi → Rejalashtirildi → Ishlab chiqarilmoqda → Sifat
  nazoratida → Yuklandi → Yo'lda → Yetkazib berildi. Sifat nazoratidan o'tmasa ishlab chiqarishga
  qaytariladi. Bekor qilish uchun sabab yozish shart.
- **Tasdiqlash** uchun beton narxi va yetkazib berish narxi aniq bo'lishi kerak (yetkazib berish
  narxi 0 deb taxmin qilinmaydi; bepul bo'lsa menejer 0 ni o'zi kiritadi).
- Har bir holat o'zgarishi kim va qachon o'zgartirgani bilan tarixda saqlanadi.

### Xavfsizlik

- Parollar Argon2id bilan hash qilinadi; parol siyosati: kamida 10 belgi, harf va raqam.
- Access token (30 daqiqa) faqat brauzer xotirasida; refresh token — `HttpOnly`, `SameSite=Strict`
  cookie (production'da `Secure`).
- Parol almashtirilsa, foydalanuvchi bloklansa yoki roli o'zgarsa, uning barcha sessiyalari darhol tugaydi.
- Login urinishlari cheklangan (daqiqasiga 10 ta), noto'g'ri login va noto'g'ri parolga bir xil javob qaytadi.
- Har bir admin endpoint aniq ruxsatni tekshiradi (`backend/app/permissions.py`).

## Ma'lumotlar bazasi

Migratsiyalar: `0001` — boshlang'ich sxema, `0002` — `users.token_version` (sessiyalarni bekor qilish uchun),
`0003` — `notification_logs` (Telegram xabarlari jurnali), `0004` — buyurtma yetkazish nuqtasi
(`delivery_lat/lon`) va zavod koordinatalari sozlamalari.

18 ta jadval (`notification_logs` bilan): `users`, `customers`, `concrete_products`, `concrete_prices`, `orders`, `order_items`,
`order_status_history`, `vehicles`, `drivers`, `order_trips`, `production_plans`,
`production_records`, `projects`, `project_images`, `telegram_settings`, `system_settings`,
`callback_requests`.

- Narxlar tarixi saqlanadi: har bir marka uchun faqat bitta amaldagi narx (`valid_to IS NULL`) bo'lishi
  bazaning o'zida qisman unique indeks bilan kafolatlangan.
- Buyurtma raqami `BI-YYYY-000001` PostgreSQL ketma-ketligidan olinadi — takrorlanmaydi.
- Buyurtma tarkibida narx va marka nomi buyurtma paytidagi holatida saqlanadi.
- `system_settings` kalitlari migratsiyada **bo'sh qiymat bilan** yaratiladi: telefon, manzil,
  ishlab chiqarish quvvati va boshqalar admin paneldan kiritiladi.
- Yangi migratsiya: modelni o'zgartiring → `alembic revision --autogenerate -m "tavsif"` → faylni
  ko'zdan kechiring → `alembic upgrade head`.

## Ommaviy API

| Metod | Yo'l | Vazifasi |
|---|---|---|
| GET | `/api/v1/public/settings` | Ommaviy sozlamalar: `{ "company.phone": "...", ... }` |
| GET | `/api/v1/public/products` | Faol beton markalari (narx bilan) |
| GET | `/api/v1/public/projects` | Nashr etilgan loyihalar |
| GET | `/api/v1/public/geocode?q=` | Manzil qidirish (O'zbekiston) |
| GET | `/api/v1/public/reverse-geocode?lat=&lon=` | Koordinata bo'yicha manzil |
| POST | `/api/v1/public/orders` | Buyurtma yaratish → `{ order_number, ... }` |
| POST | `/api/v1/public/callback-requests` | Qayta qo'ng'iroq so'rovi |

Ommaviy sozlama kalitlari: `company.name`, `company.phone`, `company.phone_secondary`,
`company.email`, `company.address`, `company.work_hours`, `company.telegram`, `company.instagram`,
`about.text`.

Mahsulot obyekti:

```json
{
  "id": 1, "slug": "b25", "name": "Beton B25", "grade_class": "B25",
  "description": "...", "specs": [{ "label": "Harakatchanlik", "value": "P3" }],
  "is_available": true, "is_demo": true,
  "price": { "price_per_m3": 0, "currency": "UZS" }
}
```

`price` — `null` bo'lsa, saytda "Narx belgilanmagan" ko'rsatiladi.

## Hisob-kitob qoidasi

```
Beton qiymati = Beton hajmi (m³) × 1 m³ narxi
```

Yetkazib berish narxi belgilanmagan bo'lsa, u **0 deb hisoblanmaydi** — "Menejer tasdiqlaydi"
holatida qoladi va umumiy summa menejer tasdiqlagandan keyin aniqlanadi. Saytdagi hisob taxminiy;
yakuniy summani backend buyurtma yaratilganda qayta hisoblaydi.
