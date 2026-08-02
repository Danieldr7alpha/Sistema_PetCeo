# CEO Pet AI

MVP SaaS web para pet shops pequenos e medios. O sistema inclui login, separacao por empresa, clientes, pets, agenda, produtos, servicos, mensalistas, caixa, historico e dashboard com recomendacoes por regras.

## Requisitos

- Node.js 20 ou superior
- npm 10 ou superior
- Docker Desktop, recomendado para subir o PostgreSQL automaticamente
- PostgreSQL local, caso nao use Docker
- `pg_dump`, necessario apenas para backup do banco

## Inicio rapido no Windows

Use o arquivo [Iniciar CEO Pet AI.bat](</c:/Users/Daniel/Desktop/Sistema_PetCeo/Iniciar CEO Pet AI.bat:1>) na raiz do projeto.

Ao dar dois cliques, ele executa:

- valida os arquivos de ambiente sem exibir credenciais
- instala dependencias com `npm install`, se `node_modules` nao existir
- evita iniciar processos duplicados nas portas 3333 e 5173
- inicia backend e frontend separadamente
- abre `http://localhost:5173` no navegador
- grava diagnosticos na pasta `logs`

O inicializador nao executa `prisma db push`, migrations ou seed. Para atualizar
intencionalmente o schema, use `Atualizar Banco CEO Pet AI.bat`; o script testa a
conexao e pede confirmacao antes de executar `db:push`.

Login de teste (quando os dados iniciais estiverem instalados):

- E-mail: `admin@ceopet.ai`
- Senha: `admin123`

## Inicio por terminal

1. Instale dependencias:

```bash
npm install
```

2. Crie os arquivos de ambiente:

```bash
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env
```

3. Suba o PostgreSQL com Docker:

```bash
docker compose up -d postgres
```

4. Prepare o banco:

```bash
npm run setup
```

5. Inicie o sistema:

```bash
npm run dev
```

O frontend abre automaticamente em `http://localhost:5173`. A API roda em `http://localhost:3333`.

## Scripts principais

- `npm run dev`: inicia API e web juntos
- `npm run dev:api`: inicia apenas o backend
- `npm run dev:web`: inicia apenas o frontend e abre o navegador
- `npm run dev:web:launcher`: inicia o frontend sem abrir outra janela
- `npm run build`: compila backend e frontend
- `npm run setup`: gera Prisma Client, aplica schema no banco e executa seed
- `npm run db:generate`: gera Prisma Client
- `npm run db:push`: sincroniza o schema no banco local sem migration
- `npm run db:migrate`: cria uma nova migration em desenvolvimento
- `npm run db:deploy`: aplica migrations em servidor/producao
- `npm run db:seed`: recria dados iniciais de teste
- `npm run db:studio`: abre Prisma Studio
- `npm run db:backup`: gera backup SQL em `backups/`

## Banco de dados

O projeto usa PostgreSQL e Prisma. A configuracao local padrao esta em [apps/api/.env.example](</c:/Users/Daniel/Desktop/Sistema_PetCeo/apps/api/.env.example:1>):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ceo_pet_ai?schema=public"
```

Para gerar o banco local pela primeira vez:

```bash
npm run setup
```

Para criar uma migration nova apos alterar [schema.prisma](</c:/Users/Daniel/Desktop/Sistema_PetCeo/apps/api/prisma/schema.prisma:1>):

```bash
npm run db:migrate
```

Para aplicar migrations em ambiente de servidor:

```bash
npm run db:deploy
```

## Supabase

O CEO Pet AI usa backend Express + Prisma. A forma segura e incremental de usar Supabase agora é conectar o backend ao PostgreSQL do Supabase por `DATABASE_URL`, preservando as telas e rotas existentes.

1. Crie um projeto no Supabase.
2. Em `Connect`, copie a connection string do **Session pooler** para uso local
   com Prisma. A conexao direta pode depender de IPv6 e falhar com `P1001` em
   redes que oferecem apenas IPv4.
3. Atualize `apps/api/.env`:

```env
DATABASE_URL="postgresql://USUARIO:SENHA@HOST-DO-POOLER:5432/postgres?schema=public"
JWT_SECRET="gere-um-segredo-forte"
WEB_ORIGIN="http://localhost:5173"
```

Se a senha tiver caracteres especiais, codifique-os para URL. Nunca envie ou
versione a string real. O arquivo efetivamente carregado pelo Prisma e pela API
e `apps/api/.env`.

4. Opcionalmente configure o client público do Supabase no frontend em `apps/web/.env`:

```env
VITE_API_URL="http://localhost:3333"
VITE_SUPABASE_URL="https://SEU-PROJETO.supabase.co"
VITE_SUPABASE_ANON_KEY="SUA_CHAVE_PUBLICA_ANON"
```

Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` no frontend nem com prefixo `VITE_`.

### Migrations Supabase

Arquivos criados:

- `supabase/config.toml`
- `supabase/migrations/202607130001_profiles_rls_customer_core.sql`
- `supabase/seed.sql`

Com Supabase CLI instalado/autenticado:

```bash
npm run supabase:link
npm run supabase:db:push
npm run db:generate
npm run db:push
npm run db:seed
```

O schema principal do app ainda é `apps/api/prisma/schema.prisma`. A migration Supabase adiciona `profiles`, helpers de RLS, índices e políticas para acesso direto via Supabase Auth futuro sem trocar a arquitetura atual.

### Informacoes que Daniel precisa fornecer

- `SUPABASE_PROJECT_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_PROJECT_REF`
- connection string PostgreSQL do Supabase para `DATABASE_URL`
- e-mail do primeiro ADMIN
- nome inicial da empresa
- documento da empresa, se for usar

Não forneça service role para uso no frontend.

## Backup do banco

Com PostgreSQL instalado no PATH, execute:

```bash
npm run db:backup
```

O arquivo `.sql` sera criado em `backups/`.

Para restaurar manualmente:

```bash
psql "postgresql://postgres:postgres@localhost:5432/ceo_pet_ai?schema=public" -f backups\NOME_DO_BACKUP.sql
```

## Atualizar dependencias

Para atualizar dentro das faixas permitidas pelo `package.json`:

```bash
npm update
```

Para ver pacotes desatualizados:

```bash
npm outdated
```

Para atualizar uma dependencia especifica:

```bash
npm install nome-do-pacote@latest -w apps/web
npm install nome-do-pacote@latest -w apps/api
```

Depois de atualizar, rode:

```bash
npm run build
```

## Publicacao futura

Fluxo recomendado para servidor:

1. Criar um banco PostgreSQL gerenciado ou em Docker.
2. Configurar `DATABASE_URL`, `JWT_SECRET`, `PORT` e `WEB_ORIGIN` no ambiente do backend.
3. Configurar `VITE_API_URL` no ambiente do frontend.
4. Instalar dependencias com `npm ci`.
5. Gerar Prisma Client com `npm run db:generate`.
6. Aplicar migrations com `npm run db:deploy`.
7. Compilar com `npm run build`.
8. Servir `apps/api/dist/server.js` com PM2, systemd ou container.
9. Publicar `apps/web/dist` em Nginx, CDN, Vercel, Netlify ou outro host estatico.

Em producao, use um `JWT_SECRET` forte e nunca publique arquivos `.env`.
