# LICITA+ Relatórios (queryx)

Microsserviço de relatórios do LICITA+. Um processo só entrega:

- **API** (NestJS) com uma camada semântica sobre o MongoDB da API principal: o
  cliente pede *o quê* (medidas, agrupamentos, período) e o serviço compila isso
  num aggregation pipeline, sempre isolado pela empresa do usuário;
- **front web** (React) com painel, biblioteca de relatórios, detalhe com
  gráficos e exportação CSV, e construtor de relatórios personalizados.

Um relatório novo é um JSON salvo no construtor — sem rota nova, sem deploy.

## Como funciona

```
Navegador ──(cookie httpOnly)──▶ queryx ──(Bearer)──▶ API principal  /auth/login, /auth/me
                                   │
                                   └──(driver nativo)──▶ MongoDB (mesmo banco da API)
```

- **Login:** o front envia CPF e senha para `POST /api/session/login`; o serviço
  faz o login na API principal e guarda o token num cookie httpOnly deste domínio.
  O JavaScript do navegador nunca vê o token, e não é preciso CORS entre o front e
  a API principal.
- **Cada requisição** é validada em `GET /auth/me` da API principal (cache de
  15s). Assim valem aqui, na hora, a revogação de sessão, a desativação de
  usuário e as permissões do RBAC.
- **Permissões** (catálogo da API principal): `report:read` para ver e executar
  relatórios; `report:manage` para criar, editar e excluir os personalizados.
- **Tenant:** a empresa vem sempre da sessão e entra no primeiro `$match` de toda
  consulta. Nada no corpo da requisição consegue trocá-la.

## Subindo no Railway

1. **Aplique o patch da API principal** (`api-principal-relatorios.patch`): ele
   cria as permissões `report:read`/`report:manage`, tira o `/auth/me` do rate
   limit por IP e deixa o host de escuta configurável. Faça o deploy da API.
2. **Crie um serviço** no mesmo projeto do Railway apontando para este
   repositório. O `railway.json` usa o `Dockerfile` e o healthcheck `/api/health`.
3. **Configure as variáveis** (veja `.env.example`):
   - `MONGODB_URI` — o mesmo banco da API principal;
   - `MAIN_API_URL` — pela rede privada: `http://<servico-api>.railway.internal:<PORT>`.
     Se o ambiente tiver rede privada só IPv6, defina `HOST=::` **na API principal**.
     A URL pública da API também funciona, mas aí o rate limit de login da API
     passa a contar todos os usuários como um IP só.
4. **Gere um domínio** para o serviço. Pronto: abra a URL e entre com o CPF e a
   senha do LICITA+.

Usuários ADMIN recebem as duas permissões no primeiro boot da API com o patch;
MANAGER recebe `report:read`. Ajuste por `PATCH /roles/:id/permissions`.

## Desenvolvimento

```bash
npm install && npm --prefix web install
cp .env.example .env         # aponte para um Mongo e para a API principal locais
npm run dev                   # API em http://localhost:3000
npm run dev:web               # front em http://localhost:5174 (proxy /api → 3000)
npm test                      # 67 testes
npm run build                 # dist/ (API) + web/dist (front)
```

Requer Node 22 e MongoDB 5.0+ (`$setWindowFields`, `$dateTrunc`).

## API

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| `POST` | `/api/session/login` | pública | Login (CPF e senha do LICITA+). Grava o cookie de sessão. |
| `GET` | `/api/session` | sessão | Usuário, empresa e se pode gerenciar relatórios. |
| `POST` | `/api/session/logout` | pública | Encerra a sessão deste navegador. |
| `POST` | `/api/analytics/query` | `report:read` | Executa uma QuerySpec. |
| `GET` | `/api/analytics/meta` | `report:read` | Catálogo: datasets, dimensões e medidas. |
| `GET` | `/api/reports` | `report:read` | Relatórios do sistema + os personalizados da empresa. |
| `GET` | `/api/reports/:id` | `report:read` | Um relatório. |
| `POST` | `/api/reports` | `report:manage` | Cria um relatório personalizado. |
| `PUT` | `/api/reports/:id` | `report:manage` | Edita um personalizado. |
| `DELETE` | `/api/reports/:id` | `report:manage` | Exclui um personalizado. |
| `GET` | `/api/health` | pública | Healthcheck (ping no MongoDB). |

