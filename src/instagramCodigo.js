// El shortcode de Instagram ↔ el id numérico del medio, y nada más.
//
// Vive aparte de `instagramSesion.js` por una razón concreta: son funciones PURAS y así se pueden
// probar sin arrancar media aplicación. Metidas en el módulo de la sesión, el test tenía que
// importar `config.js`, que exige `APIFY_TOKEN` y mata el proceso si falta — es decir, la pieza más
// fácil de verificar de toda la ruta era la única que no se podía verificar.

// Base64 con el alfabeto URL-safe: es el que usa Instagram para sus shortcodes.
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// La API de Instagram pide el id numérico, no el shortcode. VERIFICADO contra un id que devolvió el
// actor de Apify: Dd31BqAIr51 → 3996896404598603381 (ver `pruebas/shortcode.test.js`).
// Se usa BigInt porque los ids pasan de 2^53 y con Number se redondean en silencio: daría un id
// casi correcto, y un 404 que parecería culpa de la cookie.
export function mediaIdDesdeShortcode(shortcode) {
  const sc = String(shortcode || '');
  if (!sc) return null;
  let n = 0n;
  for (const c of sc) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) return null;
    n = n * 64n + BigInt(i);
  }
  return n.toString();
}

// Saca el shortcode de cualquiera de las formas de link que reparte Instagram (/reel/, /reels/,
// /p/, /tv/). Un link de PERFIL devuelve null a propósito: no identifica un post.
export function shortcodeDeUrl(url) {
  const m = /instagram\.com\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i.exec(String(url || ''));
  return m ? m[1] : null;
}
