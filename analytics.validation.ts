import { QuerySpec } from './analytics.types';

const OPERATORS = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'gt',
  'gte',
  'lt',
  'lte',
  'set',
  'notSet',
  'inDateRange',
];
const GRANULARITIES = ['hour', 'day', 'week', 'month', 'quarter', 'year'];

/**
 * Valida a FORMA da QuerySpec (a superfície de ataque).
 * A validação semântica (dataset/measure/dimension existem?) fica no
 * compilador, que já conhece o catálogo. Aqui só garantimos o shape.
 *
 * No seu projeto isso é o equivalente à camada `*.validation.ts`. Se quiser,
 * dá para reescrever com Zod; para o MVP, validação manual evita nova dep.
 */
export function validateQuerySpec(body: unknown): {
  valid: boolean;
  errors: string[];
  spec?: QuerySpec;
} {
  const errors: string[] = [];
  const b = body as Record<string, unknown>;

  if (!b || typeof b !== 'object') {
    return { valid: false, errors: ['Corpo da requisição inválido.'] };
  }
  if (typeof b.dataset !== 'string' || !b.dataset) {
    errors.push("'dataset' é obrigatório (string).");
  }
  if (!Array.isArray(b.measures) || b.measures.length === 0) {
    errors.push("'measures' é obrigatório (array não-vazio).");
  } else if (!b.measures.every((m) => typeof m === 'string')) {
    errors.push("'measures' deve conter apenas strings.");
  }
  if (b.dimensions !== undefined) {
    if (!Array.isArray(b.dimensions) || !b.dimensions.every((d) => typeof d === 'string')) {
      errors.push("'dimensions' deve ser um array de strings.");
    }
  }
  if (b.filters !== undefined) {
    if (!Array.isArray(b.filters)) {
      errors.push("'filters' deve ser um array.");
    } else {
      b.filters.forEach((f: unknown, i: number) => {
        const filter = f as Record<string, unknown>;
        if (typeof filter?.dimension !== 'string') {
          errors.push(`filters[${i}].dimension é obrigatório.`);
        }
        if (!OPERATORS.includes(filter?.operator as string)) {
          errors.push(`filters[${i}].operator inválido.`);
        }
      });
    }
  }
  if (b.timeDimension !== undefined) {
    const td = b.timeDimension as Record<string, unknown>;
    if (typeof td?.dimension !== 'string') {
      errors.push("'timeDimension.dimension' é obrigatório.");
    }
    if (
      td?.granularity != null &&
      !GRANULARITIES.includes(td.granularity as string)
    ) {
      errors.push("'timeDimension.granularity' inválida.");
    }
    if (td?.range !== undefined) {
      if (!Array.isArray(td.range) || td.range.length !== 2) {
        errors.push("'timeDimension.range' deve ser [início, fim].");
      }
    }
  }
  if (b.limit !== undefined && (typeof b.limit !== 'number' || b.limit <= 0)) {
    errors.push("'limit' deve ser um número positivo.");
  }

  if (errors.length) return { valid: false, errors };
  return { valid: true, errors: [], spec: b as unknown as QuerySpec };
}