Integrações podem usar `Authorization: Bearer <token da API principal>` em vez do
cookie (e `ALLOWED_ORIGINS` para CORS).

### Exemplo de consulta

```json
POST /api/analytics/query
{
  "dataset": "work_days",
  "dimensions": ["employee"],
  "measures": ["days_worked", "worked_hours", "overtime_hours"],
  "timeDimension": { "dimension": "day", "range": ["2026-09-01", "2026-09-30"] },
  "order": [["worked_hours", "desc"]]
}
```

Datas `YYYY-MM-DD` são dias no fuso `REPORTS_TIMEZONE`, com o fim inclusivo.

## Datasets

| Dataset | Collection | Uma linha é | Destaques |
|---|---|---|---|
| `work_days` | `timeentries` (derivado) | um dia trabalhado de um funcionário | horas trabalhadas, média diária, horas acima da jornada, primeira entrada/última saída |
| `time_entries` | `timeentries` | uma marcação de ponto | origem, ajustes e invalidações com autor e justificativa |
| `service_orders` | `serviceorders` | uma OS (estado atual) | concluídas, em aberto, em atraso, taxa de conclusão |
| `contracts` | `contracts` | um contrato | ativos, valor, vencimento em 90 dias, órgão |
| `licits` | `licits` | uma licitação | abertas, finalizadas, valor estimado |

**Jornada (`work_days`)** pareia cada entrada com a marcação seguinte do mesmo
funcionário; turnos que cruzam a meia-noite contam no dia em que começaram;
marcações invalidadas não entram e ajustadas entram com o horário ajustado.
"Horas acima da jornada" compara com `STANDARD_WORKDAY_MINUTES` (8h), não com a
escala contratada de cada pessoa.

### Como adicionar uma medida

Edite o dataset em `src/analytics/domain/semantic/datasets/`. Ela aparece na hora
no construtor e em `/api/analytics/meta`:

```typescript
reopened_count: {
  kind: "count",
  title: "Reabertas",
  format: "integer",
  filter: { $eq: ["$status", "REABERTA"] },
},
```

## Garantias do compilador (cobertas por testes)

1. O primeiro estágio de todo pipeline é um `$match` com a empresa da sessão.
2. Valores do usuário só entram como valores (nunca como expressão); texto de
   busca é escapado, sem regex do cliente.
3. Ratios são `SUM(num)/SUM(den)`, resolvidos no `$project` — nunca média de taxas.
4. `limit` tem teto (10.000) mesmo sem o cliente mandar.
5. Filtro em dimensão com join é recusado (mantém o `$match` indexável).
6. Joins em `users` trazem só o campo `name`.

## O que o mockup tinha e ainda não tem fonte de dados

Ficaram de fora, porque o banco não tem o dado: faltas e atrasos contra a escala
contratada, custo de mão de obra (folha e encargos), aderência a POPs aplicados,
marcações fora do perímetro (geolocalização), recortes por unidade e equipe,
envio agendado por e-mail e exportação em PDF/XLSX. A OS também não guarda data de
conclusão, então "concluídas no prazo" não é calculável — só atraso das abertas.

## Estrutura

```
src/
├── analytics/
│   ├── domain/              # engine puro: types, validation, engine/, semantic/ (catálogo)
│   ├── application/         # RunQuery, GetCatalog, port do executor
│   └── infrastructure/      # executor MongoDB, controller
├── reports/                 # relatórios do sistema (código) e personalizados (Mongo)
├── auth/                    # sessão (BFF), guard, adapter da API principal
├── config/                  # env validado no boot
└── http-setup.ts            # helmet/CSP, cookies, prefixo /api, serve o front
web/                         # front React (Vite)
```

## Testes

`npm test` roda 67 testes: invariantes do compilador, execução dos pipelines com
[mingo](https://github.com/kofrasa/mingo) sobre fixtures (pareamento de ponto,
fuso, ratios, joins, isolamento de tenant), validação, relatórios do sistema, o
adapter da API principal contra um servidor HTTP real e a API ponta a ponta.
O mingo não substitui um teste contra MongoDB real — rode um relatório de cada
dataset em homologação antes de liberar.
