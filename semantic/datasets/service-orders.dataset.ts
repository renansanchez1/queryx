import { Dataset } from '../../analytics.types';

/**
 * Dataset: ordens de serviço.
 * GRÃO: uma ordem de serviço (estado atual). Cada linha é uma OS.
 *
 * Permite: volume por status/tipo/contrato, SLA (previsto vs. concluído),
 * tempo médio de execução.
 * NÃO permite: histórico de transições de status (isso exigiria um dataset
 * de eventos com grão = uma mudança de status).
 */
export const serviceOrdersDataset: Dataset = {
  name: 'service_orders',
  collection: 'serviceorders', // confirme o nome real da collection no seu Mongo
  grain: 'uma ordem de serviço (estado atual)',
  tenantField: 'company',
  defaultTimeDimension: 'created',

  dimensions: {
    status: { title: 'Status', type: 'string', expr: 'status' },
    type_service: { title: 'Tipo de serviço', type: 'string', expr: 'type_service' },

    // Dimensões de tempo (o campo em si; o bucket vem da granularidade)
    created: { title: 'Data de criação', type: 'time', expr: 'created_at', format: 'date' },
    date_prev: { title: 'Previsão', type: 'time', expr: 'date_prev', format: 'date' },
    date_end: { title: 'Conclusão', type: 'time', expr: 'date_end', format: 'date' },

    // Dimensão com join: número do contrato via $lookup
    contract: {
      title: 'Contrato',
      type: 'string',
      expr: 'contract.num_contract',
      lookup: {
        from: 'contracts',
        localField: 'contract_id',
        foreignField: '_id',
        as: 'contract',
      },
    },
  },

  measures: {
    order_count: { kind: 'count', title: 'Ordens' },

    concluded_count: {
      kind: 'count',
      title: 'Concluídas',
      filter: { $eq: ['$status', 'CONCLUIDA'] },
    },

    cancelled_count: {
      kind: 'count',
      title: 'Canceladas',
      filter: { $eq: ['$status', 'CANCELADA'] },
    },

    // Concluídas dentro do prazo: date_end <= date_prev (ambos presentes)
    on_time_count: {
      kind: 'count',
      title: 'No prazo',
      filter: {
        $and: [
          { $eq: ['$status', 'CONCLUIDA'] },
          { $ne: ['$date_end', null] },
          { $ne: ['$date_prev', null] },
          { $lte: ['$date_end', '$date_prev'] },
        ],
      },
    },

    // Tempo médio de execução em dias (só para linhas com início e fim)
    avg_execution_days: {
      kind: 'avg',
      title: 'Tempo médio de execução (dias)',
      format: 'number',
      expr: {
        $cond: [
          {
            $and: [{ $ne: ['$date_init', null] }, { $ne: ['$date_end', null] }],
          },
          {
            $divide: [
              { $subtract: ['$date_end', '$date_init'] },
              1000 * 60 * 60 * 24,
            ],
          },
          null, // $avg ignora null
        ],
      },
    },

    // Medida derivada: taxa de conclusão = concluídas / total
    completion_rate: {
      kind: 'ratio',
      title: 'Taxa de conclusão',
      numerator: 'concluded_count',
      denominator: 'order_count',
      format: 'percent',
    },

    // Medida derivada: cumprimento de SLA = no prazo / concluídas
    sla_compliance: {
      kind: 'ratio',
      title: 'Cumprimento de SLA',
      numerator: 'on_time_count',
      denominator: 'concluded_count',
      format: 'percent',
    },
  },
};
