const BRAND = {
  name: 'Infoclub Soluciones',
  appName: 'Penca Infoclub',
  siteUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  logoUrl: process.env.EMAIL_LOGO_URL || `${process.env.APP_BASE_URL || 'http://localhost:3000'}/img/logo_infoclub.png`,
  colors: {
    primary: '#0057A6',
    primaryDark: '#003D7A',
    accent: '#E53935',
    background: '#0D1E33',
    card: '#132D52',
    text: '#E8F0FF',
    muted: '#C8DAF0',
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMatchLabel(match) {
  return `${match.home_team} vs ${match.away_team}`;
}

function formatUtcDateTime(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Fecha a confirmar';
  return new Intl.DateTimeFormat('es-UY', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Montevideo',
  }).format(date);
}

function getLogoBlock() {
  if (BRAND.logoUrl) {
    return `<img src="${escapeHtml(BRAND.logoUrl)}" alt="Logo ${escapeHtml(BRAND.name)}" width="180" style="display:block;max-width:180px;width:100%;height:auto;border:0;">`;
  }

  return `<div style="border:1px dashed ${BRAND.colors.muted};border-radius:10px;padding:10px 14px;color:${BRAND.colors.muted};font-size:12px;text-align:center;">Espacio para logo de ${escapeHtml(BRAND.name)}</div>`;
}

function renderLayout({ preheader, title, intro, bodyHtml, ctaLabel, ctaUrl, footerReason, headerBackground, unsubscribeUrl }) {
  const safePreheader = escapeHtml(preheader);
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeFooterReason = escapeHtml(footerReason);
  const resolvedHeaderBackground = headerBackground || `linear-gradient(180deg, ${BRAND.colors.primary} 0%, ${BRAND.colors.primaryDark} 100%)`;

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="x-ua-compatible" content="ie=edge">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.colors.background};font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.colors.background};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;background:${BRAND.colors.card};border:1px solid #1E3A60;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:24px 24px 12px 24px;background:${resolvedHeaderBackground};">
                ${getLogoBlock()}
                <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${BRAND.colors.muted};margin-top:12px;">${escapeHtml(BRAND.appName)}</div>
                <h1 style="margin:8px 0 0 0;color:#ffffff;font-size:24px;line-height:1.3;">${safeTitle}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 4px 24px;color:${BRAND.colors.text};font-size:16px;line-height:1.6;">
                ${safeIntro}
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 20px 24px;color:${BRAND.colors.text};font-size:15px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            ${ctaLabel && ctaUrl ? `
            <tr>
              <td style="padding:0 24px 24px 24px;">
                <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${BRAND.colors.accent};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 18px;border-radius:10px;">${escapeHtml(ctaLabel)}</a>
              </td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding:16px 24px 24px 24px;border-top:1px solid #1E3A60;color:${BRAND.colors.muted};font-size:12px;line-height:1.5;">
                Recibiste este correo porque ${safeFooterReason}.<br>
                Si tenes dudas, respondé este email y te ayudamos.${unsubscribeUrl ? `<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:${BRAND.colors.muted};">Darme de baja de estas notificaciones</a>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildVerificationEmail({ username, verifyUrl }) {
  const subject = 'Verificá tu email en Penca Infoclub';
  const preheader = 'Confirmá tu cuenta para activar tus pronósticos.';
  const title = 'Confirmá tu cuenta';
  const intro = `Hola ${username}, ya casi está todo listo.`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Para proteger tu cuenta y habilitar el acceso, verificá tu email con el botón de abajo.</p>
    <p style="margin:0 0 12px 0;">Este enlace expira en 24 horas por seguridad.</p>
    <p style="margin:0;word-break:break-word;font-size:13px;color:${BRAND.colors.muted};">Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br><a href="${escapeHtml(verifyUrl)}" style="color:${BRAND.colors.muted};">${escapeHtml(verifyUrl)}</a></p>
  `;

  const html = renderLayout({
    preheader,
    title,
    intro,
    bodyHtml,
    ctaLabel: 'Verificar email',
    ctaUrl: verifyUrl,
    footerReason: 'te registraste en Penca Infoclub',
    headerBackground: BRAND.colors.primaryDark,
  });

  const text = [
    `Hola ${username},`,
    '',
    'Para activar tu cuenta, verificá tu email en este enlace:',
    verifyUrl,
    '',
    'Este enlace expira en 24 horas.',
    '',
    'Penca Infoclub - Infoclub Soluciones',
  ].join('\n');

  return { subject, preheader, html, text };
}

function buildPasswordResetEmail({ username, resetUrl }) {
  const subject = 'Recuperar contraseña en Penca Infoclub';
  const preheader = 'Solicitaste cambiar tu contraseña.';
  const title = 'Restablecer contraseña';
  const intro = `Hola ${username}, recibimos una solicitud para cambiar tu contraseña.`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Si fuiste vos, hacé clic en el botón para definir una nueva contraseña.</p>
    <p style="margin:0 0 12px 0;">Este enlace expira en 2 horas por seguridad.</p>
    <p style="margin:0 0 12px 0;">Si no solicitaste este cambio, podés ignorar este correo.</p>
    <p style="margin:0;word-break:break-word;font-size:13px;color:${BRAND.colors.muted};">Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br><a href="${escapeHtml(resetUrl)}" style="color:${BRAND.colors.muted};">${escapeHtml(resetUrl)}</a></p>
  `;

  const html = renderLayout({
    preheader,
    title,
    intro,
    bodyHtml,
    ctaLabel: 'Cambiar contraseña',
    ctaUrl: resetUrl,
    footerReason: 'solicitaste recuperar tu contraseña en Penca Infoclub',
  });

  const text = [
    `Hola ${username},`,
    '',
    'Recibimos una solicitud para cambiar tu contraseña.',
    'Usá este enlace para restablecerla:',
    resetUrl,
    '',
    'Este enlace expira en 2 horas.',
    'Si no solicitaste el cambio, ignorá este mensaje.',
    '',
    'Penca Infoclub - Infoclub Soluciones',
  ].join('\n');

  return { subject, preheader, html, text };
}

