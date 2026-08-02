-- CEO Pet AI - preparação Supabase incremental.
-- A aplicação atual usa Express + Prisma. Estas migrations adicionam estruturas Supabase
-- compatíveis sem recriar a arquitetura nem expor service_role no frontend.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id text,
  name text not null,
  role text not null default 'EMPLOYEE' check (role in ('ADMIN', 'EMPLOYEE')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.current_company_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select company_id
  from public.profiles
  where id = auth.uid()
    and active = true
  limit 1
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and active = true
  limit 1
$$;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own_company on public.profiles;
create policy profiles_select_own_company on public.profiles
for select to authenticated
using (company_id = public.current_company_id() or id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'Company',
    'User',
    'Customer',
    'Pet',
    'CustomerHistory',
    'Service',
    'ServiceCategory',
    'Product',
    'ProductCategory',
    'ProductBrand',
    'Supplier',
    'MembershipPlan',
    'CustomerMembership',
    'Appointment',
    'Sale',
    'SaleItem',
    'SalePayment',
    'CashSession',
    'CashMovement',
    'PreSale',
    'PreSaleItem',
    'InternalCodeCounter'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
    end if;
  end loop;
end;
$$;

-- Políticas para tabelas com coluna companyId no schema Prisma atual.
-- A conexão backend via Prisma continua responsável por validar o JWT atual.
-- Estas políticas protegem acesso direto via Supabase Auth/anon quando usado futuramente.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'User',
    'Customer',
    'Pet',
    'CustomerHistory',
    'Service',
    'ServiceCategory',
    'Product',
    'ProductCategory',
    'ProductBrand',
    'Supplier',
    'MembershipPlan',
    'CustomerMembership',
    'Appointment',
    'Sale',
    'SaleItem',
    'SalePayment',
    'CashSession',
    'CashMovement',
    'PreSale',
    'PreSaleItem',
    'InternalCodeCounter'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists %I on public.%I', lower(table_name) || '_company_select', table_name);
      execute format('drop policy if exists %I on public.%I', lower(table_name) || '_company_insert', table_name);
      execute format('drop policy if exists %I on public.%I', lower(table_name) || '_company_update', table_name);
      execute format('create policy %I on public.%I for select to authenticated using ("companyId" = public.current_company_id())', lower(table_name) || '_company_select', table_name);
      execute format('create policy %I on public.%I for insert to authenticated with check ("companyId" = public.current_company_id())', lower(table_name) || '_company_insert', table_name);
      execute format('create policy %I on public.%I for update to authenticated using ("companyId" = public.current_company_id()) with check ("companyId" = public.current_company_id())', lower(table_name) || '_company_update', table_name);
    end if;
  end loop;
end;
$$;

-- Tabela Company usa id como identificador da empresa no schema atual.
do $$
begin
  if to_regclass('public."Company"') is not null then
    drop policy if exists company_select_own on public."Company";
    create policy company_select_own on public."Company"
    for select to authenticated
    using (id = public.current_company_id());
  end if;
end;
$$;

create index if not exists profiles_company_id_idx on public.profiles(company_id);
create index if not exists profiles_role_idx on public.profiles(role);

do $$
begin
  if to_regclass('public."Customer"') is not null then
    create index if not exists customer_company_name_idx on public."Customer"("companyId", name);
    create index if not exists customer_company_cpf_idx on public."Customer"("companyId", cpf);
    create index if not exists customer_company_phone_idx on public."Customer"("companyId", phone);
    create index if not exists customer_company_internal_code_idx on public."Customer"("companyId", "internalCode");
  end if;
  if to_regclass('public."Pet"') is not null then
    create index if not exists pet_company_customer_idx on public."Pet"("companyId", "customerId");
    create index if not exists pet_company_name_idx on public."Pet"("companyId", name);
  end if;
end;
$$;
