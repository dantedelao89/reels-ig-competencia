# DESIGN.md — DISECTA

Fuente de referencia de las decisiones visuales y de UX/UI del dashboard. Antes de implementar
cualquier pantalla o componente nuevo, se consulta este documento. Si algo no está contemplado, se
propone incorporarlo aquí **antes** de improvisarlo en código.

Creado el 19 oct 2026, documentando el sistema que el dashboard **ya usa** (no un estilo nuevo) y
definiendo el Radar multiplataforma.

---

## 1. Principios

1. **Una pantalla, una decisión.** Cada vista existe para que Dante decida algo: qué curar, qué
   seguir, qué publicar. Si una pantalla no termina en una decisión, no debería existir.
2. **El estado se ve donde se usa.** Nada de interruptores que viven solo en Railway o en otra
   pestaña. Si algo se puede encender, su estado real se pinta en la pantalla donde se opera.
3. **Divulgación progresiva.** Primero el titular, luego el detalle, al final lo que cuesta dinero.
   Lo caro nunca pasa por accidente.
4. **El ruido se filtra con herramientas, no con fe.** Las fuentes de descubrimiento traen basura
   por diseño: la pantalla da umbrales y orden, y dice cuánta basura hay.
5. **Nunca mentir con la interfaz.** Si un dato no se pudo leer, se dice "no se pudo leer" — no se
   muestra un cero.

---

## 2. Tokens visuales

Definidos en `dashboard/tailwind.config.ts` y `dashboard/app/globals.css`. **No se inventan colores
ni fuentes nuevas.**

| Token | Valor | Uso |
|---|---|---|
| `ink` | `#0f1115` | Texto principal |
| `ink-soft` | `#1a1d24` | Texto sobre fondos oscuros |
| `line` | `#e6e7eb` | Todos los bordes y separadores |
| `muted` | `#6b7280` | Texto secundario, etiquetas, ayudas |
| `accent` | `#2563eb` | Acción primaria, elementos activos |
| `accent-soft` | `#eff4ff` | Fondo de elementos activos o marcados |
| fondo app | `#f6f7f9` | `body` |
| fondo tarjeta | `white` | Paneles, tarjetas, filas |

**Semánticos** (Tailwind estándar, sin extender): verde `green-50/700` = encendido/éxito · ámbar
`amber-50/700` = advertencia accionable · rojo `red-50/600` = error o destructivo · gris
`gray-100/500` = apagado o inactivo.

**Tipografía:** stack de sistema (`font-sans`). Sin fuentes web: el panel es herramienta de trabajo,
no pieza de marca. Los dos design systems de marca (cuaderno / dante) **no aplican aquí**.

- `text-lg font-semibold tracking-tight` — título de sección (uno por pantalla)
- `text-sm font-medium` — título de tarjeta o panel
- `text-xs` — cuerpo por defecto de controles y tablas
- `text-[11px] uppercase tracking-wide text-muted` — etiqueta de grupo de campos
- `text-[10px] text-muted` — nota al pie, explicación de costo

**Espaciado y forma:** `gap-2` entre controles, `gap-1.5` entre fichas, `px-3 py-2` en cabeceras de
panel, `p-2` en celdas de tabla. Radios: `rounded-md` en controles, `rounded-lg` en paneles y
tarjetas, `rounded-full` solo en insignias. **Sin sombras** salvo `shadow-sm` en el segmento activo.

**Modo claro únicamente.** `color-scheme: light` es deliberado; no se añade modo oscuro.

---

## 3. Arquitectura de información

Dos ejes que ya existen en `DashboardClient.tsx` y se conservan:

- **`section`**: `contenido` · `fuentes` · `historias` · `radar`
- **`mode`** (solo dentro de `contenido`): `organico` · `ads`
- **`view`** (solo dentro de `contenido`): `grid` · `table`

La navegación **se recuerda en `localStorage`**: al volver, Dante aterriza donde estaba. Toda
sección nueva debe respetarlo.

**Responsabilidad de cada pantalla:**

| Pantalla | Decide |
|---|---|
| **Contenido** | Qué del material ya archivado se cura, traduce, transcribe y publica |
| **Fuentes** | A quién se sigue y con qué frecuencia |
| **Historias** | Qué se capturó hoy de las 24 h que caducan, y qué cuentas van solas |
| **Radar** | Qué está pasando ahora mismo que merece contenido propio |