function buildReminderEmail({ username, match, leadMinutes, appUrl, unsubscribeUrl }) {
  const subject = `Recordatorio: ${match.home_team} vs ${match.away_team}`;
  const preheader = 'Tu pronóstico todavía no está cargado.';
  const title = 'Te queda poco para pronosticar';
  const intro = `Hola ${username}, este partido empieza en aproximadamente ${leadMinutes} minutos y todavía no registraste tu pronóstico.`;

  const kickoffText = formatUtcDateTime(match.kickoff_at);
  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0A1F3A;border:1px solid #1E3A60;border-radius:10px;margin:0 0 12px 0;">
      <tr>
        <td style="padding:14px 16px;color:${BRAND.colors.text};font-size:15px;line-height:1.5;">
          <strong style="display:block;color:#ffffff;">${escapeHtml(formatMatchLabel(match))}</strong>
          <span style="display:block;color:${BRAND.colors.muted};margin-top:4px;">${escapeHtml(kickoffText)}</span>
        </td>
      </tr>
    </table>
    <p style="margin:0;">Cargá tu marcador antes del inicio para participar por puntos.</p>
  `;

  const html = renderLayout({
    preheader,
    title,
    intro,
    bodyHtml,
    ctaLabel: 'Cargar pronóstico',
    ctaUrl: appUrl,
    footerReason: 'activaste recordatorios de partidos en Penca Infoclub',
    unsubscribeUrl,
  });

  const text = [
    `Hola ${username},`,
    '',
    `Recordatorio: ${formatMatchLabel(match)} empieza pronto y todavía no tenes pronóstico cargado.`,
    `Inicio estimado: ${kickoffText}`,
    '',
    'Cargá tu pronóstico acá:',
    appUrl,
    '',
    ...(unsubscribeUrl ? ['Para darte de baja de estas notificaciones:', unsubscribeUrl, ''] : []),
    'Penca Infoclub - Infoclub Soluciones',
  ].join('\n');

  return { subject, preheader, html, text };
}

function buildResultEmail({ username, prediction, unsubscribeUrl }) {
  const matchLabel = `${prediction.home_team} ${prediction.real_home} - ${prediction.real_away} ${prediction.away_team}`;
  const subject = `Resultado de tu pronóstico: ${prediction.home_team} vs ${prediction.away_team}`;
  const preheader = `Terminó ${prediction.home_team} vs ${prediction.away_team}.`;
  const title = 'Ya se calculó tu puntaje';
  const intro = `Hola ${username}, ya tenemos el resultado de uno de tus pronósticos.`;

  const pointsMessage = prediction.points === 3
    ? 'Excelente: acertaste marcador exacto (+3).'
    : prediction.points === 1
      ? 'Bien: acertaste el resultado (+1).'
      : 'Esta vez no sumaste puntos (+0).';

  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0A1F3A;border:1px solid #1E3A60;border-radius:10px;margin:0 0 12px 0;">
      <tr>
        <td style="padding:14px 16px;color:${BRAND.colors.text};font-size:15px;line-height:1.5;">
          <strong style="display:block;color:#ffffff;">${escapeHtml(matchLabel)}</strong>
          <span style="display:block;color:${BRAND.colors.muted};margin-top:4px;">Tu pronóstico: ${escapeHtml(`${prediction.pred_home} - ${prediction.pred_away}`)}</span>
          <span style="display:block;color:#ffffff;margin-top:8px;font-weight:700;">Puntos: ${escapeHtml(String(prediction.points ?? 0))}</span>
        </td>
      </tr>
    </table>
    <p style="margin:0;">${escapeHtml(pointsMessage)}</p>
  `;

  const html = renderLayout({
    preheader,
    title,
    intro,
    bodyHtml,
    ctaLabel: 'Ver tabla de posiciones',
    ctaUrl: BRAND.siteUrl,
    footerReason: 'tenes activadas notificaciones de resultados en Penca Infoclub',
    unsubscribeUrl,
  });

  const text = [
    `Hola ${username},`,
    '',
    `Resultado final: ${matchLabel}`,
    `Tu pronóstico: ${prediction.pred_home} - ${prediction.pred_away}`,
    `Puntos obtenidos: ${prediction.points ?? 0}`,
    pointsMessage,
    '',
    `Ver tabla: ${BRAND.siteUrl}`,
    '',
    ...(unsubscribeUrl ? ['Para darte de baja de estas notificaciones:', unsubscribeUrl, ''] : []),
    'Penca Infoclub - Infoclub Soluciones',
  ].join('\n');

  return { subject, preheader, html, text };
}

