import {
  CompiledQuery,
  Dataset,
  PipelineStage,
  QueryError,
  QuerySpec,
  SecurityContext,
} from '../analytics.types';
import { registry } from '../semantic/registry';
import { buildMatch } from './match';
import { buildGroupAndProject } from './group';
import { buildAnnotation } from './annotation';

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 10000;

/** Coleta os $lookup + $unwind necessários para as dimensões com join. */
function buildLookups(spec: QuerySpec, ds: Dataset): PipelineStage[] {
  const stages: PipelineStage[] = [];
  const seen = new Set<string>();

  for (const dn of spec.dimensions ?? []) {
    const dim = ds.dimensions[dn];
    if (!dim?.lookup || seen.has(dim.lookup.as)) continue;
    seen.add(dim.lookup.as);
    stages.push({ $lookup: dim.lookup });
    stages.push({
      $unwind: { path: `$${dim.lookup.as}`, preserveNullAndEmptyArrays: true },
    });
  }
  return stages;
}

/** $sort a partir do spec.order (sobre as colunas de saída). */
function buildSort(spec: QuerySpec, outputKeys: string[]): PipelineStage | null {
  if (!spec.order?.length) return null;
  const sort: Record<string, 1 | -1> = {};
  for (const [key, dir] of spec.order) {
    if (!outputKeys.includes(key)) {
      throw new QueryError(
        'invalid-order',
        `Não é possível ordenar por '${key}': não está no resultado.`,
        outputKeys,
      );
    }
    sort[key] = dir === 'asc' ? 1 : -1;
  }
  return { $sort: sort };
}

/**
 * Compila uma QuerySpec num aggregation pipeline do Mongo.
 * Ordem dos estágios: match → lookups → group → project → sort → limit.
 *
 * Invariantes garantidas:
 *  1. Nenhum valor do payload entra como código (só como valor em $match/$in).
 *  2. company (tenant) está sempre no primeiro $match.
 *  3. ratios são SUM(num)/SUM(den), resolvidos no $project.
 *  4. limit tem teto mesmo quando o cliente não manda.
 */
export function compile(spec: QuerySpec, ctx: SecurityContext): CompiledQuery {
  const ds = registry.get(spec.dataset);
  if (!ds) {
    throw new QueryError(
      'unknown-dataset',
      `Dataset '${spec.dataset}' não existe.`,
      registry.list().map((d) => d.name),
    );
  }
  if (!spec.measures?.length) {
    throw new QueryError('no-measures', 'É preciso ao menos uma medida.');
  }

  const match = buildMatch(spec, ds, ctx);
  const lookups = buildLookups(spec, ds);
  const { stages: groupProject, outputKeys } = buildGroupAndProject(spec, ds);
  const sort = buildSort(spec, outputKeys);
  const limit = Math.min(spec.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const pipeline: PipelineStage[] = [
    { $match: match },
    ...lookups,
    ...groupProject,
    ...(sort ? [sort] : []),
    { $limit: limit },
  ];

  return {
    collection: ds.collection,
    pipeline,
    annotation: buildAnnotation(spec, ds),
  };
}
