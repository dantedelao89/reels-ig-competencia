# Montar la sesión de Instagram en el scraper — 11 nov 2026

> **No pegues la cookie en este archivo.** Va de tu navegador a Railway, y de ningún otro lado.
> Una `sessionid` viva guardada en un `.md` acaba en un commit, en una captura o en un backup.

---

## Lo primero, y es lo único importante de esta página

**Usa una cuenta DESECHABLE, no la tuya.**

Lo único que necesita un reel limitado por edad es una cuenta **mayor de edad**. No necesita ser
tuya, ni tener seguidores, ni seguir a nadie. Y la cuenta que montes aquí corre un riesgo real:

- La `sessionid` **es la cuenta entera**. Quien la tenga puede publicar, borrar, mandar mensajes y
  leer el buzón de esa cuenta. No es una llave de solo lectura.
- Se va a usar desde una IP de centro de datos (Railway), que es justo el patrón que Instagram
  marca. Tarde o temprano esa cuenta puede acabar con verificación obligatoria o cerrada.

Con una cuenta desechable, el día que la tumben se pone otra y no se perdió nada. Con tu cuenta
real, pierdes tu cuenta real.

**Créala así:** una cuenta nueva, con un correo que no sea el tuyo principal, fecha de nacimiento
que la haga mayor de edad, y no la uses para nada más. No hace falta foto ni nombre.

---

## 1. Sacar la `sessionid`

En **Chrome**, con esa cuenta ya iniciada en `instagram.com`:

1. `F12` (o clic derecho → Inspeccionar) para abrir las herramientas.
2. Pestaña **Application** (en español, **Aplicación**).
3. Panel izquierdo → **Storage** → **Cookies** → `https://www.instagram.com`.
4. Busca la fila **`sessionid`** y copia el valor de la columna **Value**.

Es una cadena larga, con un `%3A` por ahí en medio. Cópiala **completa y tal cual**: no le quites
nada, no la recortes y no le pongas comillas.

---

## 2. Pegarla en Railway

1. Railway → proyecto **invigorating-elegance** → servicio **`reels-ig-competencia`**.
2. Pestaña **Variables** → **New Variable**.
3. Nombre: `IG_SESSIONID` · Valor: lo que copiaste.
4. **Deploy.**

> ⚠️ Railway deja los cambios de variable **en espera**: el contenedor sigue con el valor viejo
> hasta que se redespliega. Es lo que nos pasó hoy con las otras dos llaves y parecía que estaban
> mal puestas. Si al terminar el panel sigue diciendo «Sin montar», redespliega el servicio.

**No la pongas en el servicio `dashboard`.** El panel no la necesita y no la usa.

---

## 3. Comprobarlo (lo hace el panel, no hace falta que me preguntes)

En DISECTA, barra lateral, debajo de «Apify conectado», hay un bloque nuevo: **Sesión de
Instagram**. El botón `↻` pregunta a Instagram de verdad y te dice una de estas:

| Lo que dice | Qué significa |
|---|---|
| 🟢 **Sesión viva** · `cuenta @xxx` | Listo. Verifica que `@xxx` es la desechable, no la tuya. |
| ⚪ **Sin montar** | La variable no llegó. Revisa el servicio y redespliega. |
| 🔴 **Sesión caducada** | Saca una cookie nueva y repite el paso 2. |
| 🔴 **Instagram marcó la cuenta** | Pasa la verificación desde el teléfono, o crea otra desechable. |
| 🟠 **Frenó por ritmo** | No es error nuestro. Espera unos minutos. |

---

## 4. Qué cambia cuando esté montada

Nada de lo que ya funcionaba. El actor de Apify sigue siendo el que atiende **todos** los links,
como hasta hoy. La sesión entra **solo** cuando el actor falla con «limitado por edad», y entonces
pide ese reel a Instagram con la cuenta.

Ese orden es a propósito: cada petición con sesión es una huella de esa cuenta, y gastarla en los
links que ya se resuelven gratis la quemaría por nada.

Los dos reels con los que se detectó esto, para probar en cuanto la pegues:

- `https://www.instagram.com/reel/DcbaKviRYAT/`
- `https://www.instagram.com/reel/DGELlRbySGR/`

El segundo puede fallar igual por otra razón: la API que usamos para bajar videos ya no lo
encuentra (404), así que podría estar borrado además de limitado por edad. El primero sí debería
entrar.

---

## 5. Por qué la cookie no se le pasa a RapidAPI, que sería menos código

La API de RapidAPI que ya pagamos tiene un campo `cookie` justo para esto, y su propio mensaje de
error lo pide. Habría sido una línea.

No se hizo. Mandarle tu `sessionid` a una API de terceros es darle la cuenta entera a una empresa
que no conocemos, de forma permanente y sin poder revocársela solo a ella. Hablar nosotros directo
con Instagram son ~60 líneas (`src/instagramSesion.js`) y la cookie no sale de Railway.

---

## 6. Si quieres apagarlo

Borra la variable `IG_SESSIONID` en Railway y redespliega. El scraper sigue funcionando igual; lo
único que vuelve a no poderse guardar es el contenido limitado por edad, y el panel lo dirá con
«Sin montar» en vez de callárselo.
