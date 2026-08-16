import mongoose from 'mongoose';
import {
  QueryError,
  QueryResult,
  QuerySpec,
  SecurityContext,
} from './analytics.types';
import { compile } from './engine/compile';
import { registry } from './semantic/registry';

/**
 * Executa uma QuerySpec: compila para pipeline e roda no Mongo.
 *
 * Cache (Redis) entra aqui numa fase seguinte: a chave DEVE incluir o
 * SecurityContext (tenant + role), senão um usuário vê o cache de outro.
 */
export async function runQuery(
  spec: QuerySpec,
  ctx: SecurityContext,
): Promise<QueryResult> {
  const started = Date.now();
  const compiled = compile(spec, ctx);

  const db = mongoose.connection.db;
  if (!db) throw new QueryError('db-unavailable', 'Conexão com o banco indisponível.');

  const data = await db
    .collection(compiled.collection)
    .aggregate(compiled.pipeline, { allowDiskUse: true })
    .toArray();

  const durationMs = Date.now() - started;

  return {
    data,
    annotation: compiled.annotation,
    meta: {
      cached: false,
      durationMs,
      rowCount: data.length,
      // pipeline só é exposto fora de produção (ajuda no debug do frontend)
      ...(process.env.NODE_ENV !== 'production' ? { pipeline: compiled.pipeline } : {}),
    },
  };
}

/**
 * Catálogo visível: datasets, dimensões e medidas.
 * Alimenta query builders no frontend. (Filtro por role/scope entra depois.)
 */
export function getMeta(_ctx: SecurityContext) {
  return registry.list().map((ds) => ({
    name: ds.name,
    grain: ds.grain,
    dimensions: Object.entries(ds.dimensions).map(([key, d]) => ({
      name: key,
      title: d.title,
      type: d.type,
    })),
    measures: Object.entries(ds.measures).map(([key, m]) => ({
      name: key,
      title: m.title,
      kind: m.kind,
      format: m.format ?? null,
    })),
  }));
}
