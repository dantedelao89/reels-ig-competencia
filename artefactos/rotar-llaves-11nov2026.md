# Rotar las dos llaves caídas — 11 nov 2026

> **No pegues las llaves en este archivo.** Van directo de la web del servicio a Railway.
> Una llave viva guardada en un `.md` acaba en un commit, en una captura o en un backup.

---

## Qué pasó, en una línea

Dos servicios distintos empezaron a rechazar sus llaves el mismo día, con el mismo tipo de error:

| servicio | variable en Railway | error exacto |
|---|---|---|
| Apify | `APIFY_TOKEN` | `User was not found or authentication token is not valid` |
| OpenRouter | `OPENROUTER_API_KEY` | `401 {"error":{"message":"User not found.","code":401}}` |

**Descartado:** el valor de `APIFY_TOKEN` en Railway tiene el formato correcto (`apify_api_` + 36
caracteres = 46, sin espacios ni saltos de línea). No está mal copiado — Apify está rechazando un
token bien formado, así que lo borraron o revocaron del lado de Apify.

**Dato útil:** a las **19:45** un scrape de Instagram todavía funcionó; a las **20:30** ya no. La
ventana es de menos de una hora.

---

## ⚠️ Antes de crear llaves nuevas: mira si fuiste tú

Dos servicios sin relación entre sí, el mismo día, diciendo los dos «usuario no encontrado». Eso no
suele ser coincidencia. Antes de solo generar llaves nuevas:

- [ ] ¿Rotaste tú estas llaves hoy o ayer? (Era lo pendiente del incidente de Railway del 21 oct.)
- [ ] Si **no** fuiste tú → revisa los accesos de ambas cuentas antes de nada:
  - Apify: Settings → **Sessions / Security**, cierra sesiones que no reconozcas.
  - OpenRouter: revisa **Activity**, por si hay consumo que no es tuyo.
- [ ] En las dos, mira si hay llaves listadas que no recuerdes haber creado.

Si alguien entró, generar una llave nueva sin cerrar su acceso solo te da unas horas de tregua.

---

## 1. Apify (`APIFY_TOKEN`)

1. Entra a **https://console.apify.com/settings/integrations**
2. Mira la lista de **Personal API tokens**:
   - Si el token que usabas **ya no está** → lo borraron. Crea uno nuevo.
   - Si **sigue ahí** → el problema es la cuenta, no el token. Mira Billing: una cuenta suspendida
     por pago fallido también rechaza llaves. En ese caso, arregla el pago primero.
3. **Create new token** → nombre: `disecta-railway` → cópialo.
4. Railway → proyecto **invigorating-elegance** → servicio **`reels-ig-competencia`** → pestaña
   **Variables** → `APIFY_TOKEN` → pega → **Deploy**.

> El servicio se reinicia solo al guardar la variable. No hace falta nada más.

---

## 2. OpenRouter (`OPENROUTER_API_KEY`)

1. Entra a **https://openrouter.ai/keys**
2. Mismo chequeo: ¿sigue existiendo la llave que usabas?
3. **Create Key** → nombre: `disecta-railway` → cópiala.
4. Railway → mismo servicio **`reels-ig-competencia`** → **Variables** → `OPENROUTER_API_KEY` →
   pega → **Deploy**.

---

## 3. Mientras tanto, qué está caído

| | estado |
|---|---|
| Scrapes de Instagram, TikTok y X | 🔴 caídos (Apify) |
| Radar de Reddit y de X (los crons de pago) | 🔴 caídos (Apify) |
| Transcripciones | 🔴 caídas (OpenRouter) |
| Radar libre de YouTube | 🟢 funciona — no usa Apify |
| Centinela, panel, descarga de TikTok | 🟢 funcionan |

La descarga de TikTok sigue viva porque va por **RapidAPI**, no por Apify.

---

## 4. Avísame y verifico esto de un tirón

En cuanto las dos estén puestas, dime y compruebo contra producción:

- [ ] Vuelven los scrapes de Instagram, TikTok y X
- [ ] La transcripción bajo demanda deja de dar 401
- [ ] **Post de Facebook desde el feed** — desplegado el 11 nov, sin verificar todavía porque
      necesita una corrida de Apify
- [ ] **El enlace «🔎 Verlo en DISECTA»** en los mensajes de Slack — mismo caso
- [ ] El radar de Reddit vuelve a correr a las 7:30

---

## 5. Y ya que estás: las otras dos del incidente del 21 oct

Siguen pendientes desde hace tres semanas, y encajan con lo de hoy:

- [ ] `SUPABASE_SERVICE_KEY`
- [ ] `R2_SECRET_ACCESS_KEY`
