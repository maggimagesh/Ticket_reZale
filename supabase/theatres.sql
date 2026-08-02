-- Theatres within ~50 km of Chennai Central, with seat classes available at each cinema.

create table if not exists public.theatres (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text not null default '',
  distance_km numeric(5,1),
  seat_types text[] not null default array['Regular']::text[],
  created_at timestamptz not null default now(),
  constraint theatres_name_len check (char_length(trim(name)) >= 2)
);

alter table public.theatres
  add column if not exists distance_km numeric(5,1);

alter table public.theatres
  add column if not exists seat_types text[] not null default array['Regular']::text[];

create unique index if not exists theatres_name_unique
  on public.theatres (lower(name));

alter table public.theatres enable row level security;

comment on table public.theatres is
  'Cinemas within ~50 km of Chennai Central; seat_types drive the sell-form dropdown.';

truncate table public.theatres;

insert into public.theatres (name, area, distance_km, seat_types) values
  -- Single-screen / classic halls
  ('Albert Theatre, Egmore', 'Egmore', 1.5, array['Regular']),
  ('Ega Theatre, Kilpauk', 'Kilpauk', 3.0, array['Regular']),
  ('Sangam Cinemas, Kilpauk', 'Kilpauk', 3.5, array['Regular','Gold']),
  ('Devi Cineplex, Anna Salai', 'Anna Salai', 3.0, array['Regular','Gold']),
  ('Casino Theatre, Anna Salai', 'Anna Salai', 3.2, array['Regular']),
  ('Anna Cinemas, Mount Road', 'Anna Salai', 3.5, array['Regular','Gold']),
  ('Woodlands Theatre, Royapettah', 'Royapettah', 4.0, array['Regular']),
  ('National Theatre, Pondy Bazaar', 'T. Nagar', 6.0, array['Regular']),
  ('Udhayam Theatre, T. Nagar', 'T. Nagar', 6.5, array['Regular']),
  ('Lakshmi Theatre, Ambattur', 'Ambattur', 19.0, array['Regular']),
  ('Sri Murugan Cinemas, Ambattur', 'Ambattur', 19.5, array['Regular','Gold']),
  ('Gokulam Cinemas, Avadi', 'Avadi', 25.0, array['Regular','Gold']),
  ('Vetri Theatres, Chromepet', 'Chromepet', 22.0, array['Regular']),
  ('Kumaran Cinemas, Chromepet', 'Chromepet', 23.0, array['Regular']),
  ('Velan Theatres, Chromepet', 'Chromepet', 23.0, array['Regular']),
  ('Sri Sakthi Theatre, Chromepet', 'Chromepet', 23.5, array['Regular']),
  ('Arunachala Theatre, Tambaram', 'Tambaram', 28.0, array['Regular']),
  ('Varun Cinemas, Tambaram', 'Tambaram', 28.5, array['Regular','Gold']),
  ('Odiyan Mani Theatre, Thiruvottiyur', 'Thiruvottiyur', 15.0, array['Regular']),
  ('Sri Venkateswara Theatre A/C 4K, Guduvancheri', 'Guduvancheri', 37.0, array['Regular','Gold']),

  -- Mid multiplex
  ('Abirami Mega Mall, Purasaiwakkam', 'Purasaiwakkam', 4.5, array['Regular','Gold','Prime']),
  ('AGS Cinemas: T. Nagar', 'T. Nagar', 7.0, array['Regular','Gold','Prime','Recliner']),
  ('AGS Cinemas: Villivakkam', 'Villivakkam', 9.5, array['Regular','Gold','Prime']),
  ('AGS Cinemas: Adyar', 'Adyar', 12.0, array['Regular','Gold','Prime','Recliner']),
  ('AGS Cinemas: Maduravoyal', 'Maduravoyal', 14.5, array['Regular','Gold','Prime']),
  ('AGS Cinemas: OMR Sholinganallur', 'OMR', 24.0, array['Regular','Gold','Prime','Recliner']),
  ('AGS Cinemas: Navalur OMR', 'OMR', 28.0, array['Regular','Gold','Prime','Recliner']),
  ('Rohini Silver Screens, Koyambedu', 'Koyambedu', 9.0, array['Regular','Gold','Prime']),
  ('Rohini Theatre, Koyambedu', 'Koyambedu', 9.0, array['Regular','Gold']),
  ('Kamala Cinemas, Vadapalani', 'Vadapalani', 9.5, array['Regular','Gold','Prime']),
  ('S2 Cinemas: Perambur', 'Perambur', 11.5, array['Regular','Gold','Prime']),
  ('S2 Theyagaraja, Thiruvanmiyur', 'Thiruvanmiyur', 14.0, array['Regular','Gold','Prime']),
  ('Idreams Cinemas, Virugambakkam', 'Virugambakkam', 12.0, array['Regular','Gold','Prime']),
  ('Vivira Mall Cinemas, Navalur', 'OMR', 29.5, array['Regular','Gold','Prime']),
  ('Rakki Cinemas: OMR, Kelambakkam', 'OMR', 35.0, array['Regular','Gold','Prime']),
  ('Rakki RGB Laser 4K, Ambattur', 'Ambattur', 19.0, array['Regular','Gold','Prime']),
  ('Rakki Cinemas, Chromepet', 'Chromepet', 22.5, array['Regular','Gold','Prime']),
  ('Meenakshi Cinemas (Rakki) 4K, Avadi', 'Avadi', 24.0, array['Regular','Gold','Prime']),
  ('Murugan Cinemas PLF 4K, Ambattur', 'Ambattur', 18.5, array['Regular','Gold','Prime','Recliner']),
  ('Vidya Theatre 4K Dolby Atmos, Tambaram West', 'Tambaram', 27.0, array['Regular','Gold','Prime','Recliner']),
  ('Seven Screen''s Cinemas, Kilambakkam', 'Kilambakkam', 32.0, array['Regular','Gold','Prime']),
  ('MVR Cinemas Dolby Atmos 4K, Guduvancheri', 'Guduvancheri', 36.0, array['Regular','Gold','Prime']),
  ('Shree Radha Movie Park 4K, Red Hills', 'Red Hills', 26.0, array['Regular','Gold','Prime']),
  ('Mayajaal Multiplex, ECR Kanathur', 'ECR', 30.0, array['Regular','Gold','Prime','Recliner']),

  -- INOX / Cinepolis
  ('INOX: Chennai Citi Centre, Mylapore', 'Mylapore', 7.5, array['Regular','Gold','Prime','Recliner']),
  ('INOX National: Arcot Road, Virugambakkam', 'Virugambakkam', 12.5, array['Regular','Gold','Prime']),
  ('INOX: LUXE Phoenix Market City, Velachery', 'Velachery', 16.5, array['Regular','Gold','Prime','Recliner','IMAX · Recliner']),
  ('INOX: The Marina Mall, OMR Egatoor', 'OMR', 29.0, array['Regular','Gold','Prime','Recliner']),
  ('Cinepolis: BSR Mall, Thoraipakkam', 'OMR', 22.0, array['Regular','Gold','Prime','Recliner','4DX · Premium']),
  ('Cinepolis: Seahawk Mall, Porur', 'Porur', 17.5, array['Regular','Gold','Prime','Recliner']),

  -- PVR flagship / premium
  ('PVR: Sathyam, Royapettah', 'Royapettah', 3.5, array['Regular','Gold','Prime','Recliner']),
  ('PVR: Escape — Express Avenue Mall, Royapettah', 'Royapettah', 4.0, array['Regular','Gold','Prime','Recliner','IMAX · Recliner','4DX · Premium']),
  ('PVR: Ampa Mall, Aminjikarai', 'Aminjikarai', 8.0, array['Regular','Gold','Prime','Recliner']),
  ('PVR: Palazzo — Nexus Vijaya Mall, Vadapalani', 'Vadapalani', 10.0, array['Regular','Gold','Prime','Recliner','IMAX · Recliner']),
  ('PVR: VR Chennai, Anna Nagar', 'Anna Nagar', 11.0, array['Regular','Gold','Prime','Recliner','IMAX · Recliner']),
  ('PVR: Perambur — Spectrum Mall', 'Perambur', 11.0, array['Regular','Gold','Prime','Recliner']),
  ('PVR: Theyagaraja, Thiruvanmiyur', 'Thiruvanmiyur', 14.0, array['Regular','Gold','Prime','Recliner']),
  ('PVR: Grand Mall, Velachery', 'Velachery', 16.0, array['Regular','Gold','Prime','Recliner']),
  ('PVR: Aerohub, Meenambakkam', 'Meenambakkam', 18.0, array['Regular','Gold','Prime','Recliner']),
  ('PVR: Grand Galada, Pallavaram', 'Pallavaram', 21.0, array['Regular','Gold','Prime','Recliner']),
  ('PVR: Heritage RSL ECR, Uthandi', 'ECR', 28.0, array['Regular','Gold','Prime','Recliner']),
  ('PVR: SKLS Galaxy Mall, Red Hills', 'Red Hills', 25.0, array['Regular','Gold','Prime','Recliner']),

  -- 4DX specialty
  ('GK Cinemas RGB Laser SRL 4D, Porur', 'Porur', 17.0, array['Regular','Gold','Prime','Recliner','4DX · Premium']);
