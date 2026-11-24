-- Optional identity-panel colors. Existing profiles continue using site colors.
alter table public.profiles
    add column border_color text check (border_color ~ '^#[0-9a-fA-F]{6}$'),
    add column text_color text check (text_color ~ '^#[0-9a-fA-F]{6}$');