Regla de frontera: **lo archivado vive en Contenido; lo que solo se está descubriendo vive en
Radar.** El Radar no archiva nada a R2 — eso lo hace el pipeline orgánico cuando se promueve.

---

## 4. Componentes

Existen en `dashboard/components/ui/`. **Se reutilizan; no se crean variantes nuevas.**

`AsyncButton` (acción que tarda, con su `loadingLabel`) · `SearchSelect` (selector con búsqueda, a
partir de ~10 opciones) · `Toast` (`success` / `error` / `info`) · `Activity` (barra global de
trabajo en curso) · `Spinner` · `Skeleton` · `EmptyState` · `ErrorState` · `ErrorBoundary` ·
`ProgressBar`.

**Botones**

| Tipo | Clases | Cuándo |
|---|---|---|
| Primario | `h-8 px-2.5 text-xs rounded-md bg-accent text-white font-medium hover:opacity-90` | Una por bloque, la acción esperada |
| Secundario | `h-7/h-8 px-2 text-xs rounded-md border border-line bg-white hover:bg-gray-100` | Todo lo demás |
| Destructivo | mismo secundario + `text-red-600` | Descartar, quitar, borrar |
| Marcado | `bg-accent-soft text-accent font-medium` | Estado activo (ej. 📖 Auto) |

Todo botón que no sea obvio lleva `title=` explicando qué hace **y qué cuesta**.

**Segmentado** (rangos, umbrales): `flex bg-gray-100 rounded-lg p-0.5 text-xs`, activo
`bg-white font-medium shadow-sm`. Para 2-5 opciones excluyentes. Más de 5 → `SearchSelect`.

**Insignia de estado:** `text-xs px-2 py-0.5 rounded-full` con el par semántico correspondiente, y
`●` / `○` al inicio para no depender solo del color.

**Tablas:** encabezado `text-left p-2` en `text-muted`, filas separadas por `border-line`, edición
en línea con `border-transparent hover:border-line focus:border-accent`. Guardado **optimista**: la
UI responde al instante y se revierte con un toast si el servidor falla.

**Estados obligatorios de toda vista con datos:** cargando (`Skeleton`, nunca salto de layout) ·
vacío (`EmptyState` que dice **qué hacer**, no "sin resultados") · error (`ErrorState` con reintento)
· parcial (lo que sí llegó, y un aviso de lo que no).

---

## 5. Pantalla: Radar (nueva)

Generaliza el Radar de X actual (`RadarView.tsx`, 438 líneas) a X, YouTube y LinkedIn.

### 5.1 Qué cambia respecto a hoy

| Hoy | Nuevo |
|---|---|
| Solo X | X · YouTube · LinkedIn |
| Una fila por post | **Una tarjeta por TEMA**, con sus posts dentro |
| Orden por fecha, umbral de likes | Orden por **velocidad** (likes/h, vistas/h) |
| Sin comentarios | Comentarios **a pedido**, por tarjeta |
| Agrupado por día | Agrupado por día, se conserva |

### 5.2 Unidad principal: la tarjeta de tema

El mismo lanzamiento aparece 50 veces. Mostrar 50 filas es inservible; mostrar **una tarjeta con 50
fuentes dentro** es la diferencia entre 300 filas al día y ~10 tarjetas.

```
┌────────────────────────────────────────────────────────────┐
│ 🔥 Claude Code ahora corre agentes en paralelo   ⚡2.400/h │
│    X (12) · YouTube (3) · LinkedIn (2)            hace 5 h │
│    ÁNGULO: nadie explica qué se rompe al usarlo mal        │
│    [ver fuentes] [💬 comentarios] [💾 guardar] [✕]         │
└────────────────────────────────────────────────────────────┘
```

Jerarquía, de arriba a abajo: **tema → de dónde sale → qué hacer con él → acciones.** La métrica va
a la derecha, alineada, para poder barrer la columna con la vista.

- **Título**: lo escribe la IA a partir del cluster. Una línea, sin cortar a media palabra.
- **Velocidad**: `⚡ 2.400/h` con `tabular-nums`. Es el dato que ordena, así que es el único número
  con peso visual. El total absoluto va en el detalle, no aquí.
