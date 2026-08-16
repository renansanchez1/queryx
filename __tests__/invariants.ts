import { compile } from '../engine/compile';
import { SecurityContext, QuerySpec, PipelineStage } from '../analytics.types';

const ctx: SecurityContext = { tenantId: '507f1f77bcf86cd799439011', userId: '507f191e810c19729de860ea', role: 'ADMIN' };
let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };
const findStage = (p: PipelineStage[], op: string) => p.find((s) => Object.keys(s)[0] === op) as any;

// Invariante 1: tenant presente em toda query, em qualquer dataset
for (const ds of ['service_orders', 'contracts', 'licits']) {
  const measures = ds === 'service_orders' ? ['order_count'] : ds === 'contracts' ? ['contract_count'] : ['licit_count'];
  const c = compile({ dataset: ds, measures } as QuerySpec, ctx);
  const match = findStage(c.pipeline, '$match').$match;
  const str = JSON.stringify(match);
  check(`[${ds}] company no $match`, str.includes('company') && str.includes('507f1f77bcf86cd799439011'));
}

// Invariante 2: ratio vira divide no project, e num/den não vazam pro output
const c = compile({ dataset: 'service_orders', measures: ['completion_rate'] } as QuerySpec, ctx);
const proj = findStage(c.pipeline, '$project').$project;
check('ratio: completion_rate usa $divide', JSON.stringify(proj.completion_rate).includes('$divide'));
check('ratio: numerador (concluded_count) NÃO no output', !('concluded_count' in proj));
const group = findStage(c.pipeline, '$group').$group;
check('ratio: numerador calculado no $group', 'concluded_count' in group && 'order_count' in group);

// Invariante 3: limit sempre tem teto
const c2 = compile({ dataset: 'licits', measures: ['licit_count'], limit: 999999 } as QuerySpec, ctx);
check('limit com teto (<=10000)', findStage(c2.pipeline, '$limit').$limit === 10000);

// Invariante 4: filtro em dimensão com lookup é rejeitado
let rejected = false;
try { compile({ dataset: 'service_orders', measures: ['order_count'], filters: [{ dimension: 'contract', operator: 'equals', values: ['x'] }] } as QuerySpec, ctx); }
catch { rejected = true; }
check('filtro em dimensão com join é rejeitado', rejected);

// Invariante 5: dataset/measure desconhecidos erram com lista disponível
let hasAvailable = false;
try { compile({ dataset: 'service_orders', measures: ['nao_existe'] } as QuerySpec, ctx); }
catch (e: any) { hasAvailable = Array.isArray(e.available) && e.available.length > 0; }
check('measure desconhecida retorna lista disponível', hasAvailable);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
