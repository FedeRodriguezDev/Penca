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

---

## 📋 Funcionalidades

- ✅ Registro e inicio de sesión con contraseña
- ✅ 72 partidos de fase de grupos pre-cargados
- ✅ Pronóstico de marcador exacto por partido
- ✅ Cálculo automático de puntos al cargar resultados
- ✅ Tabla de posiciones en tiempo real
- ✅ Panel de administrador para cargar resultados
- ✅ Agregar partidos de eliminatorias desde el panel
- ✅ Gestión de usuarios (promover/quitar admin)

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