- **ÁNGULO**: una línea de la IA con el **hueco de contenido**, no un resumen. Es la razón de ser de
  la pantalla: convierte "esto pasó" en "esto puedo publicar".
- **Plataformas**: texto con conteo, no logos. Los iconos de marca a este tamaño son ruido.

### 5.3 Controles (cabecera)

En este orden, reutilizando los patrones que ya existen:

1. `📡 Radar` — título
2. **Temas**: fichas conmutables · Claude Code · ChatGPT · Anuncios IA · Video IA · Modelos nuevos
3. **Plataforma**: segmentado · Todo / X / YT / LI
4. **Idioma**: segmentado · Todo / ES / EN / PT — ver 5.7
5. **Rango**: segmentado · Hoy / 7 días / 30 días
6. **Orden**: segmentado · Velocidad / Reciente
7. Búsqueda de texto libre
8. `Ver descartados` — conmutador
9. `⚙ Consultas` — secundario, lleva a Fuentes
10. `Rastrear ahora` — `AsyncButton`, dice el costo estimado en su `title`

### 5.4 Divulgación progresiva

Tres niveles, y **el costo está en el tercero**:

1. **Tarjeta** — gratis, es lo que ya se trajo.
2. **Ver fuentes** — expande en la misma tarjeta (no modal): los posts del cluster con su autor,
   seguidores, métrica y enlace al original. Gratis.
3. **💬 Comentarios** — **cuesta dinero y lo dice antes**. Confirma con el monto estimado, igual que
   encender una cuenta en automático. Nunca automático.

### 5.5 Acciones y estados

Cada hallazgo se juzga **una vez**, como hoy:

- **💾 Guardar** → el post entra a `x_posts`/`yt_videos` y hereda la galería de Orgánico con
  reproductor, capturador de frames, descarga y transcripción. **No da de alta al autor.**
- **＋ Fuentes** → sigue a la CUENTA. Son dos intenciones distintas y siguen siendo dos botones.
- **✕ Descartar** → desaparece de la vista; recuperable con `Ver descartados`.

`promovido` · `descartado` · `guardado` ya existen en `x_radar` y se conservan.

### 5.6 Honestidad de la señal

El Radar **declara su propio ruido**. Si más del 60% de lo traído está bajo el umbral, lo avisa —
ya está medido que un hashtag puede ser 100% basura (`#ia` en X resultó ser un personaje de
Vocaloid). Cada consulta reporta su mediana y su conteo de flojos, para poder matar las que no
rinden.

### 5.7 Idioma: tres columnas de señal, no una

El Radar busca en **inglés, español y portugués de Brasil** (Dante, 21 oct 2026). No es un
parámetro del actor —`streamers/youtube-scraper` no tiene idioma ni país, y ni `hl`/`gl` ni el país
del proxy cambian nada, medido— sino el **idioma del texto de cada consulta**, así que cada tema
vive como tres consultas.

Eso convierte el idioma en una dimensión de filtro tan importante como la plataforma, porque la
decisión de contenido es distinta en cada una. Medido el 22 oct 2026, 16 horas después del
lanzamiento de Claude Duet: en inglés el tema iba en **medio millón de vistas**; en español había
**tres videos de dos dígitos de vistas**. Ese contraste es la señal más valiosa de la pantalla y se
pierde si los tres idiomas se mezclan en una sola lista.

El control va como **segmentado · Todo / ES / EN / PT**, junto al de plataforma. Se resuelve
filtrando por el sufijo de la etiqueta de la consulta (`claude · es`), que es la convención con la
que quedaron nombradas. Es un filtro de la vista, no estado guardado: por eso no hace falta una
columna de idioma que haya que mantener de acuerdo con el texto de la consulta.

**Ojo con el título**: en modo español YouTube traduce los títulos, así que el título NO dice el
idioma del video. Lo que no se traduce es la descripción. La pantalla muestra el idioma de la
CONSULTA que encontró el hallazgo, que es un hecho, y no presume el del video.

### 5.8 Cómo entra la información: a pedido, nada automático

