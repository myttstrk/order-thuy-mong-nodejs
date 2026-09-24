create table if not exists public.orders (
  order_code text primary key,
  order_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);

alter table public.orders enable row level security;

revoke all on public.orders from anon, authenticated;
grant all on public.orders to service_role;
