/* Resposta padrão das funções: JSON com cache na CDN da Netlify.
 * O cache de 15 min evita sobrecarregar os servidores públicos: todos os visitantes
 * compartilham a mesma cópia, e uma versão antiga é servida enquanto a nova é buscada.
 */
export async function responder(coletor) {
  try {
    const dados = await coletor();
    return Response.json(dados, {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=900, stale-while-revalidate=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return Response.json(
      { erro: 'Fonte indisponível no momento', detalhe: String(e?.message || e) },
      { status: 502, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
    );
  }
}
