create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon;
grant execute on function public.is_admin() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view product images" on storage.objects;
create policy "Anyone can view product images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images');

drop policy if exists "Admins upload product images" on storage.objects;
create policy "Admins upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_admin()));

drop policy if exists "Admins update product images" on storage.objects;
create policy "Admins update product images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()))
  with check (bucket_id = 'product-images' and (select public.is_admin()));

drop policy if exists "Admins delete product images" on storage.objects;
create policy "Admins delete product images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, coalesce(new.email, ''), 'customer')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email, role)
select id, coalesce(email, ''), 'customer'
from auth.users
on conflict (id) do update set email = excluded.email;

create table if not exists public.products (
  id text primary key default gen_random_uuid()::text,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text not null check (category in ('Jewelry', 'Women''s Wear', 'Men''s Wear', 'Other')),
  price numeric(12, 2) not null check (price > 0),
  description text not null default '',
  tag text not null default '' check (char_length(tag) <= 40),
  image_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
  add column if not exists description text not null default '';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create table if not exists public.cart_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  quantity integer not null check (quantity between 1 and 99),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.wishlist_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create or replace function public.remove_saved_items_for_inactive_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.cart_items where product_id = new.id;
  delete from public.wishlist_items where product_id = new.id;
  return new;
end;
$$;

revoke all on function public.remove_saved_items_for_inactive_product() from public, anon, authenticated;
drop trigger if exists remove_saved_items_when_product_hidden on public.products;
create trigger remove_saved_items_when_product_hidden
  after update of is_active on public.products
  for each row
  when (old.is_active and not new.is_active)
  execute function public.remove_saved_items_for_inactive_product();

create sequence if not exists public.order_number_seq;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references auth.users (id) on delete restrict,
  idempotency_key uuid not null,
  public_tracking_token uuid not null default gen_random_uuid(),
  customer_email text not null,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 100),
  phone text not null check (char_length(btrim(phone)) between 7 and 25),
  address text not null check (char_length(btrim(address)) between 5 and 300),
  city text not null check (char_length(btrim(city)) between 2 and 100),
  state text not null check (char_length(btrim(state)) between 2 and 100),
  postal_code text not null check (postal_code ~ '^[0-9]{6}$'),
  payment_method text not null default 'cod' check (payment_method = 'cod'),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  total numeric(12, 2) not null check (total > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table public.orders
  add column if not exists public_tracking_token uuid;
update public.orders
set public_tracking_token = gen_random_uuid()
where public_tracking_token is null;
alter table public.orders
  alter column public_tracking_token set default gen_random_uuid(),
  alter column public_tracking_token set not null;

alter table public.orders alter column user_id drop not null;
create unique index if not exists orders_guest_request_idx
  on public.orders (idempotency_key)
  where user_id is null;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);
create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
alter table public.orders replica identity full;

create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id text references public.products (id) on delete set null,
  product_name text not null,
  image_url text,
  unit_price numeric(12, 2) not null check (unit_price > 0),
  quantity integer not null check (quantity between 1 and 99)
);

alter table public.order_items
  add column if not exists image_url text;
update public.order_items
set image_url = products.image_url
from public.products
where order_items.product_id = products.id
  and order_items.image_url is null;

create or replace function public.set_order_item_image_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.image_url is null and new.product_id is not null then
    select products.image_url into new.image_url
    from public.products
    where products.id = new.product_id;
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_set_image_url on public.order_items;
create trigger order_items_set_image_url
  before insert on public.order_items
  for each row execute function public.set_order_item_image_url();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.cart_items enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Users read their profile" on public.profiles;
create policy "Users read their profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Anyone reads active products" on public.products;
create policy "Anyone reads active products"
  on public.products for select to anon, authenticated
  using (is_active or (select public.is_admin()));

drop policy if exists "Admins manage products" on public.products;
create policy "Admins manage products"
  on public.products for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Users manage their cart" on public.cart_items;
create policy "Users manage their cart"
  on public.cart_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.products
      where products.id = cart_items.product_id and products.is_active
    )
  );

drop policy if exists "Users manage their wishlist" on public.wishlist_items;
create policy "Users manage their wishlist"
  on public.wishlist_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.products
      where products.id = wishlist_items.product_id and products.is_active
    )
  );

