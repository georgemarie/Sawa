
## ✨ Overview
**SAWA** is a full‑stack web application for hosting and joining online meetings. It leverages the **Agora Web SDK** for real‑time audio/video and integrates **captioning, language detection, translation, and optional dubbing** to make conversations more inclusive. Users can sign up with email (OTP supported), manage profiles & preferences, schedule or start instant meetings, and access a lightweight **dashboard** for activity and basic admin controls.

> This README replaces the legacy version and reflects the current codebase and structure.

---

## 🧩 Key Features
- **Authentication & Security**
  - Email & password login with **OTP** verification during sign‑up
  - **Forgot password** flow via email
  - **Google sign‑in** via `django-allauth` (optional, project‑ready)
  - Customizable **user roles** and **system logs** for auditing

- **Meetings**
  - Create **instant** or **scheduled** meetings
  - Join via unique **meeting ID/link** (generated with `shortuuid`)
  - **Waiting room** experience before the host starts
  - Basic host/participant controls (mute/unmute, camera on/off, leave/end)
  - **Room member** management endpoints to track participants

- **Real‑Time Media**
  - **Agora Web SDK** (`AgoraRTC`) for audio/video
  - Backend **token issuing** endpoint for secure channel access

- **Captioning, Translation & Dubbing (Experimental)**
  - Browser audio capture → server caption generation endpoint
  - **Language detection** for source audio
  - Optional **translation** to a target language
  - **Dubbing** pipeline integrating **ElevenLabs** for TTS
  - Endpoints exposed for client integration:
    - `POST /meetings/translate/audio/`
    - `POST /meetings/generate_caption/`

- **Dashboard & Admin**
  - User dashboard with upcoming/recent meetings
  - **Admin Dashboard** (templates included): user management, meeting oversight, translation usage, platform settings, support & feedback, and **system logs**

- **Support & Notifications**
  - **Support tickets** (open/close) and a simple **notification** model

- **Profiles & Settings**
  - Profile page with avatar upload/remove + password update
  - **Meeting defaults** and accessibility preferences (e.g., auto‑mute mic/video on join, enable captions/translation)

---

## 🏗️ Architecture
- **Backend**: Django 4.x (Python 3.11+), email via SMTP, OTP, `django-allauth` for Google OAuth, optional **Django Channels** ready for WebSockets.
- **Realtime**: **Agora** Web SDK in the browser; backend endpoint for **token** issuance.
- **AI/Audio**: Server‑side endpoints for captioning/translation; **ElevenLabs** for text‑to‑speech dubbing.
- **Data**: Default **SQLite** for local development (file `db.sqlite3`).
- **Frontend**: HTML templates + **Bootstrap** CSS + vanilla JS; custom styles and meeting UI in `static/`.

**Main Apps**
- `accounts/` – auth, OTP, profile, settings
- `meetings/` – meeting CRUD, join/leave flows, Agora integration, captions/translation
- `dashboard/` – user & admin dashboard pages, logs
- `support/` – help & support tickets
- `landing/` – public landing page

**Key Templates**
- `templates/Landing Page/main.html`
- `templates/Login & Sign up/{login,signup}.html`
- `templates/meetings/{room,waiting_room}.html`
- `templates/Profile & Settings/{profile,settings}.html`
- `templates/Admin Dashboard/*.html`

---

## 🗺️ Project Structure (trimmed)
```text
SAWA/
├─ manage.py
├─ SAWA/                  # project settings, urls, asgi/wsgi
├─ accounts/              # custom user, OTP, settings
├─ meetings/              # meetings, Agora token & room-member endpoints
├─ dashboard/             # dashboards, analytics, system logs
├─ support/               # support tickets, notifications
├─ landing/               # landing page
├─ templates/             # HTML templates (Landing, Meetings, Admin, etc.)
└─ static/                # css, js (Agora), images, assets
```

---

## ⚙️ Getting Started

### 1) Prerequisites
- Python **3.11+**
- A virtual environment tool (`venv`, `conda`, etc.)
- **Agora** account (for `APP_ID` and **App Certificate** if you enable token issuance)
- **ElevenLabs** account & API key (for dubbing)
- SMTP credentials (for OTP & password reset emails)
- (Optional) Google OAuth credentials for `django-allauth`

