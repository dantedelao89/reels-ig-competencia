// Prueba del shortcode → id numérico de Instagram, que es la pieza de la que depende TODA la ruta
// con sesión: si la conversión está mal, Instagram contesta 404 y parecería que la cookie no sirve.
//
// El vector no es inventado: es un reel real que el actor de Apify guardó el 11 nov 2026, y el id
// es el que el propio actor devolvió en su campo `id`. Esa es la única forma honesta de verificar
// esto sin sesión — comparar contra lo que dice Instagram por otra vía.
//
// Correr con:  node --test pruebas/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaIdDesdeShortcode, shortcodeDeUrl } from '../src/instagramCodigo.js';

test('el shortcode se convierte al id que devolvió el actor de Apify', () => {
  assert.equal(mediaIdDesdeShortcode('Dd31BqAIr51'), '3996896404598603381');
});

test('los reels limitados por edad del 11 nov 2026 dan un id estable', () => {
  assert.equal(mediaIdDesdeShortcode('DcbaKviRYAT'), '3970882583902126099');
  assert.equal(mediaIdDesdeShortcode('DGELlRbySGR'), '3568027744636314001');
});

test('un shortcode con un carácter imposible devuelve null en vez de un id inventado', () => {
  assert.equal(mediaIdDesdeShortcode('no!valido'), null);
});

test('saca el shortcode de las cuatro formas de link que manda Instagram', () => {
  const casos = [
    ['https://www.instagram.com/reel/DcbaKviRYAT/', 'DcbaKviRYAT'],
    ['https://www.instagram.com/reels/DcbaKviRYAT/', 'DcbaKviRYAT'],
    ['https://instagram.com/p/DcbaKviRYAT/?igsh=abc', 'DcbaKviRYAT'],
    ['https://www.instagram.com/tv/DcbaKviRYAT/', 'DcbaKviRYAT'],
  ];
  for (const [url, esperado] of casos) assert.equal(shortcodeDeUrl(url), esperado, url);
});

test('un link de perfil no trae shortcode, y se dice con null', () => {
  assert.equal(shortcodeDeUrl('https://www.instagram.com/malaikastudio0.1/'), null);
});
