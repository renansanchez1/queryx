import { Request, Response, NextFunction } from 'express';
import { QueryError, SecurityContext, Role } from './analytics.types';
import { validateQuerySpec } from './analytics.validation';
import { runQuery, getMeta } from './analytics.service';

/**
 * Deriva o SecurityContext EXCLUSIVAMENTE do req.user (populado pelo
 * auth.middleware a partir do JWT). Nada de tenant vindo do corpo/query.
 */
function securityContext(req: Request): SecurityContext {
  const user = (req as Request & { user?: Record<string, unknown> }).user;
  if (!user?.company || !user?.id || !user?.role) {
    throw new QueryError('unauthenticated', 'Contexto de usuário ausente.');
  }
  return {
    tenantId: String(user.company),
    userId: String(user.id),
    role: String(user.role) as Role,
  };
}

/** POST /analytics/query */
export async function query(req: Request, res: Response, next: NextFunction) {
  try {
    const { valid, errors, spec } = validateQuerySpec(req.body);
    if (!valid || !spec) {
      return res.status(400).json({
        type: 'validation-error',
        title: 'QuerySpec inválida',
        status: 400,
        errors,
      });
    }

    const ctx = securityContext(req);
    const result = await runQuery(spec, ctx);
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof QueryError) {
      return res.status(err.kind === 'unauthenticated' ? 401 : 400).json({
        type: err.kind,
        title: 'Erro na consulta',
        status: err.kind === 'unauthenticated' ? 401 : 400,
        detail: err.message,
        available: err.available,
      });
    }
    return next(err);
  }
}

/** GET /analytics/meta */
export async function meta(req: Request, res: Response, next: NextFunction) {
  try {
    const ctx = securityContext(req);
    return res.status(200).json({ datasets: getMeta(ctx) });
  } catch (err) {
    return next(err);
  }
}
