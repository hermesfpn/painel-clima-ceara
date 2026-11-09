import { coletarFortaleza } from '../lib/fontes.mjs';
import { responder } from '../lib/resposta.mjs';

// GET /api/fortaleza — calor (UTCI) nas estações, histórico e canais/lagoas do Observatório de Fortaleza
export default () => responder(coletarFortaleza);

export const config = { path: '/api/fortaleza' };
