/* Coletor para hospedagem estática (GitHub Pages).
 * Grava data/acudes.json e data/pluviometros.json usando os mesmos coletores das Netlify Functions.
 * Uso: node scripts/coletar.mjs   (Node 18+)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { COLETORES } from '../netlify/lib/fontes.mjs';

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
let falhas = 0;
for (const [nome, coletar] of Object.entries(COLETORES)) {
  try {
    const dados = await coletar();
    await writeFile(new URL(`../data/${nome}.json`, import.meta.url), JSON.stringify(dados));
    console.log(`✓ ${nome}: ${dados.itens.length} itens`);
  } catch (e) {
    falhas++;
    console.error(`✗ ${nome}: ${e.message}`);
  }
}
// Falha só se nenhuma fonte respondeu; uma fonte fora do ar não deve impedir a publicação do site.
if (falhas === Object.keys(COLETORES).length) process.exit(1);
