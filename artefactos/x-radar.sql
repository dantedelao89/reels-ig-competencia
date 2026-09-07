-- Radar de X: consultas guardadas (hashtags o palabras clave) y lo que traen, por día.
--
-- Tabla APARTE de x_posts a propósito. Son cosas distintas:
--   * x_posts   = cuentas que Dante eligió seguir. Se curan, se archivan a R2, se conservan.
--   * x_radar   = descubrimiento. Mucho volumen, vida corta, sin curación y SIN archivar media
--                 (archivar un firehose costaría almacenamiento por contenido que casi todo se
--                 descarta). Lo que valga la pena se promueve: se añade su autor a Fuentes y a
--                 partir de ahí entra por el pipeline orgánico, que sí archiva.

create table if not exists disecta.x_busquedas (
  id uuid primary key default gen_random_uuid(),
  -- La consulta tal cual va a X, con sus operadores (min_faves:, lang:, -filter:replies…).
  consulta text not null,
  etiqueta text,                    -- nombre corto para agrupar en la UI
  activo boolean not null default true,
  posts_por_corrida integer,
  ultima_corrida timestamptz,
  creado_en timestamptz not null default now()
);
create unique index if not exists x_busquedas_consulta_uniq on disecta.x_busquedas (lower(consulta));

create table if not exists disecta.x_radar (
  id uuid primary key default gen_random_uuid(),
  post_id text not null,
  -- Qué consulta lo trajo. Se guarda la etiqueta ADEMÁS del id: si la consulta se borra, lo ya
  -- descubierto sigue sabiendo de dónde vino.
  busqueda_id uuid references disecta.x_busquedas(id) on delete set null,
  busqueda_etiqueta text,

  creador text,
  creador_nombre text,
  creador_url text,
  url text,
  caption text,                     -- el texto completo, con el hilo ya unido
  respuestas_autor jsonb,           -- lo que el autor contestó en los comentarios
  fecha_publicacion timestamptz,
  -- El día al que pertenece, en CDMX, resuelto AL GUARDAR. No como columna generada:
  -- `at time zone 'nombre'` es STABLE y Postgres la rechaza en un GENERATED.
  dia date,

  views bigint,
  likes bigint,
  comentarios bigint,
  retweets bigint,
  guardados bigint,
  duracion_seg integer,
  tipo text,                        -- 'Video' | 'Imagen' | 'Texto'
  hashtags text,
  links_externos text,
  idioma text,
  conversation_id text,
  -- Solo la URL original: el radar NO archiva a R2 (ver cabecera).
  thumbnail_original text,
  video_original text,

  -- Marca de "esto sí me sirve": al promoverlo, su autor se da de alta en Fuentes.
  promovido boolean not null default false,
  descartado boolean not null default false,
  scrapeado_en timestamptz,
  created_at timestamptz not null default now(),

  search_tsv tsvector generated always as (
    to_tsvector('spanish',
      coalesce(caption, '') || ' ' ||
      coalesce(creador, '') || ' ' ||
      coalesce(creador_nombre, ''))
  ) stored
);

create unique index if not exists x_radar_post_id_uniq on disecta.x_radar (post_id);
create index if not exists x_radar_search_idx   on disecta.x_radar using gin (search_tsv);
create index if not exists x_radar_dia_idx      on disecta.x_radar (dia desc nulls last, likes desc nulls last);
create index if not exists x_radar_busqueda_idx on disecta.x_radar (busqueda_id);
create index if not exists x_radar_creador_idx  on disecta.x_radar (creador);
create index if not exists x_radar_estado_idx   on disecta.x_radar (promovido, descartado);

notify pgrst, 'reload schema';
