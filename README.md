# Módulo Analytics

Camada semântica de relatórios. Substitui os endpoints fixos de `/reports` por
**um endpoint de consulta genérico** sobre um catálogo declarativo.

> Diferença em uma frase: em `/reports`, cada relatório novo é uma rota + PR +
> deploy. Aqui, um relatório novo é **outro JSON no mesmo endpoint**; e uma
> métrica nova é **editar um arquivo de catálogo**.

## Como plugar no app

Em `src/app.ts`, registre o router:

```typescript
import analyticsRoutes from './modules/analytics/analytics.routes';
app.use('/analytics', analyticsRoutes);
```

Nenhuma dependência nova. Usa Express, Mongoose e os middlewares
`auth.middleware` e `role.middleware` que já existem.

## Endpoints

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `POST` | `/analytics/query` | ADMIN, MANAGER | Executa uma QuerySpec. |
| `GET`  | `/analytics/meta`  | ADMIN, MANAGER | Catálogo: datasets, dimensões e medidas. |

## Exemplo

```bash
curl -X POST http://localhost:3000/analytics/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dataset": "service_orders",
    "measures": ["order_count", "sla_compliance"],
    "dimensions": ["contract"],
    "timeDimension": { "dimension": "created", "range": ["2026-06-01", "2026-06-30"] },
    "filters": [{ "dimension": "type_service", "operator": "equals", "values": ["limpeza"] }],
    "order": [["order_count", "desc"]],
    "limit": 50
  }'
```

Resposta:

```jsonc
{
  "data": [
    { "contract": "CT-2026-014", "order_count": 42, "sla_compliance": 0.83 }
  ],
  "annotation": {
    "contract":       { "title": "Contrato", "type": "string", "format": null },
    "order_count":    { "title": "Ordens", "type": "number", "format": "number" },
    "sla_compliance": { "title": "Cumprimento de SLA", "type": "number", "format": "percent" }
  },
  "meta": { "cached": false, "durationMs": 37, "rowCount": 1 }
}
```

## Estrutura

```
analytics/
├── analytics.types.ts          # Dataset, Measure, QuerySpec, SecurityContext...
├── analytics.routes.ts         # POST /query, GET /meta
├── analytics.controller.ts     # req.user (JWT) → SecurityContext
├── analytics.service.ts        # compila + roda o pipeline no Mongo
├── analytics.validation.ts     # valida a forma da QuerySpec
├── semantic/
│   ├── registry.ts             # índice de datasets
│   └── datasets/               # o catálogo (adicione métricas aqui)
│       ├── service-orders.dataset.ts
│       └── contracts.dataset.ts
├── engine/
│   ├── compile.ts              # QuerySpec → aggregation pipeline
│   ├── match.ts                # filtros + tempo + tenant + RLS
│   ├── group.ts                # medidas, ratios, distinct, buckets
│   └── annotation.ts           # metadados de tipo/formato
└── __tests__/
    └── invariants.ts           # tenant sempre presente, ratio não agregado 2x
```

## Datasets disponíveis (MVP)

| Dataset | Grão | Medidas-chave |
|---------|------|---------------|
| `service_orders` | uma ordem de serviço | `order_count`, `concluded_count`, `on_time_count`, `avg_execution_days`, `completion_rate`, `sla_compliance` |
| `contracts` | um contrato | `contract_count`, `active_count`, `total_value`, `avg_value` |
| `licits` | uma licitação | `licit_count`, `open_count`, `won_count`, `total_estimated`, `win_rate` |

## Como adicionar uma métrica

Edite o dataset. Exemplo — ordens em atraso em `service-orders.dataset.ts`:

```typescript
overdue_count: {
  kind: 'count',
  title: 'Em atraso',
  filter: {
    $and: [
      { $ne: ['$status', 'CONCLUIDA'] },
      { $lt: ['$date_prev', '$$NOW'] },
    ],
  },
},
```

Pronto. Já está disponível em `/analytics/query` e em `/analytics/meta`. Sem
rota nova, sem controller, sem deploy de endpoint.

## Garantias do compilador (cobertas em `__tests__/invariants.ts`)

1. **`company` em todo `$match`**, injetado do JWT — nunca do payload.
2. **Ratios são `SUM(num)/SUM(den)`**, resolvidos no `$project`. Nunca `AVG(rate)`.
3. **`limit` sempre com teto** (10.000), mesmo sem o cliente mandar.
4. **Valores do usuário nunca viram código** — só valor em `$match`/`$in`.
5. **Filtro em dimensão com join é rejeitado** (mantém o `$match` indexável).