function buildPhaseReadyEmail({ username, stage, matchCount, appUrl, unsubscribeUrl }) {
  const subject = `¡Nuevos partidos disponibles: ${stage}!`;
  const preheader = `Ya están cargados los ${matchCount} partidos de ${stage}.`;
  const title = `¡${stage} disponible!`;
  const intro = `Hola ${username}, ya están definidos todos los equipos de la ${stage} del Mundial 2026.`;

  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0A1F3A;border:1px solid #1E3A60;border-radius:10px;margin:0 0 12px 0;">
      <tr>
        <td style="padding:14px 16px;color:${BRAND.colors.text};font-size:15px;line-height:1.5;">
          <strong style="display:block;color:#ffffff;font-size:18px;">${escapeHtml(stage)}</strong>
          <span style="display:block;color:${BRAND.colors.muted};margin-top:4px;">${matchCount} partidos cargados — ¡a pronosticar!</span>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 12px 0;">Entrá ahora para cargar tus pronósticos antes de que empiecen los partidos. Acordate que podés sumar 3 puntos por marcador exacto y 1 punto por acertar el resultado.</p>
    <p style="margin:0;">¡No te quedes afuera de esta fase!</p>
  `;

  const html = renderLayout({
    preheader,
    title,
    intro,
    bodyHtml,
    ctaLabel: 'Cargar pronósticos',
    ctaUrl: appUrl,
    footerReason: 'tenes activadas notificaciones de la Penca Infoclub',
    unsubscribeUrl,
  });

  const text = [
    `Hola ${username},`,
    '',
    `¡Ya están disponibles los ${matchCount} partidos de ${stage} del Mundial 2026!`,
    '',
    'Entrá a la Penca para cargar tus pronósticos:',
    appUrl,
    '',
    'Sumás 3 puntos por marcador exacto y 1 punto por acertar el resultado.',
    '¡No te quedes afuera!',
    '',
    ...(unsubscribeUrl ? ['Para darte de baja:', unsubscribeUrl, ''] : []),
    'Penca Infoclub - Infoclub Soluciones',
  ].join('\n');

  return { subject, preheader, html, text };
}

function buildVerificationResultPage({ success, message }) {
  const safeMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${success ? 'Email verificado' : 'No se pudo verificar'}</title>
    <style>
      body { margin:0; padding:0; font-family:Lato,Arial,sans-serif; background:#0D1E33; color:#E8F0FF; }
      .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
      .card { width:100%; max-width:520px; border:1px solid #1E3A60; background:#132D52; border-radius:14px; padding:28px; }
      .title { margin:0 0 12px; color:${success ? '#4a9de0' : '#E53935'}; font-size:28px; }
      .msg { margin:0 0 20px; color:#C8DAF0; line-height:1.5; }
      .link { display:inline-block; background:#E53935; color:#fff; text-decoration:none; padding:12px 16px; border-radius:10px; font-weight:700; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <img src="${escapeHtml(BRAND.logoUrl)}" alt="${escapeHtml(BRAND.name)}" style="display:block;max-width:160px;width:100%;height:auto;margin-bottom:18px;">
        <h1 class="title">${success ? 'Email verificado' : 'Verificación fallida'}</h1>
        <p class="msg">${safeMessage}</p>
        <a class="link" href="${escapeHtml(BRAND.siteUrl)}">Ir a Penca Infoclub</a>
      </div>
    </div>
  </body>
</html>`;
}

