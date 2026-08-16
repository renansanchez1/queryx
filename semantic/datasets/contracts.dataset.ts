import { Dataset } from '../../analytics.types';

/**
 * Dataset: contratos.
 * GRÃO: um contrato. Cada linha é um contrato vinculado a uma licitação.
 */
export const contractsDataset: Dataset = {
  name: 'contracts',
  collection: 'contracts',
  grain: 'um contrato',
  tenantField: 'company',
  defaultTimeDimension: 'date_init',

  dimensions: {
    status: { title: 'Status', type: 'string', expr: 'status' },
    date_init: { title: 'Início', type: 'time', expr: 'date_init', format: 'date' },
    date_end: { title: 'Fim', type: 'time', expr: 'date_end', format: 'date' },

    licit: {
      title: 'Licitação',
      type: 'string',
      expr: 'licit.number_licit',
      lookup: {
        from: 'licits',
        localField: 'licit',
        foreignField: '_id',
        as: 'licit',
      },
    },
  },

  measures: {
    contract_count: { kind: 'count', title: 'Contratos' },
    active_count: {
      kind: 'count',
      title: 'Ativos',
      filter: { $eq: ['$status', 'ACTIVE'] },
    },
    total_value: {
      kind: 'sum',
      title: 'Valor total',
      field: 'price_contract',
      format: 'currency',
    },
    avg_value: {
      kind: 'avg',
      title: 'Valor médio',
      field: 'price_contract',
      format: 'currency',
    },
  },
};

/**
 * Dataset: licitações.
 * GRÃO: uma licitação (processo licitatório).
 */
export const licitsDataset: Dataset = {
  name: 'licits',
  collection: 'licits',
  grain: 'uma licitação',
  tenantField: 'company',

  dimensions: {
    status: { title: 'Status', type: 'string', expr: 'status' },
    modality: { title: 'Modalidade', type: 'string', expr: 'modality' },
    org: { title: 'Órgão', type: 'string', expr: 'org' },
  },

  measures: {
    licit_count: { kind: 'count', title: 'Licitações' },
    open_count: {
      kind: 'count',
      title: 'Abertas',
      filter: { $eq: ['$status', 'OPEN'] },
    },
    won_count: {
      kind: 'count',
      title: 'Fechadas',
      filter: { $eq: ['$status', 'CLOSED'] },
    },
    total_estimated: {
      kind: 'sum',
      title: 'Valor estimado total',
      field: 'value_estim',
      format: 'currency',
    },
    win_rate: {
      kind: 'ratio',
      title: 'Taxa de conversão',
      numerator: 'won_count',
      denominator: 'licit_count',
      format: 'percent',
    },
  },
};
