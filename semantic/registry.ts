import { Dataset } from '../analytics.types';
import { serviceOrdersDataset } from './datasets/service-orders.dataset';
import { contractsDataset, licitsDataset } from './datasets/contracts.dataset';

/**
 * Registry: índice de datasets por nome.
 * Para adicionar uma nova área de relatório, crie o dataset e registre-o aqui.
 * NENHUM endpoint novo é necessário.
 */
const datasets: Dataset[] = [
  serviceOrdersDataset,
  contractsDataset,
  licitsDataset,
];

const byName = new Map<string, Dataset>(datasets.map((d) => [d.name, d]));

export const registry = {
  get(name: string): Dataset | undefined {
    return byName.get(name);
  },
  list(): Dataset[] {
    return datasets;
  },
};
