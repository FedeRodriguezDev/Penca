# ⚽ Penca Mundial 2026

Aplicación web de pronósticos para el Mundial FIFA 2026.

## Estado actual del proyecto

- Backend en Node.js + Express.
- Base de datos PostgreSQL.
- Frontend SPA en HTML, CSS y JavaScript vanilla.
- Autenticación con JWT + bcrypt.
- Verificación obligatoria de email para activar nuevas cuentas.
- Notificaciones por email para:
    - verificación de cuenta,
    - recordatorio antes de partidos sin pronóstico,
    - resultado y puntaje de pronósticos.
- Sincronización de partidos y resultados con TheSportsDB.
- Ejecución local lista con Docker Compose (app + PostgreSQL).

## Ejecución local con Docker Compose

```bash
docker compose up --build -d
```

Aplicación: http://localhost:3000  
PostgreSQL: localhost:5432

Detener servicios:

```bash
docker compose down
```

## Ejecución local sin Docker

1. Tener PostgreSQL disponible.
2. Configurar variables de entorno de base de datos y app.
3. Instalar dependencias e iniciar servidor.

```bash
npm install
npm start
```

## Variables de entorno

### App

| Variable | Descripción | Valor por defecto |
|---|---|---|
| PORT | Puerto HTTP | 3000 |
| JWT_SECRET | Clave para firmar JWT | mundial2026_secret_cambia_esto_en_produccion |
| APP_BASE_URL | URL pública usada en links de email | http://localhost:3000 |

### Base de datos

| Variable | Descripción | Valor por defecto |
|---|---|---|
| DB_HOST | Host PostgreSQL | localhost |
| DB_PORT | Puerto PostgreSQL | 5432 |
| DB_NAME | Nombre de base | penca_db |
| DB_USER | Usuario | penca_admin |
| DB_PASSWORD | Password | password |
| DB_SSL | SSL para conexión remota | auto según host |

### TheSportsDB

| Variable | Descripción | Valor por defecto |
|---|---|---|
| THESPORTSDB_API_BASE | Base URL API | https://www.thesportsdb.com/api/v1/json |
| THESPORTSDB_API_KEY | API key | 123 |
| THESPORTSDB_WORLD_CUP_LEAGUE_ID | Liga del Mundial | 4429 |
| THESPORTSDB_WORLD_CUP_SEASON | Temporada | 2026 |
| THESPORTSDB_LOG_LEVEL | Nivel de log | basic |

### Email (SMTP)

| Variable | Descripción | Valor por defecto |
|---|---|---|
| SMTP_HOST | Host SMTP | - |
| SMTP_PORT | Puerto SMTP | 587 |
| SMTP_SECURE | TLS implícito | false |
| SMTP_USER | Usuario SMTP | - |
| SMTP_PASS | Password/token SMTP | - |
| EMAIL_FROM | Remitente | SMTP_USER |
| EMAIL_REPLY_TO | Reply-To | EMAIL_FROM |
| EMAIL_LOGO_URL | URL de logo en plantilla | vacío |
| EMAIL_VERIFICATION_TTL_HOURS | Expiración verificación | 24 |
| EMAIL_REMINDER_LEAD_MINUTES | Ventana de recordatorio previa | 120 |
| EMAIL_NOTIFICATION_CHECK_MS | Frecuencia del scheduler | 300000 |

## Funcionalidades

- Registro y login de usuarios.
- Primer usuario registrado con rol administrador.
- Gestión de partidos y carga de resultados desde panel admin.
- Pronósticos por partido con cierre automático al inicio del encuentro.
- Puntaje automático:
    - 3 puntos por marcador exacto,
    - 1 punto por resultado correcto,
    - 0 puntos en caso contrario.
- Tabla de posiciones en tiempo real.
- Sincronización automática y manual con TheSportsDB.

## Flujo de emails

- Registro: se envía email de verificación con token y expiración.
- Login sin verificación: se bloquea acceso y se puede reenviar verificación.
- Recordatorios: se envían cuando falta pronóstico y el partido está próximo.
- Resultados: se envía el puntaje cuando el partido termina y el pronóstico ya fue evaluado.
- Formato de envío:
    - HTML con estilos inline,
    - preheader,
    - versión texto plano,
    - headers por tipo de notificación.

## Sincronización de datos

- Al iniciar el servidor se ejecuta control de sincronización.
- Se actualizan fixtures y resultados con TheSportsDB.
- Comando manual:

```bash
npm run sync:worldcup
```

- Endpoints admin:
    - GET /api/admin/sync/thesportsdb
    - POST /api/admin/sync/thesportsdb

## Estructura principal

```text
server.js
db/database.js
routes/auth.js
routes/matches.js
routes/predictions.js
routes/admin.js
routes/leaderboard.js
services/theSportsDbSync.js
services/emailService.js
services/emailTemplates.js
services/emailNotifications.js
public/index.html
public/style.css
public/app.js
docker-compose.yml
Dockerfile
```
