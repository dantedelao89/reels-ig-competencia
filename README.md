# Reels IG Competencia

Automatización que scrapea los últimos reels de tu competencia en Instagram (vía el actor
`apify/instagram-reel-scraper`) y los guarda **de forma incremental y sin duplicados** en la base
de Airtable **Benchmarking Dante**.

## Cómo funciona

1. Lees la tabla **Creadores** de Airtable (solo los marcados como `Activo`).
2. Por cada creador se dispara el actor de Apify trayendo **solo reels más nuevos** que su
   `Última corrida` (`onlyPostsNewerThan`). Si nunca se corrió, usa `FIRST_RUN_LOOKBACK`.
3. Se descartan los `ShortCode` que ya existen en la tabla **Reels** (dedupe de seguridad).
4. Se insertan **solo los nuevos** y se actualiza `Última corrida`. Nunca se sobreescribe nada.

Disparo de **dos** formas:
- **Cron diario** (servicio Cron de Railway) → ejecuta `npm run scrape`.
- **Manual** → `POST /scrape` con el header `x-trigger-secret`.

## Variables de entorno

Ver `.env.example`. En Railway se configuran en *Variables*.

| Variable | Descripción |
|---|---|
| `APIFY_TOKEN` | Token de API de tu cuenta Apify |
| `AIRTABLE_TOKEN` | Personal Access Token de Airtable (scopes: `data.records:read/write`, `schema.bases:read`) |
| `AIRTABLE_BASE_ID` | `appkRJOlid6jE4t6A` (Benchmarking Dante) |
| `TRIGGER_SECRET` | Secreto para proteger el webhook manual |
| `DEFAULT_RESULTS_LIMIT` | Reels por creador si la columna está vacía (default 30) |
| `FIRST_RUN_LOOKBACK` | Ventana inicial para creadores nuevos (default `3 months`) |

## Desarrollo local

```bash
npm install
cp .env.example .env   # rellena tus credenciales
npm run scrape          # corre una vez (igual que el cron)
npm start               # levanta el servidor web (webhook manual)
```

## Deploy en Railway

1. Sube este repo a GitHub y conéctalo en Railway (*New Project → Deploy from GitHub*).
2. Carga las variables de entorno.
3. **Servicio web** (webhook manual): start command `npm start`.
4. **Cron diario**: añade un *Cron Schedule* (ej. `0 13 * * *` = 8am CDMX) con start command
   `npm run scrape`.

### Disparo manual

```bash
curl -X POST https://TU-APP.up.railway.app/scrape \
  -H "x-trigger-secret: TU_SECRETO"
```

## Tablas en Airtable

- **Creadores**: `Username`, `Activo`, `Reels por corrida`, `Última corrida`, `Notas`.
- **Reels**: `ShortCode` (clave única), `Creador`, `URL`, `Caption`, `Fecha publicación`,
  `Likes`, `Comentarios`, `Views`, `Duración (seg)`, `Hashtags`, `Mentions`, `Tipo`,
  `Música`, `Thumbnail`, `Video URL`, `Scrapeado en`.