function buildUnsubscribeResultPage({ success, message }) {
  const safeMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${success ? 'Baja de notificaciones' : 'No se pudo procesar la solicitud'}</title>
    <style>
      body { margin:0; padding:0; font-family:Lato,Arial,sans-serif; background:#0D1E33; color:#E8F0FF; }
      .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
      .card { width:100%; max-width:520px; border:1px solid #1E3A60; background:#132D52; border-radius:14px; padding:28px; }
      .title { margin:0 0 12px; color:${success ? '#4a9de0' : '#E53935'}; font-size:28px; }
      .msg { margin:0 0 20px; color:#C8DAF0; line-height:1.5; }
      .link { display:inline-block; background:#E53935; color:#fff; text-decoration:none; padding:12px 16px; border-radius:10px; font-weight:700; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <img src="${escapeHtml(BRAND.logoUrl)}" alt="${escapeHtml(BRAND.name)}" style="display:block;max-width:160px;width:100%;height:auto;margin-bottom:18px;">
        <h1 class="title">${success ? 'Baja exitosa' : 'Error al procesar'}</h1>
        <p class="msg">${safeMessage}</p>
        <a class="link" href="${escapeHtml(BRAND.siteUrl)}">Ir a Penca Infoclub</a>
      </div>
    </div>
  </body>
</html>`;
}

module.exports = {
  buildPasswordResetEmail,
  buildPhaseReadyEmail,
  buildReminderEmail,
  buildResultEmail,
  buildUnsubscribeResultPage,
  buildVerificationEmail,
  buildVerificationResultPage,
};
