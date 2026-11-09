import { coletarPluviometros } from '../lib/fontes.mjs';
import { responder } from '../lib/resposta.mjs';

// GET /api/pluviometros — chuva acumulada nos pluviômetros do CEMADEN no Ceará
export default () => responder(coletarPluviometros);

export const config = { path: '/api/pluviometros' };
