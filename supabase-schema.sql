create table if not exists public.orders (
  order_code text primary key,
  order_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.items (
  item_id text primary key,
  item_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists items_updated_at_idx on public.items (updated_at desc);

-- 1. Index hỗ trợ tìm kiếm nhanh theo Phone và Email nằm trong order_data (Chống spam/Pending check)
create index if not exists orders_customer_phone_idx
  on public.orders (((order_data->'customer'->>'phone')));

create index if not exists orders_customer_email_idx
  on public.orders (((order_data->'customer'->>'email')));

-- 2. Index hỗ trợ truy vấn lọc theo trạng thái đơn hàng (PENDING, PAID, EXPIRED)
create index if not exists orders_status_idx
  on public.orders (((order_data->>'status')));

alter table public.orders enable row level security;
alter table public.items enable row level security;

revoke all on public.orders from anon, authenticated;
revoke all on public.items from anon, authenticated;
grant all on public.orders to service_role;
grant all on public.items to service_role;

-- 3. Tạo function và trigger tự động cập nhật updated_at mỗi khi có update row
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
  before update on public.orders
  for each row
  execute function public.handle_updated_at();

-- Optional: same trigger for items table if you want updated_at to also auto-refresh there
create or replace function public.handle_items_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_items_updated_at on public.items;
create trigger set_items_updated_at
  before update on public.items
  for each row
  execute function public.handle_items_updated_at();