**MVP decidido por Dante el 22 oct 2026: «no lo quiero automático».** El Radar no se llena solo.
Dante pide los hallazgos por chat, se le entregan en la conversación y **la misma pasada los guarda
en la base**, que es lo que la pantalla lee después.

Consecuencias de diseño, no detalles de implementación:

- **El cron queda apagado** desactivando las 22 consultas de `radar_busquedas`. Se apagan, no se
  borran: siguen siendo el registro de qué se busca y con qué texto, y encenderlas es un
  interruptor, no volver a escribirlas.
- **Las consultas apagadas siguen siendo la referencia** de cada hallazgo (`busqueda_id`), así que
  la pantalla puede agrupar y filtrar por consulta e idioma igual que si el cron las hubiera
  corrido. Apagado no significa huérfano.
- **`Rastrear ahora` sigue existiendo** en la cabecera, pero deja de ser el camino principal: es el
  botón para cuando Dante quiera disparar una consulta concreta desde la pantalla.
- La pantalla **no miente sobre su frescura**: dice cuándo fue la última vez que entró algo, porque
  sin cron no hay garantía de que sea de hoy.

### 5.9 Primera versión sin IA

La tarjeta por tema de 5.2 se construye **agrupando por la columna `temas`**, que ya se calcula al
insertar, es determinista y gratis. El título de la tarjeta es **el tema**, y dentro van los
hallazgos ordenados por velocidad.

El **título escrito por IA y el ÁNGULO de 5.2 quedan para la segunda versión** (Dante, 22 oct
2026). Son lo que convierte «esto pasó» en «esto puedo publicar», pero cuestan por uso y exigen
agrupar por suceso, no por tema. Se añaden **encima** de esta versión: la tarjeta ya es el
contenedor correcto, así que el ángulo se mete como una línea más y nada se rehace.

Mientras no haya ángulo, la tarjeta no finge tenerlo: no se pone un resumen automático en su lugar.

### 5.10 Las cuatro fuentes del Radar

El Radar se llena de cuatro sitios distintos, y conviene no confundirlos porque responden a
preguntas distintas:

| fuente | qué mira | cada cuánto | avisa | cuesta |
|---|---|---|---|---|
| **Consultas** | 24 búsquedas de YouTube, en inglés | cada hora, 8-19 y 22 | si cruza 1.000 vistas/h | $0.00 |
| **Centinela** | 10 canales OFICIALES | cada 15 min | en cuanto publican | $0.00 |
| **Barrido** | los ~124 canales de Fuentes | a petición | solo si cruza el umbral | $0.00 |
| **X** | 5 consultas con operadores | 1×/día, 7:00 | resumen diario a Slack | ~$0.85/mes |
| **Reddit** | 6 búsquedas por nombre de modelo | 1×/día, 7:30 | resumen diario a Slack | ver abajo |

Las tres primeras son de YouTube y van por RSS o leyendo la página de resultados, así que son
gratis. **X y Reddit son las que pagan Apify**, y por eso son las únicas dentro del presupuesto del
radar (`radarActoresDePago`).

#### Todo en INGLÉS (27 oct 2026)

Decisión de Dante: «no te enfoques en español, enfócate en inglés, que son los primeros que sacan
las tendencias». Está respaldado por los datos del propio proyecto: la ola de Claude Duet
reconstruida desde la base da **−0.5 h** para el primer video en inglés y **+3.0 h** para el primero
en español. Mirando en inglés se ve la ola tres horas antes.

Qué cambió con eso:

- **El radar libre respeta `activo`.** Antes leía las 37 filas y se saltaba el interruptor, con el
  argumento de que al ser gratis no había por qué apagar nada. El efecto era que el interruptor de
  Fuentes no movía nada en el radar que de verdad corre, y sin él no hay forma de decidir el idioma.
  Ahora 24 activas en inglés, 13 apagadas (es/pt), y se pasó de 52 peticiones por pasada a 24.
- **Sin sufijo, una consulta se busca en inglés.** Antes el valor por defecto era `en,es`.
- **El aviso ya no afirma el hueco en español.** La línea «🟢 Nadie lo ha hecho en español todavía»
  se calcula contando hallazgos en español; sin consultas en español diría eso en todos los avisos,
  siempre, y sería falso — no significaría que nadie lo ha hecho, sino que dejamos de buscarlo. Un
  contador que no puede ver no opina: la línea desaparece. Para recuperarla hay que volver a
  encender filas en español, y es un interruptor en Fuentes.

