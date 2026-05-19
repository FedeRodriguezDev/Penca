# ⚽ Penca Mundial 2026

Plataforma de pronósticos para el Mundial de Fútbol FIFA 2026 (USA · Canadá · México).

## 🚀 Cómo instalar y correr localmente

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar el servidor
npm start

# Abrí http://localhost:3000 en el navegador
```

> ℹ️ El primer usuario en registrarse será automáticamente **administrador**.

---

## 🌐 Cómo subir online (gratis)

### Opción A: Railway (recomendado, más fácil)

1. Creá una cuenta en [railway.app](https://railway.app)
2. Subí el proyecto a GitHub (o GitHub Desktop)
3. En Railway: **New Project → Deploy from GitHub repo**
4. Seleccioná tu repositorio
5. Railway detecta automáticamente Node.js y lo despliega
6. Configurá la variable de entorno: `JWT_SECRET=tu_clave_secreta_aqui`
7. ¡Listo! Railway te da una URL pública

> ⚠️ **Importante para Railway:** Agregá un volumen persistente en `/app/data` para que la base de datos no se pierda al reiniciar.

### Opción B: Render

1. Creá cuenta en [render.com](https://render.com)
2. **New Web Service → Connect GitHub repo**
3. Build command: `npm install`
4. Start command: `npm start`
5. Agregá variable de entorno: `JWT_SECRET=tu_clave_secreta_aqui`
6. En el plan gratuito, el servicio se "duerme" después de inactividad

### Opción C: VPS propio

```bash
# En tu servidor (Ubuntu/Debian)
git clone tu-repo
cd penca-mundial-2026
npm install
npm install -g pm2
pm2 start server.js --name penca
pm2 save
```

### Opción D: AWS Elastic Beanstalk + GitHub Actions

Este repo ya incluye el workflow [deploy-aws-eb.yml](.github/workflows/deploy-aws-eb.yml), que despliega automáticamente en cada push a `main` y también permite ejecución manual desde la pestaña **Actions**.

1. Crear en AWS un entorno de **Elastic Beanstalk** para Node.js (app + environment)
2. Crear/usar un bucket S3 para versiones de Elastic Beanstalk
3. Configurar OIDC entre GitHub Actions e IAM (sin access keys estáticas)
4. En GitHub, ir a **Settings → Secrets and variables → Actions** y cargar estos secrets:
    - `AWS_REGION` (ejemplo: `us-east-1`)
    - `AWS_EB_APPLICATION` (nombre de la app en Elastic Beanstalk)
    - `AWS_EB_ENVIRONMENT` (nombre del environment)
    - `AWS_EB_S3_BUCKET` (bucket usado por Elastic Beanstalk)
5. En Elastic Beanstalk, configurar las variables de entorno de la app (mínimo `JWT_SECRET`)
6. Hacer push a `main` para disparar el deploy

> Recomendación: usar OIDC (rol asumido por GitHub) evita manejar secretos de largo plazo y es más seguro para CI/CD.

---

## 📊 Sistema de puntos

| Resultado | Puntos |
|-----------|--------|
| Marcador exacto (ej: 2-1 y acertás 2-1) | **3 puntos** |
| Resultado correcto (acertás quien gana o empate) | **1 punto** |
| Incorrecto | 0 puntos |

---

## ⚙️ Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | 3000 |
| `JWT_SECRET` | Clave secreta para tokens | *(cámbiala en producción)* |
| `THESPORTSDB_API_KEY` | API key de TheSportsDB | `123` |
| `THESPORTSDB_API_BASE` | Base URL de TheSportsDB | `https://www.thesportsdb.com/api/v1/json` |
| `THESPORTSDB_WORLD_CUP_LEAGUE_ID` | Liga del Mundial en TheSportsDB | `4429` |
| `THESPORTSDB_WORLD_CUP_SEASON` | Temporada a sincronizar | `2026` |
| `THESPORTSDB_LOG_LEVEL` | Nivel de logs de TheSportsDB (`basic`, `debug`, `silent`) | `basic` |

---

## 📋 Funcionalidades

