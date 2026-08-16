import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { roleMiddleware } from '../../middlewares/role.middleware';
import * as controller from './analytics.controller';

const router = Router();

/**
 * Módulo de analytics: substitui os endpoints fixos de /reports por uma
 * camada semântica. Um endpoint de consulta, um de metadados.
 *
 * Acesso restrito a ADMIN/MANAGER (mesmo nível do /reports atual).
 * Para liberar WORKER, é preciso implementar RLS por usuário no engine.
 */
router.post(
  '/query',
  authMiddleware,
  roleMiddleware(['ADMIN', 'MANAGER']),
  controller.query,
);

router.get(
  '/meta',
  authMiddleware,
  roleMiddleware(['ADMIN', 'MANAGER']),
  controller.meta,
);

export default router;