Las filas en español y portugués se APAGAN, no se borran: siguen siendo el registro de qué se buscó
y la referencia (`busqueda_id`) de los hallazgos que entraron por ellas.

#### Reddit responde una pregunta que ninguna otra fuente responde

Las tres fuentes de YouTube y la de X miran RESULTADOS: videos y posts que ya existen. Por eso todas
llegan después de que alguien publicó. Reddit mira CONVERSACIÓN, con `sort: rising`, que coge el post
antes de que explote.

Medido el 27 oct 2026 en una sola corrida: «Halloween 🎃 Wan 3.0 vs Kling 4.0» y «Kling 4.0 is quite
a good cheaper alternative to Seedance 2.5» — números de versión y comparaciones ya hechas, cuando
ningún canal oficial había publicado nada. Y aparecieron subreddits dedicados POR MODELO que el
sistema no miraba: r/HiggsfieldAI, r/KlingAI_Videos, r/Seedance_AI, r/Akool_Official.

Consecuencias de diseño, no detalles de implementación:

- **El resumen de Reddit NO ordena por velocidad.** Buscar en `rising` significa cogerlos temprano, y
  temprano significa **1, 3 o 5 upvotes**. Una velocidad sobre 3 upvotes es ruido con decimales. Lo
  que vale es el TÍTULO, y la agrupación es por SUBREDDIT, porque r/Seedance_AI diciendo algo de
  Seedance no es lo mismo que r/aivideo diciéndolo.
- **Una sola corrida de Apify para todas las búsquedas.** El actor cobra $0.04 solo por arrancar
  (`actor-start-gb`, $0.02/GB × 2 GB), así que seis búsquedas en seis corridas pagarían el arranque
  seis veces. `max_por_corrida` de cada fila se SUMA para formar el `maxItems` de la corrida.
- **Lo que cuesta es el tiempo, y el tiempo lo pone Reddit.** Una pasada son **$0.154 y 11 minutos**
  (6 búsquedas × 5 posts = 30 items), o **$4.62/mes** a 1×/día. Parecía que la culpa era de
  `includeMediaLinks` —su propia descripción avisa de que afecta al rendimiento— pero medido es
  falso: la misma pasada sin él iba a $0.1122 en 8 minutos, el mismo ritmo de ~$0.014 por minuto.
  Lo que tarda es rastrear las páginas de resultados de Reddit, que contestan 403 y se reintentan.
  O sea que las métricas (y con ellas el filtro de calidad) **salen gratis**: no hay una versión
  barata que merezca la pena.
- **El tope por corrida tiene que librar el arranque.** Con `maxTotalChargeUsd: 0.05`, cuatro
  corridas murieron en el segundo 2 con `Maximum cost per run is lower then actor start cost` — y
  cobraron $0.04 cada una. Un tope demasiado bajo no ahorra: hace que todo falle pagando.
- **Las búsquedas van calificadas**, igual que en X: `kling ai` y no `kling` (que trae apellidos
  alemanes), `sora 2` y no `sora`. Reddit no tiene operadores de búsqueda, así que la única defensa
  contra el ruido es que el término no sea ambiguo.
- **El radar de Reddit no archiva nada**, como el resto del radar: solo URL, texto y métricas.

Y una lección que salió de montarlo y vale para TODO el proyecto: **una corrida fallida de Apify no
lanzaba error**. `.call()` espera a que termine y devuelve el objeto pase lo que pase, así que el
dataset salía vacío y quien llamaba leía «no hubo resultados». Cuatro corridas FAILED se vieron como
cuatro ceros, y me pasé un rato ajustando la entrada. Desde el 27 oct 2026 `apifyRun.js` mira
`run.status` y lanza si terminó mal sin resultados (si trajo items se usan, con un aviso: un actor
que se queda sin tiempo suele dejar datos buenos). Es el mismo disfraz del 429 de YouTube y de los
404 falsos del centinela: **un cero hay que saber de qué es.**

