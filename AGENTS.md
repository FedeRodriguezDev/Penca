# Penca – Agent Instructions

Pronosticador del Mundial FIFA 2026. Node.js 20 + Express + PostgreSQL 16 + SPA Vanilla JS.

## Desarrollo local

```bash
docker compose up --build -d   # app en :3000, PostgreSQL en :5432
docker compose down             # detener
```

Hot-reload activado via `node --watch server.js` — cualquier cambio reinicia automáticamente.

```bash
npm run sync:worldcup           # forzar sync manual con TheSportsDB
```

> **No hay suite de tests.** Validar cambios con `docker compose up` y pruebas manuales en el browser.

## Arquitectura

| Capa | Path | Notas |
|------|------|-------|
| Entry point | `server.js` | Express; rutas API bajo `/api/*`; SPA catch-all sirve `public/index.html` |
| Frontend | `public/` | SPA Vanilla JS — sin bundler, sin framework |
| Rutas API | `routes/` | `auth`, `matches`, `predictions`, `leaderboard`, `admin` |
| Auth middleware | `middleware/auth.js` | JWT — `authMiddleware`, `adminMiddleware` |
| Base de datos | `db/database.js` | PostgreSQL vía `pg`; wrapper con interfaz estilo SQLite |
| Email | `services/emailNotifications.js`, `services/emailTemplates.js` | Nodemailer SMTP |
| Sync partidos | `services/theSportsDbSync.js` | TheSportsDB liga 4429, temporada 2026 |

## Convenciones críticas

### Queries a la base de datos

`db.prepare()` retorna un wrapper con `.run()`, `.get()`, `.all()`. Usar **parámetros posicionales PostgreSQL** (`$1`, `$2`, …), **NO** el `?` de SQLite:

```js
// ✅ Correcto
db.prepare('SELECT * FROM users WHERE id = $1').get(userId);
db.prepare('INSERT INTO users (name, email) VALUES ($1, $2)').run(name, email);

// ❌ Incorrecto (SQLite style)
db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
```

### Prevención de XSS en el frontend

Siempre usar `escapeHtml(str)` (definida en `public/app.js`) antes de insertar cualquier dato del servidor en `innerHTML`. Nunca concatenar strings sin escapar en plantillas HTML.

```js
// ✅ Correcto
container.innerHTML = `<div>${escapeHtml(user.username)}</div>`;

// ❌ Incorrecto — XSS
container.innerHTML = `<div>${user.username}</div>`;
```

Para eventos en elementos generados dinámicamente, usar atributos `data-*` + `addEventListener` en lugar de `onclick="fn('${dato}')"`.

### Namespace de rutas API

Toda ruta backend debe estar bajo `/api/`. El catch-all de Express (`app.get('*', ...)`) sirve `index.html` para todo lo demás (SPA).

### JWT_SECRET

Debe configurarse como variable de entorno en producción. `middleware/auth.js` llama `process.exit(1)` al arrancar si `NODE_ENV=production` y el secret no está definido.

### SSL de base de datos

Se habilita automáticamente para cualquier `DB_HOST` que no sea `localhost` / `127.0.0.1`. En Docker Compose ya está `DB_SSL=false`.

### Rate limiting

Las rutas `/api/auth/*` tienen límite de 20 req / 15 min por IP via un mapa en memoria en `server.js`.

## Deploy

**Pipeline**: push a `main` → GitHub Actions → AWS Elastic Beanstalk (`PencaAncap2026-https`, `sa-east-1`) con autenticación OIDC.

**Infraestructura**: **Classic Load Balancer** (no ALB). Usar CLI `aws elb`, **no** `aws elbv2`. El redirect HTTP→HTTPS se hace a nivel de app (header `X-Forwarded-Proto`).

**GitHub Secrets**: `SMTP_PASS`, `JWT_SECRET`, `AWS_REGION`, `AWS_EB_APPLICATION`, `AWS_EB_ENVIRONMENT`, `AWS_EB_S3_BUCKET`.  
**GitHub Variables**: `APP_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `EMAIL_FROM`, `EMAIL_REPLY_TO`.

**Si EB muestra Red tras deploy**: verificar primero que las variables `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` están configuradas. Variables faltantes → Nginx 502. Para rotación de contraseñas de BD: usar solo caracteres alfanuméricos, `-`, `_` para evitar problemas de quoting en la CLI de EB.

## Sistema de puntos

| Resultado | Puntos |
|-----------|--------|
| Marcador exacto | 3 |
| Resultado correcto (ganador o empate) | 1 |
| Incorrecto | 0 |

Implementado en `db/database.js` → `calculatePoints()`.
