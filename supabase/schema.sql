-- Rookgas: tabellen, toegangsregels en fotobucket voor de inventaris van rookkoepels en gasinstallaties.
-- Draait in hetzelfde Supabase-project als de veiligheidsrondes en de staalnamen, en raakt die gegevens niet aan.
-- Het gebruikt wel de bestaande toegangslijst "toegang" en de functie heeft_toegang() van de
-- veiligheidsrondes: wie daar toegang heeft, heeft ook toegang tot deze app.
-- Plak dit volledig in Supabase > SQL Editor en klik op Run. Opnieuw uitvoeren kan geen kwaad.

-- Veiligheidscheck: de toegangslijst van de veiligheidsrondes moet al bestaan.
do $$ begin
  if to_regprocedure('public.heeft_toegang()') is null then
    raise exception 'Functie public.heeft_toegang() ontbreekt. Voer eerst het schema van de veiligheidsrondes uit.';
  end if;
end $$;

-- Rookkoepels: locatie van de koepel (gang + verdiep) en van de bediening (lokaal + verdiep), elk met een foto.
-- Foto-kolommen bevatten het pad in de bucket "rookgas-fotos".
create table if not exists public.rookkoepels (
  id uuid primary key default gen_random_uuid(),
  gebouw text not null default '',
  code text not null default '',
  koepel_gang text not null default '',
  koepel_verdiep text not null default '',
  koepel_foto text,
  bediening_lokaal text not null default '',
  bediening_verdiep text not null default '',
  bediening_foto text,
  opmerking text not null default '',
  aangemaakt timestamptz not null default now(),
  gewijzigd timestamptz not null default now(),
  aangemaakt_door uuid default auth.uid()
);
create index if not exists rookkoepels_gebouw_idx on public.rookkoepels(gebouw, code);

-- Gasinstallaties: per installatie de onderdelen gasinstallatie, ketels, noodknop, gasklep en gasdetectie.
-- "onderdelen" is een JSON-object met per onderdeel een lijst van {lokaal, verdiep, opmerking, foto}.
create table if not exists public.gasinstallaties (
  id uuid primary key default gen_random_uuid(),
  gebouw text not null default '',
  code text not null default '',
  onderdelen jsonb not null default '{}'::jsonb,
  opmerking text not null default '',
  aangemaakt timestamptz not null default now(),
  gewijzigd timestamptz not null default now(),
  aangemaakt_door uuid default auth.uid()
);
create index if not exists gasinstallaties_gebouw_idx on public.gasinstallaties(gebouw, code);

alter table public.rookkoepels enable row level security;
alter table public.gasinstallaties enable row level security;

drop policy if exists "rookkoepels voor collega's" on public.rookkoepels;
create policy "rookkoepels voor collega's" on public.rookkoepels
  for all to authenticated using (public.heeft_toegang()) with check (public.heeft_toegang());
drop policy if exists "gasinstallaties voor collega's" on public.gasinstallaties;
create policy "gasinstallaties voor collega's" on public.gasinstallaties
  for all to authenticated using (public.heeft_toegang()) with check (public.heeft_toegang());

-- Foto's: aparte privé-bucket, enkel voor e-mailadressen in "toegang".
insert into storage.buckets (id, name, public) values ('rookgas-fotos', 'rookgas-fotos', false)
on conflict (id) do nothing;

drop policy if exists "rookgas fotos lezen" on storage.objects;
create policy "rookgas fotos lezen" on storage.objects for select to authenticated
  using (bucket_id = 'rookgas-fotos' and public.heeft_toegang());
drop policy if exists "rookgas fotos toevoegen" on storage.objects;
create policy "rookgas fotos toevoegen" on storage.objects for insert to authenticated
  with check (bucket_id = 'rookgas-fotos' and public.heeft_toegang());
drop policy if exists "rookgas fotos wijzigen" on storage.objects;
create policy "rookgas fotos wijzigen" on storage.objects for update to authenticated
  using (bucket_id = 'rookgas-fotos' and public.heeft_toegang());
drop policy if exists "rookgas fotos verwijderen" on storage.objects;
create policy "rookgas fotos verwijderen" on storage.objects for delete to authenticated
  using (bucket_id = 'rookgas-fotos' and public.heeft_toegang());

-- Live bijwerken wanneer een collega iets wijzigt (bv. foto genomen op gsm, meteen zichtbaar op PC).
do $$ begin
  alter publication supabase_realtime add table public.rookkoepels;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.gasinstallaties;
exception when duplicate_object then null; end $$;

-- Toegang voor een nieuwe collega (kleine letters):
-- insert into public.toegang (email) values ('naam@voorbeeld.be');
