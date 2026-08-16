import { Types } from 'mongoose';
import {
  Dataset,
  Filter,
  QueryError,
  QuerySpec,
  SecurityContext,
  TimeDimensionSpec,
} from '../analytics.types';

/** Converte um valor para o tipo do campo (id → ObjectId, time → Date). */
function castValue(value: string | number, type: string): unknown {
  if (type === 'id') {
    if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
      return new Types.ObjectId(value);
    }
    throw new QueryError('invalid-filter-value', `Valor de id inválido: ${value}`);
  }
  if (type === 'time') return new Date(String(value));
  return value;
}

/** Soma dias a uma data (para intervalo semiaberto do range). */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Constrói o predicado de UM filtro. Só campos diretos (sem lookup). */
function buildFilter(filter: Filter, ds: Dataset): Record<string, unknown> {
  const dim = ds.dimensions[filter.dimension];
  if (!dim) {
    throw new QueryError(
      'unknown-dimension',
      `Dimensão '${filter.dimension}' não existe no dataset '${ds.name}'.`,
      Object.keys(ds.dimensions),
    );
  }
  if (dim.lookup) {
    throw new QueryError(
      'filter-on-joined-dimension',
      `Não é possível filtrar por '${filter.dimension}' (exige join). ` +
        `Filtre por um campo direto da collection.`,
    );
  }

  const field = dim.expr;
  const vals = (filter.values ?? []).map((v) => castValue(v, dim.type));

  switch (filter.operator) {
    case 'equals':
      return { [field]: { $in: vals } };
    case 'notEquals':
      return { [field]: { $nin: vals } };
    case 'contains':
      return { [field]: { $regex: String(filter.values?.[0] ?? ''), $options: 'i' } };
    case 'notContains':
      return {
        [field]: { $not: { $regex: String(filter.values?.[0] ?? ''), $options: 'i' } },
      };
    case 'gt':
      return { [field]: { $gt: vals[0] } };
    case 'gte':
      return { [field]: { $gte: vals[0] } };
    case 'lt':
      return { [field]: { $lt: vals[0] } };
    case 'lte':
      return { [field]: { $lte: vals[0] } };
    case 'set':
      return { [field]: { $exists: true, $ne: null } };
    case 'notSet':
      return { [field]: { $eq: null } };
    case 'inDateRange': {
      const [start, end] = filter.values ?? [];
      return {
        [field]: { $gte: new Date(String(start)), $lt: new Date(String(end)) },
      };
    }
    default:
      throw new QueryError('unknown-operator', `Operador inválido: ${filter.operator}`);
  }
}

/** Predicado do range de tempo — intervalo semiaberto [início, fim+1dia). */
function buildTimeRange(
  time: TimeDimensionSpec | undefined,
  ds: Dataset,
): Record<string, unknown> {
  if (!time?.range) return {};
  const dim = ds.dimensions[time.dimension];
  if (!dim || dim.type !== 'time') {
    throw new QueryError(
      'invalid-time-dimension',
      `'${time.dimension}' não é uma dimensão de tempo válida em '${ds.name}'.`,
    );
  }
  const [start, end] = time.range;
  // fim é inclusivo no dia informado → usamos < (fim + 1 dia)
  const endExclusive = addDays(new Date(end), 1);
  return { [dim.expr]: { $gte: new Date(start), $lt: endExclusive } };
}

/**
 * Regras de visibilidade por papel (RLS).
 * ADMIN/MANAGER: veem tudo dentro da company.
 * WORKER: no MVP, o acesso ao analytics é restrito a ADMIN/MANAGER na rota,
 * então aqui não há caso WORKER. Se um dia WORKER puder consultar, o escopo
 * dele em service_orders exigiria um $lookup em serviceuserorders — ponto de
 * extensão documentado.
 */
function buildRowLevelSecurity(
  ctx: SecurityContext,
  _ds: Dataset,
): Record<string, unknown> {
  if (ctx.role === 'ADMIN' || ctx.role === 'MANAGER') return {};
  // Fecha por padrão: se um papel não previsto chegar aqui, não vaza nada.
  return { _id: { $exists: false } };
}

/** Monta o estágio $match completo. */
export function buildMatch(
  spec: QuerySpec,
  ds: Dataset,
  ctx: SecurityContext,
): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [];

  // 1. Tenant — SEMPRE, e nunca vindo do payload.
  clauses.push({ [ds.tenantField]: new Types.ObjectId(ctx.tenantId) });

  // 2. RLS por papel.
  const rls = buildRowLevelSecurity(ctx, ds);
  if (Object.keys(rls).length) clauses.push(rls);

  // 3. Range de tempo.
  const range = buildTimeRange(spec.timeDimension, ds);
  if (Object.keys(range).length) clauses.push(range);

  // 4. Filtros do usuário.
  for (const f of spec.filters ?? []) clauses.push(buildFilter(f, ds));

  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}
