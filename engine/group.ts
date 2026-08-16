import {
  Dataset,
  Granularity,
  Measure,
  MongoExpr,
  PipelineStage,
  QueryError,
  QuerySpec,
} from '../analytics.types';

const DEFAULT_TZ = 'America/Sao_Paulo';

/** Resolve uma medida pelo nome ou lança erro com a lista disponível. */
function resolveMeasure(ds: Dataset, name: string): Measure {
  const m = ds.measures[name];
  if (!m) {
    throw new QueryError(
      'unknown-measure',
      `Medida '${name}' não existe no dataset '${ds.name}'.`,
      Object.keys(ds.measures),
    );
  }
  return m;
}

/**
 * Expande as medidas pedidas incluindo dependências de ratio.
 * Retorna:
 *  - requested: nomes que o usuário pediu (o que sai no resultado)
 *  - needed: todos os nomes que precisam ser calculados no $group
 *    (inclui numerador/denominador de ratios, mesmo que não pedidos)
 */
export function expandMeasures(ds: Dataset, requested: string[]) {
  const needed = new Set<string>();
  for (const name of requested) {
    const m = resolveMeasure(ds, name);
    if (m.kind === 'ratio') {
      resolveMeasure(ds, m.numerator);
      resolveMeasure(ds, m.denominator);
      needed.add(m.numerator);
      needed.add(m.denominator);
    } else {
      needed.add(name);
    }
  }
  return { requested, needed: [...needed] };
}

/** Nome do campo temporário usado por countDistinct (some no $project). */
const distinctTmp = (name: string) => `__distinct_${name}`;

/** Acumulador de uma medida não-ratio dentro do $group. */
function accumulator(name: string, m: Measure): Record<string, unknown> {
  switch (m.kind) {
    case 'count': {
      const one = m.filter ? { $cond: [m.filter, 1, 0] } : 1;
      return { [name]: { $sum: one } };
    }
    case 'sum': {
      const value: MongoExpr | string = m.expr ?? `$${m.field}`;
      const v = m.filter ? { $cond: [m.filter, value, 0] } : value;
      return { [name]: { $sum: v } };
    }
    case 'avg': {
      const value: MongoExpr | string = m.expr ?? `$${m.field}`;
      // filtro em avg: linhas fora do filtro viram null e o $avg as ignora
      const v = m.filter ? { $cond: [m.filter, value, null] } : value;
      return { [name]: { $avg: v } };
    }
    case 'countDistinct': {
      const value: MongoExpr | string = m.filter
        ? { $cond: [m.filter, `$${m.field}`, '$$REMOVE'] }
        : `$${m.field}`;
      return { [distinctTmp(name)]: { $addToSet: value } };
    }
    case 'ratio':
      // ratios não têm acumulador — são resolvidos no $project
      return {};
  }
}

/** Expressão de bucket de tempo via $dateTrunc. */
function timeBucket(field: string, granularity: Granularity, tz: string): MongoExpr {
  return {
    $dateTrunc: {
      date: `$${field}`,
      unit: granularity,
      timezone: tz,
    },
  };
}

/**
 * Monta $group e $project.
 * Retorna também os nomes das colunas de saída (dimensões + medidas pedidas).
 */
export function buildGroupAndProject(
  spec: QuerySpec,
  ds: Dataset,
): { stages: PipelineStage[]; outputKeys: string[] } {
  const tz = spec.timezone ?? DEFAULT_TZ;
  const dimNames = spec.dimensions ?? [];
  const { requested, needed } = expandMeasures(ds, spec.measures);

  // --- _id do $group: uma chave por dimensão ---
  const idSpec: Record<string, unknown> = {};
  const outputKeys: string[] = [];

  for (const dn of dimNames) {
    const dim = ds.dimensions[dn];
    if (!dim) {
      throw new QueryError(
        'unknown-dimension',
        `Dimensão '${dn}' não existe no dataset '${ds.name}'.`,
        Object.keys(ds.dimensions),
      );
    }
    idSpec[dn] = `$${dim.expr}`;
    outputKeys.push(dn);
  }

  // Dimensão de tempo com granularidade vira um bucket
  let timeKey: string | null = null;
  const t = spec.timeDimension;
  if (t?.granularity) {
    const dim = ds.dimensions[t.dimension];
    if (!dim || dim.type !== 'time') {
      throw new QueryError(
        'invalid-time-dimension',
        `'${t.dimension}' não é dimensão de tempo em '${ds.name}'.`,
      );
    }
    timeKey = `${t.dimension}.${t.granularity}`;
    idSpec[timeKey] = timeBucket(dim.expr, t.granularity, tz);
    outputKeys.push(timeKey);
  }

  // --- acumuladores das medidas ---
  const groupStage: Record<string, unknown> = {
    _id: Object.keys(idSpec).length ? idSpec : null,
  };
  for (const name of needed) {
    Object.assign(groupStage, accumulator(name, resolveMeasure(ds, name)));
  }

  // --- $project: eleva dimensões do _id e resolve medidas de saída ---
  const projectStage: Record<string, unknown> = { _id: 0 };

  for (const dn of dimNames) {
    const dim = ds.dimensions[dn];
    // ids viram string para JSON limpo
    projectStage[dn] =
      dim.type === 'id' ? { $toString: `$_id.${dn}` } : `$_id.${dn}`;
  }
  if (timeKey) projectStage[timeKey] = `$_id.${timeKey}`;

  for (const name of requested) {
    const m = resolveMeasure(ds, name);
    if (m.kind === 'ratio') {
      // SUM(num)/SUM(den) — resolvido aqui, nunca AVG(rate)
      projectStage[name] = {
        $cond: [
          { $eq: [`$${m.denominator}`, 0] },
          null,
          { $divide: [`$${m.numerator}`, `$${m.denominator}`] },
        ],
      };
    } else if (m.kind === 'countDistinct') {
      projectStage[name] = { $size: `$${distinctTmp(name)}` };
    } else {
      projectStage[name] = `$${name}`;
    }
  }

  return {
    stages: [{ $group: groupStage }, { $project: projectStage }],
    outputKeys: [...outputKeys, ...requested],
  };
}