drop policy if exists "Customers and admins read orders" on public.orders;
create policy "Customers and admins read orders"
  on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Admins update order status" on public.orders;
create policy "Admins update order status"
  on public.orders for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins delete orders" on public.orders;
create policy "Admins delete orders"
  on public.orders for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists "Customers and admins read order items" on public.order_items;
create policy "Customers and admins read order items"
  on public.order_items for select to authenticated
  using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and (orders.user_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.profiles, public.cart_items, public.wishlist_items, public.orders, public.order_items to authenticated;
grant insert, update, delete on public.cart_items, public.wishlist_items to authenticated;
revoke insert, delete on public.orders from anon, authenticated;
revoke update on public.orders from anon, authenticated;
grant update (status) on public.orders to authenticated;
grant delete on public.orders to authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;

create or replace function public.get_order_status(
  p_order_number text,
  p_tracking_token uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select orders.status
  from public.orders
  where orders.order_number = p_order_number
    and orders.idempotency_key = p_tracking_token
  limit 1;
$$;

revoke all on function public.get_order_status(text, uuid) from public, anon, authenticated;
grant execute on function public.get_order_status(text, uuid) to anon, authenticated;

drop function if exists public.create_order(text, text, text, text, text, text, uuid, text, integer);
create or replace function public.create_order(
  p_full_name text,
  p_phone text,
  p_address text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_customer_email text,
  p_request_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := coalesce(nullif(auth.jwt() ->> 'email', ''), nullif(btrim(p_customer_email), ''));
  v_order_id uuid;
  v_order_number text;
  v_status text;
  v_tracking_token uuid;
  v_total numeric(12, 2);
  v_item_count integer;
begin
  if p_request_id is null then
    raise exception 'A valid order request ID is required.';
  end if;
  select id, order_number, total, status, public_tracking_token
    into v_order_id, v_order_number, v_total, v_status, v_tracking_token
  from public.orders
  where idempotency_key = p_request_id
    and (user_id = v_user_id or (user_id is null and v_user_id is null));
  if v_order_id is not null then
    return jsonb_build_object(
      'id', v_order_id,
      'order_number', v_order_number,
      'total', v_total,
      'status', v_status,
      'tracking_token', v_tracking_token
    );
  end if;

  if v_email is null then
    raise exception 'Enter a valid email address.';
  end if;
  if char_length(v_email) > 254 or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid email address.';
  end if;
  if char_length(btrim(coalesce(p_full_name, ''))) not between 2 and 100
    or char_length(btrim(coalesce(p_phone, ''))) not between 7 and 25
    or char_length(btrim(coalesce(p_address, ''))) not between 5 and 300
    or char_length(btrim(coalesce(p_city, ''))) not between 2 and 100
    or char_length(btrim(coalesce(p_state, ''))) not between 2 and 100
    or coalesce(p_postal_code, '') !~ '^[0-9]{6}$' then
    raise exception 'Enter a valid name, phone number, delivery address, city, state, and six-digit PIN code.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Your bag must contain a list of products.';
  end if;
  if jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Your bag is empty or contains too many products.';
  end if;
  select count(*) into v_item_count from jsonb_array_elements(p_items) as item(value);
  if exists (
    select 1
    from jsonb_array_elements(p_items) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or coalesce(item.value ->> 'product_id', '') = ''
      or coalesce(item.value ->> 'quantity', '') !~ '^[1-9][0-9]?$'
  ) or (
    select count(distinct item.value ->> 'product_id')
    from jsonb_array_elements(p_items) as item(value)
  ) <> v_item_count then
    raise exception 'Your bag contains invalid product details.';
  end if;

  perform products.id
  from jsonb_array_elements(p_items) as item(value)
  join public.products on products.id = item.value ->> 'product_id' and products.is_active
  for share of products;

  select coalesce(sum(products.price * (item.value ->> 'quantity')::integer), 0)
    into v_total
  from jsonb_array_elements(p_items) as item(value)
  join public.products on products.id = item.value ->> 'product_id'
  where products.is_active;
  if v_total <= 0 or (
    select count(*)
    from jsonb_array_elements(p_items) as item(value)
    join public.products on products.id = item.value ->> 'product_id' and products.is_active
  ) <> v_item_count then
    raise exception 'Your bag contains a product that is no longer available.';
  end if;

  v_order_number := 'EUMI-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' ||
    lpad(nextval('public.order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, user_id, idempotency_key, customer_email, full_name, phone,
    address, city, state, postal_code, payment_method, total
  ) values (
    v_order_number, v_user_id, p_request_id, v_email, btrim(p_full_name), btrim(p_phone),
    btrim(p_address), btrim(p_city), btrim(p_state), btrim(p_postal_code), 'cod', v_total
  )
  on conflict do nothing
  returning id, public_tracking_token into v_order_id, v_tracking_token;

  if v_order_id is null then
    select id, order_number, total, status, public_tracking_token
      into v_order_id, v_order_number, v_total, v_status, v_tracking_token
    from public.orders
    where idempotency_key = p_request_id
      and (user_id = v_user_id or (user_id is null and v_user_id is null));
    if v_order_id is null then
      raise exception 'Could not safely confirm this order. Please try again.';
    end if;
    return jsonb_build_object(
      'id', v_order_id,
      'order_number', v_order_number,
      'total', v_total,
      'status', v_status,
      'tracking_token', v_tracking_token
    );
  end if;

  insert into public.order_items (order_id, product_id, product_name, image_url, unit_price, quantity)
  select v_order_id, products.id, products.name, products.image_url, products.price, (item.value ->> 'quantity')::integer
  from jsonb_array_elements(p_items) as item(value)
  join public.products on products.id = item.value ->> 'product_id' and products.is_active;

  return jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number,
    'total', v_total,
    'status', 'pending',
    'tracking_token', v_tracking_token
  );
end;
$$;

revoke all on function public.create_order(text, text, text, text, text, text, text, uuid, jsonb) from public;
grant execute on function public.create_order(text, text, text, text, text, text, text, uuid, jsonb) to anon, authenticated;

insert into public.products (id, name, category, price, description, tag, image_url)
values
  ('sunday-tote', 'The Sunday Tote', 'Women''s Wear', 3199, 'A roomy everyday tote for market mornings, errands, and all the little things you like to keep close.', 'BEST LOVED', 'photo-1590874103328-eac38a683ce7'),
  ('ceramic-mug', 'Everyday Ceramic Mug', 'Other', 1999, 'A simple ceramic mug for slow coffee, warm tea, and a quieter start to the day.', 'A LITTLE FAVORITE', 'photo-1514228742587-6b1558fcca3d'),
  ('soft-days-candle', 'Soft Days Candle', 'Other', 2699, 'Bring a softer glow to your evening with a candle made for unhurried moments at home.', '', 'photo-1603006905003-be475563bc59'),
  ('weekend-knit', 'Weekend Knit', 'Women''s Wear', 6199, 'An easy, comfortable knit layer for weekend plans and cooler everyday moments.', 'JUST IN', 'photo-1576566588028-4147f3842f27'),
  ('little-bloom-vase', 'Little Bloom Vase', 'Other', 2499, 'A lovely home for fresh stems or a single garden bloom, made to brighten a small corner.', '', 'photo-1578500494198-246f612d3b3d'),
  ('slow-morning-journal', 'Slow Morning Journal', 'Other', 1499, 'A little space for your lists, thoughts, plans, and the ideas that arrive with a slow morning.', '', 'photo-1531346878377-a5be20888e57'),
  ('sunday-market-bag', 'Sunday Market Bag', 'Women''s Wear', 3499, 'A versatile carryall for market finds, daily essentials, and easy days out.', '', 'photo-1544816155-12df9643f363'),
  ('daily-trinket-tray', 'The Daily Trinket Tray', 'Other', 2199, 'Keep your everyday jewelry and little keepsakes together in a thoughtful catch-all tray.', 'MADE WITH CARE', 'photo-1490312278390-ab64016e0aa9')
on conflict (id) do update
set description = excluded.description
where public.products.description = '';

do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.products;
  exception
    when duplicate_object then null;
  end;
end;
$$;
