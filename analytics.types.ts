/**
 * Tipos da camada semântica e do engine de consulta.
 *
 * A ideia central: o cliente descreve o QUE quer (QuerySpec) usando apelidos
 * (dataset, measures, dimensions). O catálogo (Dataset) diz o que cada apelido
 * significa. O compilador transforma isso num aggregation pipeline do Mongo,
 * injetando segurança (company/RLS) que NUNCA vem do cliente.
 */

/** Expressão de aggregation do Mongo (mantida como `unknown`/objeto genérico). */
export type MongoExpr = Record<string, unknown>;

/** Estágio de pipeline do Mongo. */
export type PipelineStage = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Catálogo: dimensões e medidas
// ---------------------------------------------------------------------------

export type DimensionType = 'string' | 'number' | 'time' | 'id';

export interface Dimension {
  /** Rótulo exibido (vai para a annotation). */
  title: string;
  /** Tipo lógico — controla cast de filtros e formatação. */
  type: DimensionType;
  /**
   * Caminho do campo APÓS eventuais lookups, sem o `$`.
   * Ex.: 'status' (campo direto) ou 'contract.num_contract' (após $lookup).
   */
  expr: string;
  /**
   * Se a dimensão exige um join, descreve o $lookup.
   * Filtros NÃO podem usar dimensões com lookup (mantém o $match indexável).
   */
  lookup?: {
    from: string;
    localField: string;
    foreignField: string;
    as: string;
  };
  /** Formato sugerido para o frontend (date, datetime, etc.). */
  format?: string;
}

export type Measure =
  | { kind: 'count'; title: string; filter?: MongoExpr; format?: string }
  | {
      kind: 'countDistinct';
      title: string;
      field: string;
      filter?: MongoExpr;
      format?: string;
    }
  | {
      kind: 'sum';
      title: string;
      field?: string;
      expr?: MongoExpr;
      filter?: MongoExpr;
      format?: string;
    }
  | {
      kind: 'avg';
      title: string;
      field?: string;
      expr?: MongoExpr;
      filter?: MongoExpr;
      format?: string;
    }
  | {
      /** Medida derivada: SUM(num)/SUM(den), resolvida no $project. */
      kind: 'ratio';
      title: string;
      numerator: string;
      denominator: string;
      format?: string;
    };

export interface Dataset {
  /** Nome público do dataset (usado na QuerySpec). */
  name: string;
  /** Nome da collection no Mongo (confirme contra os nomes reais do seu banco). */
  collection: string;
  /** Descrição do GRÃO — o que uma linha representa. Documental. */
  grain: string;
  /** Campo de company usado para isolamento multi-tenant. */
  tenantField: string;
  /** Nome da dimensão de tempo padrão (deve existir em `dimensions`). */
  defaultTimeDimension?: string;
  dimensions: Record<string, Dimension>;
  measures: Record<string, Measure>;
}

// ---------------------------------------------------------------------------
// QuerySpec: o contrato público da API
// ---------------------------------------------------------------------------

export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'set'
  | 'notSet'
  | 'inDateRange';

export interface Filter {
  dimension: string;
  operator: FilterOperator;
  values?: Array<string | number>;
}

export type Granularity =
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | null;

export interface TimeDimensionSpec {
  dimension: string;
  granularity?: Granularity;
  /** [início, fim] em ISO (YYYY-MM-DD ou datetime). Intervalo semiaberto. */
  range?: [string, string];
}

export interface QuerySpec {
  dataset: string;
  measures: string[];
  dimensions?: string[];
  timeDimension?: TimeDimensionSpec;
  filters?: Filter[];
  order?: Array<[string, 'asc' | 'desc']>;
  limit?: number;
  /** Fuso para truncar datas. Default: America/Sao_Paulo. */
  timezone?: string;
}

// ---------------------------------------------------------------------------
// Segurança e saída
// ---------------------------------------------------------------------------

export type Role = 'ADMIN' | 'MANAGER' | 'WORKER';

/** Derivado EXCLUSIVAMENTE do JWT. Nunca do corpo da requisição. */
export interface SecurityContext {
  tenantId: string; // req.user.company
  userId: string; // req.user.id
  role: Role; // req.user.role
}

export interface ColumnAnnotation {
  title: string;
  type: 'string' | 'number' | 'time';
  format: string | null;
}

export interface CompiledQuery {
  collection: string;
  pipeline: PipelineStage[];
  annotation: Record<string, ColumnAnnotation>;
}

export interface QueryResult {
  data: Array<Record<string, unknown>>;
  annotation: Record<string, ColumnAnnotation>;
  meta: {
    cached: boolean;
    durationMs: number;
    rowCount: number;
    pipeline?: PipelineStage[]; // exposto só fora de produção
  };
}

/** Erro de validação/compilação com detalhe amigável. */
export class QueryError extends Error {
  constructor(
    public readonly kind: string,
    message: string,
    public readonly available?: string[],
  ) {
    super(message);
    this.name = 'QueryError';
  }
}
