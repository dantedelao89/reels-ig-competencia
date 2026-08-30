-- X (Twitter) como cuarta plataforma de DISECTA.
-- Calcado de tiktok_videos / tiktok_creators, con lo propio de X:
--   * `caption` guarda el texto COMPLETO (los posts largos llegan con 1500-2500 caracteres).
--   * `video_url` / `imagenes` guardan lo ya rehospedado en R2, para que la descarga desde el
--     dashboard no dependa de que X siga sirviendo el archivo.
--   * `conversation_id` deja reconstruir el hilo: en las cuentas de prompts, el prompt completo
--     suele ir en un tweet de continuación, no en el que trae el video.
--
-- Aplicar en el SQL Editor de Supabase (proyecto mkgqfvfpbclacxafxike) y NO olvidar el
-- `notify pgrst` del final: sin él PostgREST sigue sin ver las tablas nuevas.

create table if not exists disecta.x_creators (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  activo boolean not null default true,
  proyecto text,
  posts_por_corrida integer,
  ultima_corrida timestamptz,
  creado_en timestamptz not null default now()
);

-- Una cuenta, una fila: el handle se compara sin @ y sin mayúsculas.
create unique index if not exists x_creators_username_uniq
  on disecta.x_creators (lower(replace(username, '@', '')));

create table if not exists disecta.x_posts (
  id uuid primary key default gen_random_uuid(),

  -- Identidad. post_id ÚNICO: sin esto el upsert con onConflict falla.
  post_id text not null,
  creador text,                    -- screen_name, sin @
  creador_nombre text,
  creador_url text,
  url text,

  -- Contenido
  caption text,                    -- el texto completo del post
  fecha_publicacion timestamptz,
  views bigint,
  likes bigint,
  comentarios bigint,              -- replies
  retweets bigint,
  citas bigint,                    -- quotes
  guardados bigint,                -- bookmarks
  duracion_seg integer,
  tipo text,                       -- 'Video' | 'Imagen' | 'Texto'
  hashtags text,
  links_externos text,
  idioma text,

  -- Hilo: el prompt completo suele vivir en un tweet de continuación.
  conversation_id text,
  es_respuesta boolean default false,

  -- Media. *_original = la URL de X (efímera); las otras ya viven en R2.
  thumbnail_original text,
  thumbnail_url text,
  video_original text,
  video_url text,
  imagenes jsonb,                  -- posts con varias fotos, ya en R2

  -- Capa de curación, idéntica a las otras plataformas.
  transcripcion text,
  traduccion text,
  proyecto text,
  estado text not null default 'nuevo',
  curado_en timestamptz,
  publicado_en timestamptz,
  mi_guion text,
  mi_notas text,
  mi_link text,
  mi_video_url text,
  recurso_url text,
  recurso_nombre text,
  scrapeado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Búsqueda: misma configuración 'spanish' que usan las demás (api/content aplica
  -- textSearch sin condicional de tabla, así que sin esta columna toda búsqueda daría 500).
  search_tsv tsvector generated always as (
    to_tsvector('spanish',
      coalesce(caption, '') || ' ' ||
      coalesce(creador, '') || ' ' ||
      coalesce(creador_nombre, '') || ' ' ||
      coalesce(transcripcion, ''))
  ) stored
);

create unique index if not exists x_posts_post_id_uniq on disecta.x_posts (post_id);
create index if not exists x_posts_search_idx on disecta.x_posts using gin (search_tsv);

-- El listado ordena en la base con nullsFirst:false.
create index if not exists x_posts_fecha_idx     on disecta.x_posts (fecha_publicacion desc nulls last);
create index if not exists x_posts_scrapeado_idx on disecta.x_posts (scrapeado_en desc nulls last);
create index if not exists x_posts_views_idx     on disecta.x_posts (views desc nulls last);
create index if not exists x_posts_estado_idx    on disecta.x_posts (estado);
create index if not exists x_posts_creador_idx   on disecta.x_posts (creador);
create index if not exists x_posts_proyecto_idx  on disecta.x_posts (proyecto);
create index if not exists x_posts_conv_idx      on disecta.x_posts (conversation_id);

-- Sin esto PostgREST sigue con el caché viejo y responde "no existe la tabla".
notify pgrst, 'reload schema';
