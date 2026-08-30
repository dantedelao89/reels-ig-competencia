-- Respuestas del autor en los comentarios de su propio post.
-- En X muchas cuentas publican el video con un gancho corto y sueltan el PROMPT contestando a
-- quien lo pidió. Eso no es el hilo (el autor respondiéndose a sí mismo, que ya se une al copy):
-- son mensajes que empiezan con @handle y viven abajo, entre los comentarios.

alter table disecta.x_posts add column if not exists respuestas_autor jsonb;
alter table disecta.x_posts add column if not exists respuestas_texto text;

-- search_tsv tiene que alcanzarlas: si el prompt vive en una respuesta y no está indexado,
-- buscarlo en DISECTA no lo encuentra. Una columna generada no se puede alterar, hay que
-- recrearla (y con ella su índice).
drop index if exists disecta.x_posts_search_idx;
alter table disecta.x_posts drop column if exists search_tsv;
alter table disecta.x_posts add column search_tsv tsvector generated always as (
  to_tsvector('spanish',
    coalesce(caption, '') || ' ' ||
    coalesce(creador, '') || ' ' ||
    coalesce(creador_nombre, '') || ' ' ||
    coalesce(respuestas_texto, '') || ' ' ||
    coalesce(transcripcion, ''))
) stored;
create index x_posts_search_idx on disecta.x_posts using gin (search_tsv);

notify pgrst, 'reload schema';