#### Por qué el radar de X manda un RESUMEN y no una alerta por umbral

Las otras fuentes avisan cuando algo CRUZA un umbral de velocidad. En X ese diseño no sirve, y las
seis consultas medidas el 27 oct 2026 dicen por qué: **un lanzamiento de verdad no corre.**
«Introducing Topview T1» y «Introducing FLUX 3 Max» van a 8 likes/hora, y son justo la información
que se busca. Lo que sí corre casi nunca es del nicho —lo más rápido del día fue el presidente de
OpenAI a 771 likes/h— y por debajo de 200 likes/h está el contenido rutinario de los creadores.

Así que el cron manda lo que encontró, ordenado por velocidad y repartido entre temas, y **marca
con 🔥 lo que además despegó** (más de 300 likes/h, calibrado sobre 120 hallazgos de ese día). El
umbral como filtro de entrada esconderia los lanzamientos; como marca, los ordena.

El mensaje dice además **cuántas consultas volvieron vacías**, porque el actor de X falla en
silencio: medido, una consulta devolvió 0 resultados en una corrida y 20 en las dos siguientes, sin
lanzar ningún error. Un cero que no se nombra se lee igual que «hoy no hubo nada de eso».

#### Nombres de modelos: hay que desambiguarlos

La lección de `#ia` (que en X es un personaje de Vocaloid) se repite con los nombres a secas. Medido
el 27 oct 2026: con `sora` y `runway` sueltos, **17 de 20 resultados eran basura** —una actriz
llamada Charlotte, «uncle sora» de un anime, «the runway is calling» de una pasarela de moda. Con
los nombres calificados (`"sora 2"`, `"openai sora"`, `runwayml`, `"kling ai"`), 18 de 20 pasaron a
ser del nicho. En español pasa con frases enteras: `"inteligencia artificial"` trae política y
`"video con ia"` ya es coloquial y trae burla.

#### El radar de YouTube por Apify está RETIRADO

Hasta el 27 oct 2026 el cron diario corría X **y también** YouTube por Apify. Lo de YouTube era un
duplicado de pago de la primera fila de la tabla: medido, 17 consultas una vez al día por **$0.174
(el 61% del gasto de Apify del ciclo)**, contra 37 consultas trece veces al día por **$0.00** — y
el gratis es además el que ya manda los avisos. `POST /radar-yt` se conserva para dispararlo a mano.

El **barrido** existe porque Dante lo estaba haciendo A MANO: medido el 23 oct 2026, 99 corridas de
Apify canal por canal, **$3.88** del periodo, el 71% de su gasto. No era una comodidad que faltaba,
era un trabajo caro y repetitivo que el sistema podía hacer solo.

Va por **RSS**, como el centinela, así que cuesta **$0.00** frente a los ~$3-4 que costaría barrer
los 124 por Apify. Esa diferencia es la que permite que exista: por Apify habría que elegir a
cuáles renunciar.

**No avisa de todo, a propósito.** 124 creadores publican entre 30 y 80 videos al día; mandarlos a
Slack sería garantizar que el canal se silencie en tres días. Lo que entra se guarda, se clasifica y
se ordena en la pantalla, y solo escribe si algo cruza el mismo umbral que el resto.

**El id del canal no está en la base.** `yt_channels` guarda `@handles` y el RSS necesita el id
`UC…`, así que hay una caché en `datos/canales-yt.json` más resolución al vuelo cuando aparece un
canal que no está en ella. Así añadir un canal desde Fuentes sigue funcionando sin desplegar nada.

### 5.11 Instagram

**Fuera de la v1, a propósito.** Instagram no tiene búsqueda por palabra clave, solo hashtags, y los
hashtags de IA ya se midieron como ruido. Instagram entra por las **cuentas que ya están en
Fuentes**, que es mejor señal. Si se añade búsqueda por hashtag más adelante, se mide primero y se
documenta aquí.

---

## 6. Responsive

El panel se usa en escritorio, pero debe sobrevivir al iPhone: Dante manda links desde el teléfono.

- Cabeceras de control: `flex flex-wrap items-center gap-2`. Nunca una fila que obligue a scroll
  horizontal.
