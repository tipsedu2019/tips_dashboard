insert into public.textbook_publisher_supplier_links (publisher_id, supplier_id, priority, is_primary)
select publisher.id, supplier.id, 1, true
from (values
  ('개념원리', '영주교육'),
  ('경선', '영주교육'),
  ('능률', '영주교육'),
  ('다락원', '대진서점(신진도서)'),
  ('동아출판', '우생당'),
  ('디딤돌', '영주교육'),
  ('마더텅', '한라서적'),
  ('메가스터디', '영주교육'),
  ('미래엔에듀', '현대서점'),
  ('백발백중', '우생당'),
  ('브릭스', '영주교육'),
  ('비상교육', '영주교육'),
  ('성지출판사', '영주교육'),
  ('수경출판', '영주교육'),
  ('수경출판사', '영주교육'),
  ('신사고', '영주교육'),
  ('쎄듀', '영주교육'),
  ('에듀플라자', '영주교육'),
  ('이투스', '영주교육'),
  ('입시플라이', '현대서점'),
  ('지학사', '영주교육'),
  ('진학사', '영주교육'),
  ('천재교육', '우생당'),
  ('투데이', '영주교육'),
  ('팁스서점', '팁스서점'),
  ('해커스', '영주교육'),
  ('희망출판', '영주교육'),
  ('EBS', '우생당'),
  ('csm', '영주교육')
) as source(publisher_name, supplier_name)
join public.textbook_publishers publisher on publisher.name = source.publisher_name
join public.textbook_suppliers supplier on supplier.name = source.supplier_name
on conflict (publisher_id, supplier_id) do update
set priority = excluded.priority,
    is_primary = excluded.is_primary,
    updated_at = now();
