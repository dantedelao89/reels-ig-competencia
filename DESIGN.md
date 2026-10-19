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
4. **Rango**: segmentado · Hoy / 7 días / 30 días
5. **Orden**: segmentado · Velocidad / Reciente
6. Búsqueda de texto libre
7. `Ver descartados` — conmutador
8. `⚙ Consultas` — secundario, lleva a Fuentes
9. `Rastrear ahora` — `AsyncButton`, dice el costo estimado en su `title`

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

### 5.7 Instagram

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