- Tablas anchas: contenedor con `overflow-x-auto`. **El `body` nunca hace scroll horizontal.**
- Tarjetas del Radar: una columna en móvil; la métrica pasa debajo del título.
- Objetivos táctiles: mínimo `h-8` en lo que se toca en móvil.

---

## 7. Antipatrones

1. **Scroll infinito en el Radar.** Un feed sin fondo es exactamente lo que hace abandonarlo. Tope
   por día y paginación explícita.
2. **Ordenar por métricas absolutas.** 2 M de vistas en dos años no es una tendencia.
3. **Traer comentarios por defecto.** Multiplica costo y ruido sin que nadie lo pida.
4. **Colores o fuentes nuevas.** Si hace falta un color, se añade a los tokens, no a un componente.
5. **Dos interruptores para lo mismo.** Pasó con el cron de historias: el visible no era el que
   mandaba.
6. **Modales encima de modales.** El detalle se expande en su sitio.
7. **Vacíos que no enseñan.** "Sin resultados" no sirve; hay que decir qué hacer.
8. **Gastar sin avisar.** Toda acción que llame a un actor dice su costo antes.
9. **Rehacer lo que existe.** El Radar de X ya tiene tablas, acciones y pantalla: se generaliza.

---

## 8. Temas: son datos, no código

Decidido por Dante el 19 oct 2026: **los temas se editan desde la interfaz**, no se hornean en el
código. Su lista de arranque lo explica mejor que cualquier categoría abstracta:

> claude · claude code · openai · chatgpt · nano banana · gpt image · seedance · ai videos ·
> influencer AI · …

**Son nombres de modelos y herramientas, no categorías.** De ahí sale la decisión barata del
sistema: un tema es **una etiqueta más una lista de alias**, y clasificar un hallazgo es buscar sus
alias en el texto.

- **Determinista y gratis.** "nano banana" aparece o no aparece; no hace falta preguntarle a una IA
  ni pagar por cada fila clasificada.
- **Los alias resuelven el mismo modelo con varios nombres**: `gpt image` / `gpt-image` /
  `gpt image 2.5`, o `seedance` / `bytedance seedance`.
- **Un hallazgo puede llevar varios temas.** Un video de "Seedance vs Veo" es de `seedance` y de
  `ai videos`.
- **La IA entra solo después**, para dos cosas que no se pueden resolver con `LIKE`: agrupar posts
  del mismo suceso en una tarjeta y escribir la línea ÁNGULO.
- Un tema sin alias es solo un filtro vacío: la UI lo advierte al guardarlo.

Los temas se administran **en Fuentes**, junto a las consultas, porque son la misma clase de
decisión: qué se rastrea. Columnas: etiqueta, alias, activo.

**En la cabecera del Radar**, los temas son fichas conmutables que se envuelven en varias líneas,
ordenadas por cuántos hallazgos tiene cada uno hoy. Pasando de 8 fichas visibles, el resto se
colapsa en `+N más` — con 15 temas, una fila de fichas es ruido, no navegación.

---

## 9. Decisiones

- [x] Tarjeta por tema como unidad principal (Dante, 19 oct 2026)
- [x] Tabla `radar` única con columna `plataforma`, migrando los 80 hallazgos de `x_radar`
- [x] Sacar las búsquedas de YouTube de `yt_videos` a la tabla del Radar
- [x] **Instagram fuera de la v1** (Dante, 19 oct 2026). Entra por las cuentas de Fuentes
- [x] **Temas editables desde Fuentes**, con alias (Dante, 19 oct 2026)
- [x] 10 tarjetas por día antes de paginar — valor por defecto, se cambia en un sitio
- [x] **Buscar siempre en inglés, español y portugués de Brasil** (Dante, 21 oct 2026)
- [x] **Nada automático: Dante pide por chat, se entrega y se guarda en la base** (Dante, 22 oct 2026)
- [x] **Primera versión sin IA**: tarjeta por tema agrupando por `temas`; el ángulo va después (Dante, 22 oct 2026)
- [x] **Barrido de los canales de Fuentes por RSS**, gratis y a petición (Dante, 23 oct 2026). Sustituye el rascado manual que costó $3.88 en una noche
- [x] **El barrido no avisa de todo**: llena la pantalla en silencio y solo escribe si cruza el umbral