- ✅ Registro e inicio de sesión con contraseña
- ✅ 72 partidos de fase de grupos pre-cargados
- ✅ Pronóstico de marcador exacto por partido
- ✅ Cierre automático de pronósticos al inicio del partido cuando el encuentro tiene fecha y hora cargadas
- ✅ Cálculo automático de puntos al cargar resultados
- ✅ Tabla de posiciones en tiempo real
- ✅ Panel de administrador para cargar resultados
- ✅ Agregar partidos de eliminatorias desde el panel
- ✅ Gestión de usuarios (promover/quitar admin)
- ✅ Sincronización automática diaria con TheSportsDB para completar fechas, horas, resultados y agregar nuevos partidos del Mundial

> ℹ️ Para bloquear pronósticos exactamente al inicio, cada partido debe tener también `hora de inicio`. Los partidos viejos que sólo tengan fecha seguirán dependiendo del estado manual hasta que se les cargue la hora.

---

## ⏱️ API gratuita recomendada para horarios en tiempo real

### Opción recomendada: TheSportsDB

- Tiene plan gratuito de acceso público.
- Devuelve fecha y hora del evento en la respuesta, por ejemplo `dateEvent`, `strTime`, `dateEventLocal`, `strTimeLocal`, `strTimestamp` y `strStatus`.
- Ejemplo real consultado: `https://www.thesportsdb.com/api/v1/json/123/lookupevent.php?id=2052711`
- Conviene guardar `dateEvent` + `strTime` o directamente `strTimestamp` y usar eso para cerrar la penca.

### Alternativa: football-data.org

- También tiene tier gratuito y una API más estructurada para competiciones.
- La documentación expone endpoints como `/v4/competitions/{id}/matches` y `/v4/matches`, con filtros por fecha y estado.
- Es una buena opción si más adelante querés sincronizar fixtures completos por torneo en vez de partido por partido.

### Recomendación práctica para este proyecto

- Si querés algo simple y gratis para empezar, usaría TheSportsDB.
- Guardaría en la base el horario oficial del partido y actualizaría `match_date` + `match_time` desde un proceso admin o un script de sincronización.
- Si la API entrega hora en UTC, conviene persistirla normalizada para que el bloqueo no dependa de la zona horaria del servidor.

### Hallazgo útil para el Mundial 2026

- `eventsseason.php?id=4429&s=2026` no estaba devolviendo todo el fixture.
- `eventsround.php?id=4429&r=1&s=2026`, `r=2` y `r=3` sí devuelven los 72 partidos de fase de grupos.
- La sync usa ahora el endpoint por ronda para cubrir el fixture más completo disponible.

---

## 🔄 Sincronización automática con TheSportsDB

- Al levantar el servidor se dispara una verificación de sync.
- Si pasaron 24 horas desde la última sincronización exitosa, se consulta TheSportsDB y se actualiza la base.
- La sync usa el fixture oficial del Mundial 2026 (`idLeague=4429`, `season=2026`).
- Los partidos existentes se alinean por `match_number` en la primera corrida y luego por `external_event_id`, para no duplicar fixtures ya sincronizados.
- Si TheSportsDB publica partidos nuevos, se agregan automáticamente.

### Script manual

```bash
npm run sync:worldcup
```

### Ruta manual para admin

- `GET /api/admin/sync/thesportsdb` devuelve el estado de la última sync.
- `POST /api/admin/sync/thesportsdb` fuerza una sincronización inmediata.

---

## 🗃️ Estructura del proyecto

```
penca-mundial-2026/
├── server.js          ← Servidor Express
├── db/
│   └── database.js    ← Base de datos SQLite + partidos iniciales
├── routes/
│   ├── auth.js        ← Login / Registro
│   ├── matches.js     ← Partidos
│   ├── predictions.js ← Pronósticos
│   ├── admin.js       ← Panel admin
│   └── leaderboard.js ← Tabla de posiciones
├── middleware/
│   └── auth.js        ← Autenticación JWT
└── public/
    ├── index.html     ← App web (SPA)
    ├── style.css      ← Estilos
    └── app.js         ← Lógica frontend
```

---

## 🛠️ Tecnologías

- **Backend**: Node.js + Express
- **Base de datos**: SQLite (via better-sqlite3)
- **Autenticación**: JWT + bcrypt
- **Frontend**: HTML/CSS/JS vanilla (SPA)
