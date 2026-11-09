import { coletarAcudes } from '../lib/fontes.mjs';
import { responder } from '../lib/resposta.mjs';

// GET /api/acudes — volume dos açudes monitorados (Portal Hidrológico do Ceará)
export default () => responder(coletarAcudes);

export const config = { path: '/api/acudes' };