### 2) Install
```bash
# from the repo root
python -m venv .venv
. .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 3) Environment
Create a **.env** file at `SAWA/SAWA/.env` (or the project root) with:
```dotenv
# Django
DEBUG=True
SECRET_KEY=your-django-secret
ALLOWED_HOSTS=127.0.0.1,localhost

# Email (SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_HOST_USER=you@example.com
EMAIL_HOST_PASSWORD=your-app-password
EMAIL_USE_TLS=True

# Agora
AGORA_APP_ID=your-agora-app-id
AGORA_APP_CERTIFICATE=your-agora-app-certificate

# ElevenLabs
ELEVENLABS_API_KEY=your-elevenlabs-api-key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL   # or your preferred voice

# Google OAuth (django-allauth)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

> 🔐 **Security note**: Move any hard‑coded IDs/secrets from JS or Python files into environment variables. Avoid committing secrets (e.g., OAuth client JSON) inside `static/assets`.

### 4) Database & Superuser
```bash
python SAWA/manage.py migrate
python SAWA/manage.py createsuperuser   # optional, for Django admin
```

### 5) Run
```bash
python SAWA/manage.py runserver
```
Visit `http://127.0.0.1:8000/`

> For production or WebSocket workloads, run an ASGI server such as **Daphne** or **Uvicorn** and configure Channels.


---

## 🔌 Important Endpoints (non‑exhaustive)
- **Auth & Profile**
  - `/login/`, `/signup/`, `/logout/`
  - `/verify-otp/`, `/profile/`, `/profile/update-password/`
  - `/settings/`, `/settings/update/`
- **Meetings**
  - `POST /meetings/create/`, `GET /meetings/join/<meeting_id>/`
  - `POST /meetings/leave/<meeting_id>/`, `GET /meetings/waiting-room/<meeting_id>/`
  - `GET /meetings/get_token/` — Agora token
  - `POST /meetings/create_member/`, `GET /meetings/get_member/`, `DELETE /meetings/delete_member/`
  - `GET /meetings/check_status/<meeting_id>/`
- **Captioning & Dubbing**
  - `POST /meetings/translate/audio/`
  - `POST /meetings/generate_caption/`
- **Dashboard & Admin**
  - `/dashboard/` (user)
  - `/dashboard/admin-dashboard/` (admin views & tools)
- **Support**
  - `/support/help/`

---

## 🧪 Tech Stack
**Backend**
- Django 4.x, Django Auth, `django-allauth` (Google)
- OTP via email (SMTP)
- (Ready for) Django Channels (WebSockets)
- SQLite (dev) — switch to Postgres/MySQL in production

**Frontend**
- HTML templates + **Bootstrap** + vanilla JS
- Meeting UI powered by `static/js/streams.js` and **AgoraRTC**

**AI / Audio**
- **ElevenLabs** for TTS dubbing
- Language detection (`langdetect`), audio utils (`pydub`)
- (Optional) integration hooks for external STT/translation services

---

## ✅ Status & To‑Do
- [x] OTP sign‑up + Forgot Password
- [x] Instant & scheduled meetings with unique IDs
- [x] Waiting room, host/participant roles
- [x] Agora integration & token endpoint
- [x] Captioning & translation endpoints
- [x] Admin dashboard templates & system logs
- [ ] Harden production settings (ASGI, Channels, HTTPS, media/static)
- [ ] CI/CD & containerization
- [ ] Comprehensive unit/integration tests
- [ ] Full documentation for admin workflows

---

## 📦 Deployment Notes
- Use **ASGI** (e.g., Daphne/Uvicorn + Nginx) for real‑time features
- Set all secrets via environment variables
- Configure a production database and email provider
- Restrict static/media exposure; remove confidential files from `static/assets`

---

## 🙏 Acknowledgements
- **Agora** for low‑latency RTC
- **ElevenLabs** for cutting‑edge TTS
- **Django** community & packages used in this project

---

## 📄 License
No open‑source license specified. All rights reserved by the project authors.