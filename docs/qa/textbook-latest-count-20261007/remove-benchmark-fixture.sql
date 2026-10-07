-- This file is used only in the owned, network-disabled synthetic container.
\set ON_ERROR_STOP on
begin;
delete from public.textbook_stock_counts where textbook_id::text like 'b7100000-%';
delete from public.textbook_stock_moves where textbook_id::text like 'b7100000-%';
delete from public.textbooks where id::text like 'b7100000-%';
commit;
