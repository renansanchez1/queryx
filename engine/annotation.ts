import { ColumnAnnotation, Dataset, QuerySpec } from '../analytics.types';

/**
 * Constrói a annotation: tipo e formato de cada coluna de saída.
 * O frontend usa isso para renderizar sem saber nada do domínio.
 */
export function buildAnnotation(
  spec: QuerySpec,
  ds: Dataset,
): Record<string, ColumnAnnotation> {
  const ann: Record<string, ColumnAnnotation> = {};

  for (const dn of spec.dimensions ?? []) {
    const dim = ds.dimensions[dn];
    ann[dn] = {
      title: dim.title,
      type: dim.type === 'number' ? 'number' : dim.type === 'time' ? 'time' : 'string',
      format: dim.format ?? null,
    };
  }

  const t = spec.timeDimension;
  if (t?.granularity) {
    const dim = ds.dimensions[t.dimension];
    ann[`${t.dimension}.${t.granularity}`] = {
      title: `${dim.title} (${t.granularity})`,
      type: 'time',
      format: t.granularity === 'hour' ? 'datetime' : 'date',
    };
  }

  for (const name of spec.measures) {
    const m = ds.measures[name];
    ann[name] = { title: m.title, type: 'number', format: m.format ?? 'number' };
  }

  return ann;
}
