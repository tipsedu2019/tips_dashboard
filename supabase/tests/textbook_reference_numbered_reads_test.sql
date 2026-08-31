begin;
select no_plan();
select has_function('public','list_textbook_reference_page_v1',array['jsonb','text','integer','integer']::text[],'list_textbook_reference_page_v1 exists');
select has_function('public','list_textbook_class_reference_page_v1',array['jsonb','text','integer','integer']::text[],'list_textbook_class_reference_page_v1 exists');
select has_function('public','list_textbook_teacher_reference_page_v1',array['jsonb','text','integer','integer']::text[],'list_textbook_teacher_reference_page_v1 exists');
select has_function('public','list_textbook_location_reference_page_v1',array['jsonb','text','integer','integer']::text[],'list_textbook_location_reference_page_v1 exists');
select has_function('public','resolve_textbook_reference_v1',array['text','boolean','text','text']::text[],'resolve_textbook_reference_v1 exists');
select has_function('public','get_textbook_class_reference_v1',array['uuid']::text[],'get_textbook_class_reference_v1 exists');
select has_function('public','get_textbook_location_reference_v1',array['uuid']::text[],'get_textbook_location_reference_v1 exists');
select has_function('public','get_textbook_master_options_v1',array['jsonb']::text[],'get_textbook_master_options_v1 exists');
select has_function('public','get_textbook_inactive_cleanup_context_v1',array[]::text[],'get_textbook_inactive_cleanup_context_v1 exists');
-- Final physical fixture preflight: classes.student_ids is JSONB and teacher is
-- denormalized text; textbook taxonomy arrays are text[]; locations sort_order
-- is NOT NULL; teacher names are lower(name)-unique. Science fixtures satisfy
-- the actual five-key, subject/grade/array constraints and existing FK.
set local timezone='UTC';
set local statement_timeout='8s';
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수학의 정석 기본$score$,$score$수정$score$)-0.891::double precision),'<=',1e-14::double precision,'installed cmdk literal score 1');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$Basic Grammar$score$,$score$BGr$score$)-0.891::double precision),'<=',1e-14::double precision,'installed cmdk literal score 2');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$Basic Grammar$score$,$score$Garmmar$score$)-0.09000000000000001::double precision),'<=',1e-14::double precision,'installed cmdk literal score 3');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$A-B Grammar$score$,$score$a b$score$)-0.98970302969901::double precision),'<=',1e-14::double precision,'installed cmdk literal score 4');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$letter$score$,$score$leter$score$)-0.16983::double precision),'<=',1e-14::double precision,'installed cmdk literal score 5');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$AA letter$score$,$score$a letter$score$)-0.16998300000000002::double precision),'<=',1e-14::double precision,'installed cmdk literal score 6');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$😀A$score$,$score$😀$score$)-0.99::double precision),'<=',1e-14::double precision,'installed cmdk literal score 7');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$A😀B$score$,$score$😀B$score$)-0.17::double precision),'<=',1e-14::double precision,'installed cmdk literal score 8');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$𐐀A$score$,$score$𐐨$score$)-0.989901::double precision),'<=',1e-14::double precision,'installed cmdk literal score 9');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$İx$score$,$score$i$score$)-0.989901::double precision),'<=',1e-14::double precision,'installed cmdk literal score 10');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$x	Y-z$score$,$score$ y $score$)-0.1682495150488317::double precision),'<=',1e-14::double precision,'installed cmdk literal score 11');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$없음$score$,$score$ZZ$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 12');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$$score$,$score$$score$)-1::double precision),'<=',1e-14::double precision,'installed cmdk literal score 13');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$abc$score$,$score$$score$)-0.99::double precision),'<=',1e-14::double precision,'installed cmdk literal score 14');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$$score$,$score$a$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 15');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$r학수 ab-b😀 -/😀br $score$,$score$수/r$score$)-0.025595786333888097::double precision),'<=',1e-14::double precision,'installed cmdk literal score 16');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$학-학😀b수 😀학- r/r 수$score$,$score$학수학$score$)-0.02838291150778517::double precision),'<=',1e-14::double precision,'installed cmdk literal score 17');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$r학aArb-A수Aa학rAr/$score$,$score$수Aa$score$)-0.1683::double precision),'<=',1e-14::double precision,'installed cmdk literal score 18');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$A수/수 수br학ab수A수ba$score$,$score$A수b$score$)-0.891::double precision),'<=',1e-14::double precision,'installed cmdk literal score 19');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수 -/수 😀학rb😀Aa a학$score$,$score$aba$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 20');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$A😀/😀 a/abr/a학-학😀$score$,$score$ rA$score$)-0.02279510230306357::double precision),'<=',1e-14::double precision,'installed cmdk literal score 21');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수 aAaArb😀brA😀/r/$score$,$score$-b수$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 22');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$학-/rA-brbab-학수b-$score$,$score$학😀A$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 23');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수학수학a/- - a/- 수학$score$,$score$수학😀$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 24');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$/r/a 😀A😀 😀학r학😀Ar$score$,$score$학r $score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 25');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$r학rb😀학😀A😀 -학- - $score$,$score$😀ba$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 26');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$b수학r/a 수/수/a 😀b😀$score$,$score$A😀 $score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 27');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$😀b-b😀/😀/😀 a/-/r $score$,$score$r r$score$)-0.08000000000000002::double precision),'<=',1e-14::double precision,'installed cmdk literal score 28');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$학-Aa학r rAab-/r/r$score$,$score$ r학$score$)-0.016828317000000002::double precision),'<=',1e-14::double precision,'installed cmdk literal score 29');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$rba -/ab수b😀학수/수 $score$,$score$aA수$score$)-0.10770122880000002::double precision),'<=',1e-14::double precision,'installed cmdk literal score 30');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$/-Aab수Arb- rb수 a$score$,$score$학😀b$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 31');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$-b수학😀b-A수Ar학r ab$score$,$score$-ba$score$)-0.8909109000000001::double precision),'<=',1e-14::double precision,'installed cmdk literal score 32');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$ 😀 -b수ArA-AaAr학a$score$,$score$A수학$score$)-0.016712542841538697::double precision),'<=',1e-14::double precision,'installed cmdk literal score 33');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$r/수bab수학수 -학😀 -b$score$,$score$ab😀$score$)-0.028439762593208996::double precision),'<=',1e-14::double precision,'installed cmdk literal score 34');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$/-학r/-baAr/a학ab-$score$,$score$b-A$score$)-0.09899010000000001::double precision),'<=',1e-14::double precision,'installed cmdk literal score 35');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$aAr 수b-학r학😀 😀학-b$score$,$score$수b-$score$)-0.891::double precision),'<=',1e-14::double precision,'installed cmdk literal score 36');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$학- 😀AaA-br학-baba$score$,$score$/-학$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 37');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$a/r/a rbrAa학r학😀b$score$,$score$수b😀$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 38');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$/😀b수b😀학abrba r학😀$score$,$score$A수학$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 39');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$aAr 수/a학a aA😀/- $score$,$score$😀br$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 40');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$b-/- rAaA수ArA😀b-$score$,$score$/-학$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 41');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$-b수/수학abrA-A- 수학$score$,$score$😀/수$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 42');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$/rA😀학수 😀 ab-ArAr$score$,$score$학수b$score$)-0.02846823082403303::double precision),'<=',1e-14::double precision,'installed cmdk literal score 43');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수학-학-학😀/r학😀 😀 수/$score$,$score$수b-$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 44');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$/r학r/rA수ba학😀 수학수$score$,$score$/- $score$)-0.099::double precision),'<=',1e-14::double precision,'installed cmdk literal score 45');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수/a학😀 a -A-A수b수학$score$,$score$a 수$score$)-0.1512882678071853::double precision),'<=',1e-14::double precision,'installed cmdk literal score 46');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$b-/수학rA-학수b😀 aAa$score$,$score$b-학$score$)-0.891::double precision),'<=',1e-14::double precision,'installed cmdk literal score 47');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$r/rA수b😀 ab-학😀A😀A$score$,$score$수ba$score$)-0.15147000000000002::double precision),'<=',1e-14::double precision,'installed cmdk literal score 48');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$/rA-b수/aAr/rb-/-$score$,$score$/r/$score$)-0.890109::double precision),'<=',1e-14::double precision,'installed cmdk literal score 49');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수 수A😀학rbrA😀학a ab$score$,$score$-A수$score$)-0.016828317000000002::double precision),'<=',1e-14::double precision,'installed cmdk literal score 50');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$/a abr/r a r학a학-$score$,$score$b-A$score$)-0.028519548039080654::double precision),'<=',1e-14::double precision,'installed cmdk literal score 51');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$😀 😀b😀br/😀 수/rb😀 $score$,$score$-학a$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 52');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$/-/r학ab😀br 😀/수A수$score$,$score$학-A$score$)-0.004814968046546638::double precision),'<=',1e-14::double precision,'installed cmdk literal score 53');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$a/😀/수b😀 😀b- 수 ab$score$,$score$수학수$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 54');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$ a학ab수brA-학r/-/-$score$,$score$ 😀 $score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 55');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수/-학r -br/a/수b😀A$score$,$score$rA😀$score$)-0.02281792022328685::double precision),'<=',1e-14::double precision,'installed cmdk literal score 56');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$ 😀/수 -A수학rb- 😀학😀$score$,$score$brA$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 57');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$😀/수AaA😀/- rArA-b$score$,$score$rA😀$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 58');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$ 😀b-학aArb-b수ArAr$score$,$score$b-학$score$)-0.1683::double precision),'<=',1e-14::double precision,'installed cmdk literal score 59');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$r학a/😀/수A수Aa/r/aA$score$,$score$-ba$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 60');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$ -Aa 😀학r학a학수 a학a$score$,$score$ 수A$score$)-0.14979715469377447::double precision),'<=',1e-14::double precision,'installed cmdk literal score 61');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수/수b수b-/rA😀/😀b수b$score$,$score$r학a$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 62');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$학a a학a 😀ba학수 rb😀$score$,$score$A- $score$)-0.08909109000000001::double precision),'<=',1e-14::double precision,'installed cmdk literal score 63');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$- -/r학😀/r/😀학r학-학$score$,$score$a/a$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 64');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$ -A😀학r/a학a a학a/수$score$,$score$/😀/$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 65');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$-babrAa r 수br/😀b$score$,$score$-b😀$score$)-0.792::double precision),'<=',1e-14::double precision,'installed cmdk literal score 66');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$Arb😀A-/😀 r -A수A😀$score$,$score$b- $score$)-0.028348857974103418::double precision),'<=',1e-14::double precision,'installed cmdk literal score 67');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$😀A수 -/-A😀b-학-Aab$score$,$score$수 수$score$)-0.01683::double precision),'<=',1e-14::double precision,'installed cmdk literal score 68');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$A😀A수 rA😀/r/r/aAa$score$,$score$ -b$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 69');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$😀학a 😀AabrA😀 😀학ab$score$,$score$😀Aa$score$)-0.891::double precision),'<=',1e-14::double precision,'installed cmdk literal score 70');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$Ar/수b😀 😀b😀b수 수학a$score$,$score$A-b$score$)-0.028380073216634393::double precision),'<=',1e-14::double precision,'installed cmdk literal score 71');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$rAr학😀 수 수/r aba $score$,$score$😀 r$score$)-0.13464::double precision),'<=',1e-14::double precision,'installed cmdk literal score 72');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$학aA😀학aba a r 수 수$score$,$score$A😀 $score$)-0.028496727551584614::double precision),'<=',1e-14::double precision,'installed cmdk literal score 73');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$a/😀 수학수A수A😀학수A수/$score$,$score$-br$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 74');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$Arb- 수/a학a학-/- r$score$,$score$b-A$score$)-0.13462653600000002::double precision),'<=',1e-14::double precision,'installed cmdk literal score 75');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$rbr학r/😀/😀/수b😀학r $score$,$score$- a$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 76');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$ -b😀/😀/r학수학a a학😀$score$,$score$bab$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 77');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수A-학rb😀 r/수baArA$score$,$score$수/-$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 78');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$A😀 -b수/ab수/😀 r/-$score$,$score$b😀b$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 79');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수b- 수 aArba학수A😀학$score$,$score$rb수$score$)-0.028553806611::double precision),'<=',1e-14::double precision,'installed cmdk literal score 80');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$Aab수A😀A😀A수b😀/😀b😀$score$,$score$ - $score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 81');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$ab수br학aA수/수 😀A😀A$score$,$score$r r$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 82');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$b😀A수b😀b😀b-학😀brA-$score$,$score$학😀b$score$)-0.891::double precision),'<=',1e-14::double precision,'installed cmdk literal score 83');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$aA😀b- 😀학r/😀학수A수b$score$,$score$abr$score$)-0.028382911507785172::double precision),'<=',1e-14::double precision,'installed cmdk literal score 84');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$ r/a 수 수/a/😀b-A-$score$,$score$/r학$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 85');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$r/😀 -A수 수/수 rAr학$score$,$score$😀/r$score$)-0.12045075921829694::double precision),'<=',1e-14::double precision,'installed cmdk literal score 86');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$brA- ab-학a 😀학-/수$score$,$score$b-/$score$)-0.8002169721998101::double precision),'<=',1e-14::double precision,'installed cmdk literal score 87');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$r -/수Arba/a 수학rA$score$,$score$수/😀$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 88');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$학a/r a r 😀/- -/수$score$,$score$학a $score$)-0.891::double precision),'<=',1e-14::double precision,'installed cmdk literal score 89');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수학aArb-학😀A수/r/-A$score$,$score$수A😀$score$)-0.028439762593208996::double precision),'<=',1e-14::double precision,'installed cmdk literal score 90');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$ -A수b-/rA😀학rb😀b-$score$,$score$br $score$)-0.02291045910579213::double precision),'<=',1e-14::double precision,'installed cmdk literal score 91');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$수b수br학-b- 😀br/수학$score$,$score$-/a$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 92');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$b-/😀/😀학ab수/-학수br$score$,$score$ArA$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 93');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$😀/😀/ab😀 -학-학r 수학$score$,$score$-ba$score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 94');
select cmp_ok(abs(dashboard_private.textbook_reference_score_v1($score$/-학수 a/r/a r/😀/수$score$,$score$b- $score$)-0::double precision),'<=',1e-14::double precision,'installed cmdk literal score 95');
create function pg_temp.rid(n integer)returns uuid language sql immutable as $$select('4d000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.rf(extra jsonb default '{}')returns jsonb language sql immutable as $$select '{"search":"","selectedFilters":{}}'::jsonb||extra$$;
create function pg_temp.wire(method text,input jsonb,data jsonb)returns text language sql stable as $$select 'TASK4_WIRE '||jsonb_build_object('method',method,'input',input,'data',data,'actorId',auth.uid())::text$$;
create temp table sends_before as select(select count(*)from dashboard_private.notification_events)events,(select count(*)from dashboard_private.notification_event_fanout_jobs)jobs,(select count(*)from dashboard_private.notification_deliveries)deliveries;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.rid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','task4-'||n||'@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now()from generate_series(901,904)n;
insert into public.profiles(id,role,name,email)select pg_temp.rid(n),case n when 902 then'staff'when 903 then'teacher'else'admin'end,'합성 역할 '||n,'task4-'||n||'@example.invalid'from generate_series(901,904)n on conflict(id)do update set role=excluded.role;
insert into public.academic_subject_settings(subject,grade_levels)values('과학',array['고1','고2','고3'])on conflict(subject)do nothing;
insert into public.academic_subject_areas(subject,area_key,label,sort_order,is_active)values('과학','integrated_science','통합과학',10,true),('과학','physics','물리학',20,true)on conflict(subject,area_key)do update set is_active=true;
insert into public.textbook_publishers(id,name)select pg_temp.rid(3000+n),'설정 출판사 '||n from generate_series(1,121)n;
insert into public.textbook_suppliers(id,name)values(pg_temp.rid(4001),'외부 공급처'),(pg_temp.rid(4002),'팁스 서점');
insert into public.textbook_publisher_supplier_links(id,publisher_id,supplier_id,priority,is_primary)values(pg_temp.rid(4101),pg_temp.rid(3001),pg_temp.rid(4001),1,true),(pg_temp.rid(4102),pg_temp.rid(3001),pg_temp.rid(4002),0,false);
insert into public.textbooks(id,title,name,subject,status,publisher,publisher_id,category,sub_subject,school_level,grade_level,school_levels,grade_levels,price,sale_price,isbn13,barcode)
select pg_temp.rid(n),case n when 121 then'수학의 정석 기본'else'교재 '||n end,case n when 121 then'수학의 정석 기본'else'교재 '||n end,case when n%2=0 then'english'else'math'end,'active','legacy 출판사',pg_temp.rid(3001),'독해','독해','middle','m2',array['middle'],array['m2'],10001,10001,'978-'||n,'code-'||n from generate_series(1,121)n;
insert into public.textbooks(id,title,name,subject,status,publisher,category,sub_subject,school_level,grade_level,school_levels,grade_levels,sale_price)
select pg_temp.rid(500+n),'미사용 교재 '||n,'미사용 교재 '||n,'math','inactive','legacy 출판사','독해','독해','middle','m2',array['middle'],array['m2'],10000 from generate_series(1,111)n;
insert into public.textbooks(id,title,name,subject,status,school_level,grade_level,school_levels,grade_levels,sub_subject)values
(pg_temp.rid(130),'Basic Grammar','alias isbn','english','inactive','middle','m2',array['middle'],array['m2'],'문법'),
(pg_temp.rid(131),'Basic  Grammar','Basic  Grammar','english','active','middle','m2',array['middle'],array['m2'],'문법'),
(pg_temp.rid(132),'Basic-Grammar','Basic-Grammar','english','active','middle','m2',array['middle'],array['m2'],'문법'),
(pg_temp.rid(133),'Basic Grammar 개정','Basic Grammar 개정','english','active','middle','m2',array['middle'],array['m2'],'문법');
insert into public.classes(id,name,class_type,subject,grade,teacher,room,status,student_ids,schedule)select pg_temp.rid(1000+n),case n when 121 then'유일선택반'else'수업 '||n end,'regular','수학','중2','김 / 이·박|최',case n when 121 then'별 2'else'본 1'end,case when n%2=0 then'inactive'else'active'end,'["a","a","b"]','월 수'from generate_series(1,121)n;
insert into public.teacher_catalogs(id,name,is_visible)select pg_temp.rid(2000+n),case n when 121 then'가유일교사'else'교사 '||n end,n%2=0 from generate_series(1,121)n;
insert into public.textbook_inventory_locations(id,code,name,sort_order,is_active)select pg_temp.rid(5000+n),case n when 121 then'main'when 120 then'annex'else'loc-'||n end,case n when 119 then'유일창고'when 121 then'본관'when 120 then'별관'else'창고 '||n end,n,n%2=0 from generate_series(1,121)n;
insert into public.textbook_sub_subject_settings(id,subject,name,sort_order,is_visible)values(pg_temp.rid(6001),'math','미적분',1,false),(pg_temp.rid(6002),'math','분류 10',2,true),(pg_temp.rid(6003),'math','분류 2',3,true);
-- Restrictive, transaction-local fixture policies prove invoker RLS. Production
-- migration never creates or changes a policy or table privilege.
create policy task4_books on public.textbooks as restrictive for select to authenticated using((auth.uid()<>pg_temp.rid(903)or id<>pg_temp.rid(1))and(auth.uid()<>pg_temp.rid(904)or id in(pg_temp.rid(121),pg_temp.rid(501))));
create policy task4_classes on public.classes as restrictive for select to authenticated using(auth.uid()<>pg_temp.rid(903)or id<>pg_temp.rid(1001));
create policy task4_publishers on public.textbook_publishers as restrictive for select to authenticated using(auth.uid()<>pg_temp.rid(904)or id=pg_temp.rid(3001));
select ok(not has_table_privilege('authenticated','public.academic_subject_areas','select'),'science table direct access remains absent');
select ok(bool_and(p.provolatile='s'and not p.prosecdef and p.proconfig=array['search_path=""']),'nine public APIs are stable invokers with empty path')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname=any(array['list_textbook_reference_page_v1','list_textbook_class_reference_page_v1','list_textbook_teacher_reference_page_v1','list_textbook_location_reference_page_v1','resolve_textbook_reference_v1','get_textbook_class_reference_v1','get_textbook_location_reference_v1','get_textbook_master_options_v1','get_textbook_inactive_cleanup_context_v1']);
select ok(bool_and(has_function_privilege('authenticated',p.oid,'execute')and not has_function_privilege('anon',p.oid,'execute')),'authenticated-only exact public execute')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname=any(array['list_textbook_reference_page_v1','list_textbook_class_reference_page_v1','list_textbook_teacher_reference_page_v1','list_textbook_location_reference_page_v1','resolve_textbook_reference_v1','get_textbook_class_reference_v1','get_textbook_location_reference_v1','get_textbook_master_options_v1','get_textbook_inactive_cleanup_context_v1']);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(901),'role','authenticated')::text,true);
select is((public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',1,10)->>'totalCount')::integer,124,'all active books counted beyond100');
select is((select count(distinct row->>'value')::integer from generate_series(1,13)p cross join lateral jsonb_array_elements(public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',p,10)->'rows')row),124,'numbered pages have no duplicate or omission');
select is(public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',10,10)->'rows'->0->>'value',pg_temp.rid(91)::text,'page10 direct canonical book identity');
select is(public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',11,10)->'rows'->0->>'value',pg_temp.rid(101)::text,'page11 direct canonical book identity');
select is(public.list_textbook_location_reference_page_v1('{"search":""}','match-order',11,10)->'rows'->0->>'value',pg_temp.rid(5101)::text,'location page11 direct position');
select is(jsonb_array_length(public.list_textbook_class_reference_page_v1(pg_temp.rf(),'match-name',9,15)->'rows'),1,'class partial final15');
select is(jsonb_array_length(public.list_textbook_teacher_reference_page_v1('{"search":""}','match-name',7,20)->'rows'),5,'teacher partial final20 includes four signup-linked catalog rows');
create function pg_temp.measure_reference(label text,query text)returns setof text language plpgsql as $$declare started timestamptz:=clock_timestamp();result jsonb;elapsed double precision;begin execute query into result;elapsed:=extract(epoch from clock_timestamp()-started)*1000;return next cmp_ok(elapsed,'<',8000::double precision,label||' below8s');return next diag('TASK4_TIMING '||label||' milliseconds='||elapsed);end $$;
select * from pg_temp.measure_reference('book_first',$$select public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',1,10)$$);
select * from pg_temp.measure_reference('book_middle',$$select public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',7,10)$$);
select * from pg_temp.measure_reference('book_final',$$select public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',13,10)$$);
select * from pg_temp.measure_reference('book_search',$$select public.list_textbook_reference_page_v1(pg_temp.rf('{"search":"수정"}'),'match-title',1,10)$$);
select * from pg_temp.measure_reference('class_first',$$select public.list_textbook_class_reference_page_v1(pg_temp.rf(),'match-name',1,10)$$);
select * from pg_temp.measure_reference('class_middle',$$select public.list_textbook_class_reference_page_v1(pg_temp.rf(),'match-name',7,10)$$);
select * from pg_temp.measure_reference('class_final',$$select public.list_textbook_class_reference_page_v1(pg_temp.rf(),'match-name',13,10)$$);
select * from pg_temp.measure_reference('class_search',$$select public.list_textbook_class_reference_page_v1(pg_temp.rf('{"search":"유일선택반"}'),'match-name',1,10)$$);
select * from pg_temp.measure_reference('teacher_first',$$select public.list_textbook_teacher_reference_page_v1('{"search":""}','match-name',1,10)$$);
select * from pg_temp.measure_reference('teacher_middle',$$select public.list_textbook_teacher_reference_page_v1('{"search":""}','match-name',7,10)$$);
select * from pg_temp.measure_reference('teacher_final',$$select public.list_textbook_teacher_reference_page_v1('{"search":""}','match-name',13,10)$$);
select * from pg_temp.measure_reference('teacher_search',$$select public.list_textbook_teacher_reference_page_v1('{"search":"가유일교사"}','match-name',1,10)$$);
select * from pg_temp.measure_reference('location_first',$$select public.list_textbook_location_reference_page_v1('{"search":""}','match-order',1,10)$$);
select * from pg_temp.measure_reference('location_middle',$$select public.list_textbook_location_reference_page_v1('{"search":""}','match-order',7,10)$$);
select * from pg_temp.measure_reference('location_final',$$select public.list_textbook_location_reference_page_v1('{"search":""}','match-order',13,10)$$);
select * from pg_temp.measure_reference('location_search',$$select public.list_textbook_location_reference_page_v1('{"search":"유일창고"}','match-order',1,10)$$);
select is((public.list_textbook_class_reference_page_v1(pg_temp.rf(),'match-name',1,10)->>'totalCount')::integer,121,'all classes including inactive counted');
select is((public.list_textbook_teacher_reference_page_v1('{"search":""}','match-name',1,10)->>'totalCount')::integer,125,'teacher names are complete including nonvisible flags and signup-linked rows');
select is((select array_agg(name order by name)from public.teacher_catalogs where profile_id=any(array[pg_temp.rid(901),pg_temp.rid(902),pg_temp.rid(903),pg_temp.rid(904)])),array['task4-901','task4-902','task4-903','task4-904'],'final handle_new_dashboard_user auth trigger supplies four additional teacher names');
select is((public.list_textbook_location_reference_page_v1('{"search":""}','match-order',1,10)->>'totalCount')::integer,121,'all authorized locations including inactive counted');
select is(public.list_textbook_location_reference_page_v1('{"search":"유일창고"}','match-order',1,10)->'defaultLocation'->>'id',pg_temp.rid(5121)::text,'main default independently resolved outside query and page');
select is(public.get_textbook_class_reference_v1(pg_temp.rid(1121))->'row'->>'inferredLocation','{"id": "'||pg_temp.rid(5120)::text||'", "code": "annex", "name": "별관"}','selected class infers annex independently');
select is((public.get_textbook_class_reference_v1(pg_temp.rid(1121))->'row'->>'enrolledStudentCount')::integer,3,'normalized roster retains duplicate listIds count');
select is(public.get_textbook_class_reference_v1(pg_temp.rid(1121))->'row'->>'defaultTeacherName','김','selected class first denormalized teacher');
select is(public.resolve_textbook_reference_v1('Basic Grammar',false,'management','')->'row'->'textbook'->>'id',pg_temp.rid(130)::text,'all reference exact normalized tie uses id not active first');
select is(public.resolve_textbook_reference_v1('Basic Grammar',true,'request','')->'row'->'textbook'->>'id',pg_temp.rid(131)::text,'active restriction precedes normalized resolution');
select is(public.resolve_textbook_reference_v1('BasicGrammar',true,'request','')->'row'->'textbook'->>'id',pg_temp.rid(131)::text,'nonempty compact alias resolves');
select is(public.resolve_textbook_reference_v1('Basic Grammar 개정',true,'request','')->'row'->'textbook'->>'id',pg_temp.rid(133)::text,'edition separated');
select is(public.resolve_textbook_reference_v1(pg_temp.rid(132)::text,false,'request','')->'row'->'textbook'->>'id',pg_temp.rid(132)::text,'exact textual id wins');
select is(public.resolve_textbook_reference_v1('수학의 정석 기본',true,'request','legacy')->'row'->>'configuredSupplierId','legacy','request never reads publisher supplier links');
select is(public.resolve_textbook_reference_v1('수학의 정석 기본',true,'management','legacy')->'row'->>'configuredSupplierId',pg_temp.rid(4001)::text,'management configured primary supplier precedes fallback');
select is(public.resolve_textbook_reference_v1('unknown',false,'request',''),'{"row":null}'::jsonb,'unknown reference absent not invented');
select is(public.get_textbook_class_reference_v1(pg_temp.rid(9999)),'{"row":null}'::jsonb,'unknown selected class absent');
select is(public.get_textbook_location_reference_v1(pg_temp.rid(9999)),'{"row":null}'::jsonb,'unknown selected location absent');
select is((public.list_textbook_reference_page_v1(pg_temp.rf('{"selectedFilters":{"subject":["unknown"]}}'),'match-title',1,10)->>'totalCount')::integer,0,'raw unknown existing facet filters to empty');
select is((public.list_textbook_reference_page_v1(pg_temp.rf('{"selectedFilters":{"subject":["unknown"]}}'),'match-title',1,10)->>'activeFilterCount')::integer,0,'unknown raw facet is not valid active count');
select is(public.list_textbook_reference_page_v1(pg_temp.rf('{"search":"수정"}'),'match-title',1,10)->'baseFilterGroups',public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',1,10)->'baseFilterGroups','search never scopes base facets');
select is(public.list_textbook_reference_page_v1(pg_temp.rf('{"search":"수정"}'),'match-title',1,10)->'visibleFilterGroups',public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',1,10)->'visibleFilterGroups','search never scopes peer facets');
select ok(not(public.get_textbook_master_options_v1('{"subject":"math","listSubject":"all","bulkSubject":"keep"}')->'subSubjectOptions'?'미적분'),'persisted hidden default remains hidden');
select is((public.get_textbook_master_options_v1('{"subject":"math","listSubject":"all","bulkSubject":"keep"}')->'counts'->>'publisherOptions')::integer,122,'all configured and active legacy publisher labels complete');
select is((public.get_textbook_inactive_cleanup_context_v1()->>'totalCount')::integer,112,'all inactive cleanup targets independent of current page');
select is(jsonb_array_length(public.get_textbook_inactive_cleanup_context_v1()->'targetIds'),112,'complete target ids never capped');
select is(jsonb_array_length(public.get_textbook_inactive_cleanup_context_v1()->'previewRows'),5,'preview bounded without losing authoritative remaining count');
select is((public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',100,10)->>'totalCount')::integer,124,'out of range retains full count');
select is(public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',100,10)->'rows','[]'::jsonb,'out of range retains empty rows');
select throws_ok($$select public.list_textbook_reference_page_v1('{"search":null,"selectedFilters":{}}','match-title',1,10)$$,'22023',null,'null search invalid');
select throws_ok($$select public.list_textbook_reference_page_v1('{"search":"","selectedFilters":{"subject":["수학","수학"]}}','match-title',1,10)$$,'22023',null,'repeated facet invalid');
select throws_ok($$select public.list_textbook_reference_page_v1('{"search":"","selectedFilters":{"unknown":[]}}','match-title',1,10)$$,'22023',null,'unknown facet key invalid');
select throws_ok($$select public.list_textbook_reference_page_v1('{"search":"","selectedFilters":{}}','match-title',0,10)$$,'22023',null,'page zero invalid');
select throws_ok($$select public.list_textbook_reference_page_v1('{"search":"","selectedFilters":{}}','match-title',1,30)$$,'22023',null,'page size invalid');
select throws_ok($$select public.list_textbook_reference_page_v1('{"search":"","selectedFilters":{}}','other',1,10)$$,'22023',null,'sort invalid');
select throws_ok($$select public.resolve_textbook_reference_v1('',true,'other','')$$,'22023',null,'unknown scope invalid');
select throws_ok($$select public.get_textbook_class_reference_v1(null)$$,'22023',null,'null selected class invalid');
select throws_ok($$select public.get_textbook_location_reference_v1(null)$$,'22023',null,'null selected location invalid');
select throws_ok($$select public.get_textbook_master_options_v1('{"subject":"math","listSubject":"all","bulkSubject":"all"}')$$,'22023',null,'invalid bulk scope');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(902),'role','authenticated')::text,true);
select lives_ok($$select public.get_textbook_inactive_cleanup_context_v1()$$,'staff complete cleanup read permitted');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(903),'role','authenticated')::text,true);
select is((public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',1,10)->>'totalCount')::integer,123,'teacher page honors actual restrictive RLS');
select is(public.resolve_textbook_reference_v1(pg_temp.rid(1)::text,false,'request',''),'{"row":null}'::jsonb,'selected book cannot bypass restrictive RLS');
select is(public.get_textbook_class_reference_v1(pg_temp.rid(1001)),'{"row":null}'::jsonb,'selected class cannot bypass restrictive RLS');
select throws_ok($$select public.resolve_textbook_reference_v1('',true,'management','')$$,'42501',null,'teacher denied management reference');
select throws_ok($$select public.get_textbook_master_options_v1('{"subject":"math","listSubject":"all","bulkSubject":"keep"}')$$,'42501',null,'teacher denied management metadata');
select throws_ok($$select public.get_textbook_inactive_cleanup_context_v1()$$,'42501',null,'teacher denied cleanup');
select diag(pg_temp.wire('listTextbookReferencePage','{"page":1,"pageSize":10,"sort":"match-title","filters":{"search":"수정","selectedFilters":{}}}',public.list_textbook_reference_page_v1(pg_temp.rf('{"search":"수정"}'),'match-title',1,10)));
select diag(pg_temp.wire('listTextbookClassReferencePage','{"page":1,"pageSize":10,"sort":"match-name","filters":{"search":"유일선택반","selectedFilters":{}}}',public.list_textbook_class_reference_page_v1(pg_temp.rf('{"search":"유일선택반"}'),'match-name',1,10)));
select diag(pg_temp.wire('listTextbookTeacherReferencePage','{"page":1,"pageSize":10,"sort":"match-name","filters":{"search":"가유일교사"}}',public.list_textbook_teacher_reference_page_v1('{"search":"가유일교사"}','match-name',1,10)));
select diag(pg_temp.wire('listTextbookLocationReferencePage','{"page":1,"pageSize":10,"sort":"match-order","filters":{"search":"유일창고"}}',public.list_textbook_location_reference_page_v1('{"search":"유일창고"}','match-order',1,10)));
select diag(pg_temp.wire('resolveTextbookReference','{"reference":"수학의 정석 기본","activeOnly":true,"scope":"request","fallbackSupplier":"legacy"}',public.resolve_textbook_reference_v1('수학의 정석 기본',true,'request','legacy')));
select diag(pg_temp.wire('resolveTextbookReference','{"reference":"unknown","activeOnly":false,"scope":"request","fallbackSupplier":""}',public.resolve_textbook_reference_v1('unknown',false,'request','')));
select diag(pg_temp.wire('getTextbookClassReference',to_jsonb(pg_temp.rid(1121)),public.get_textbook_class_reference_v1(pg_temp.rid(1121))));
select diag(pg_temp.wire('getTextbookLocationReference',to_jsonb(pg_temp.rid(5121)),public.get_textbook_location_reference_v1(pg_temp.rid(5121))));
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(904),'role','authenticated')::text,true);
select diag(pg_temp.wire('resolveTextbookReference','{"reference":"수학의 정석 기본","activeOnly":true,"scope":"management","fallbackSupplier":"legacy"}',public.resolve_textbook_reference_v1('수학의 정석 기본',true,'management','legacy')));
select diag(pg_temp.wire('getTextbookMasterOptions','{"subject":"math","listSubject":"all","bulkSubject":"keep"}',public.get_textbook_master_options_v1('{"subject":"math","listSubject":"all","bulkSubject":"keep"}')));
select diag(pg_temp.wire('getTextbookInactiveCleanupContext','{}',public.get_textbook_inactive_cleanup_context_v1()));
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.list_textbook_teacher_reference_page_v1('{"search":""}','match-name',1,10)$$,'42501',null,'missing identity denied');
reset role;
set local role anon;
select throws_ok($$select public.list_textbook_teacher_reference_page_v1('{"search":""}','match-name',1,10)$$,'42501',null,'anon exact execute denied');
reset role;
select is((select count(*)from dashboard_private.notification_events),(select events from sends_before),'no events');
select is((select count(*)from dashboard_private.notification_event_fanout_jobs),(select jobs from sends_before),'no fanout');
select is((select count(*)from dashboard_private.notification_deliveries),(select deliveries from sends_before),'no sends');
-- Isolated ordering fixtures preserve the earlier completeness/timing/wire scopes.
-- Final physical late-fixture preflight: these are ALL NOT NULL columns with
-- neither a default nor a generated expression. Remaining NOT NULL defaults:
-- books scalar school/grade/subsubject='', arrays={}, lessons=[], prices=0,
-- is_returnable=false/status=active; classes class_type/UUID/revision/storage;
-- supplier contact/memo='', publisher memo=''/subjects+source URLs={}; settings
-- sort_order=0/is_visible=true. Required taxonomy fields are explicitly supplied.
select is((select jsonb_object_agg(relname,columns)from(select c.relname,jsonb_agg(a.attname order by a.attname)columns
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_attribute a on a.attrelid=c.oid
  left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public'and c.relname in('textbooks','classes','textbook_publishers','textbook_suppliers','textbook_sub_subject_settings')
    and a.attnum>0 and not a.attisdropped and a.attnotnull and d.oid is null and a.attgenerated=''group by c.relname)required),
  '{"textbooks":["name"],"classes":["name"],"textbook_publishers":["name"],"textbook_suppliers":["name"],"textbook_sub_subject_settings":["name","subject"]}'::jsonb,'all late fixtures supply every final NOT NULL defaultless column');
insert into public.textbook_suppliers(id,name)values(pg_temp.rid(3900),pg_temp.rid(4001)::text),(pg_temp.rid(3901),'  Legacy Vendor  ');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(901),'role','authenticated')::text,true);
select is(public.resolve_textbook_reference_v1(pg_temp.rid(131)::text,true,'management','외부 공급처')->'row'->'supplier'->>'id',pg_temp.rid(4001)::text,'legacy supplier name fallback resolves visible supplier');
select is(public.resolve_textbook_reference_v1(pg_temp.rid(131)::text,true,'management','Legacy Vendor')->'row'->'supplier'->>'id',pg_temp.rid(3901)::text,'legacy supplier comparison trims stored name only');
select is(public.resolve_textbook_reference_v1(pg_temp.rid(131)::text,true,'management',pg_temp.rid(4001)::text)->'row'->'supplier'->>'id',pg_temp.rid(3900)::text,'combined id-or-name predicate uses stable real ID without invented ID priority');
select is(public.resolve_textbook_reference_v1(pg_temp.rid(131)::text,true,'management',' Legacy Vendor ')->'row'->'supplier','null'::jsonb,'padded fallback is not trimmed into a supplier');
select is(public.resolve_textbook_reference_v1(pg_temp.rid(131)::text,true,'management','legacy vendor')->'row'->'supplier','null'::jsonb,'fallback name comparison remains case sensitive');
select is(public.resolve_textbook_reference_v1(pg_temp.rid(131)::text,true,'management','missing')->'row'->>'configuredSupplierId','missing','unmatched fallback retained without inferred supplier');
select is(public.resolve_textbook_reference_v1(pg_temp.rid(131)::text,true,'request','외부 공급처')->'row'->'supplier','null'::jsonb,'request name fallback never reads supplier rows');
reset role;
-- Installed original JS oracle: numeric Book 2/Book 02 and NFC/NFD Korean tie;
-- canonical rows then use real ID, while facet labels retain first source order.
insert into public.textbooks(id,name,title,subject,status,school_level,grade_level,school_levels,grade_levels,sub_subject)
select pg_temp.rid(n),title,title,'english',status,'middle','m2',array['middle'],array['m2'],sub from(values
(701,'Book 2','active','숫자순서'),(702,'Book 02','active','숫자순서'),
(703,'가','active','정규순서'),(704,'가','active','정규순서'),
(709,'Cleanup 2','inactive','문법'),(710,'Cleanup 02','inactive','문법'))fixture(n,title,status,sub);
insert into public.classes(id,name,class_type,subject,grade,teacher)values
(pg_temp.rid(1701),'Book 2','regular','영어','중2','숫자순서교사'),
(pg_temp.rid(1702),'Book 02','regular','영어','중2','숫자순서교사'),
(pg_temp.rid(1703),'가','regular','영어','중2','정규순서교사'),
(pg_temp.rid(1704),'가','regular','영어','중2','정규순서교사');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(901),'role','authenticated')::text,true);
select is(public.list_textbook_reference_page_v1(pg_temp.rf('{"selectedFilters":{"subSubject":["숫자순서"]}}'),'match-title',1,10)->'rows'->0->>'value',pg_temp.rid(701)::text,'original numeric book tie follows real ID before byte order');
select is(public.list_textbook_reference_page_v1(pg_temp.rf('{"selectedFilters":{"subSubject":["정규순서"]}}'),'match-title',1,10)->'rows'->0->>'value',pg_temp.rid(703)::text,'original NFC NFD book tie follows real ID');
select is(public.list_textbook_class_reference_page_v1(pg_temp.rf('{"selectedFilters":{"teacher":["숫자순서교사"]}}'),'match-name',1,10)->'rows'->0->>'value',pg_temp.rid(1701)::text,'original numeric class tie follows real ID');
select is(public.list_textbook_class_reference_page_v1(pg_temp.rf('{"selectedFilters":{"teacher":["정규순서교사"]}}'),'match-name',1,10)->'rows'->0->>'value',pg_temp.rid(1703)::text,'original NFC NFD class tie follows real ID');
select is((select jsonb_agg(value order by ord)from jsonb_array_elements(public.get_textbook_inactive_cleanup_context_v1()->'targetIds')with ordinality a(value,ord)where value in(to_jsonb(pg_temp.rid(709)),to_jsonb(pg_temp.rid(710)))),jsonb_build_array(pg_temp.rid(709),pg_temp.rid(710)),'original numeric cleanup tie follows real ID');
select is(dashboard_private.textbook_reference_groups_v1('[{"filterValues":{"subSubject":[{"value":"first","label":"분류 2"}]}},{"filterValues":{"subSubject":[{"value":"second","label":"분류 02"}]}}]',array['subSubject'])->0->'options'->0->>'value','first','original numeric facet label tie retains first source order');
select is(dashboard_private.textbook_reference_groups_v1('[{"filterValues":{"subSubject":[{"value":"first","label":"가"}]}},{"filterValues":{"subSubject":[{"value":"second","label":"가"}]}}]',array['subSubject'])->0->'options'->0->>'value','first','original NFC NFD facet label tie retains first source order');
reset role;
insert into public.textbook_publishers(id,name)values(pg_temp.rid(3501),'Press 2'),(pg_temp.rid(3502),'Press 02'),(pg_temp.rid(3503),'가'),(pg_temp.rid(3504),'가');
insert into public.textbook_sub_subject_settings(id,subject,name,sort_order,is_visible)values
(pg_temp.rid(6101),'other','분류 2',1,true),(pg_temp.rid(6102),'other','분류 02',2,true),(pg_temp.rid(6103),'other','가',3,true),(pg_temp.rid(6104),'other','가',4,true);
set local role authenticated;
select is((select jsonb_agg(value->>'label'order by ord)from jsonb_array_elements(public.get_textbook_master_options_v1('{"subject":"other","listSubject":"other","bulkSubject":"other"}')->'publisherOptions')with ordinality a(value,ord)where value->>'label'in('Press 2','Press 02','가','가')),'["가","가","Press 2","Press 02"]'::jsonb,'original publisher locale ties retain canonical configured first source order');
select is(public.get_textbook_master_options_v1('{"subject":"other","listSubject":"other","bulkSubject":"other"}')->'subSubjectOptions','["가","가","기타","분류 2","분류 02"]'::jsonb,'original settings numeric ties retain configured sort order');
select is(public.get_textbook_master_options_v1('{"subject":"other","listSubject":"other","bulkSubject":"other"}')->'categoryOptions','["가","가","기타","분류 02","분류 2"]'::jsonb,'original category NONnumeric order preserves NFC NFD settings source ties');
select is(public.get_textbook_master_options_v1('{"subject":"other","listSubject":"other","bulkSubject":"other"}')->'bulkCategoryOptions','["가","가","기타","분류 2","분류 02"]'::jsonb,'original selected bulk subject is settings first for numeric ties');
select is(public.get_textbook_master_options_v1('{"subject":"other","listSubject":"other","bulkSubject":"keep"}')->'bulkCategoryOptions','["가","가","기타","분류 02","분류 2"]'::jsonb,'original keep bulk preserves category first-source numeric ties');
reset role;
insert into public.classes(id,name,class_type,subject,grade,teacher,room,status,student_ids,schedule)values
(pg_temp.rid(1801),'','regular','English','중2',' 김 , 김 / 이 ',' 본 1 ',' ACTIVE ','["a","a"]',' 월 '),
(pg_temp.rid(1802),'000','regular','English','중2','김',null,'active','[]',null);
set local role authenticated;
select is(public.get_textbook_class_reference_v1(pg_temp.rid(1801))->'row'->>'name',pg_temp.rid(1801)::text,'original empty physical class name falls back to real ID in selected display');
select is(public.list_textbook_class_reference_page_v1(pg_temp.rf('{"selectedFilters":{"teacher":["김"]}}'),'match-name',1,10)->'rows'->0->>'value',pg_temp.rid(1802)::text,'canonical class order uses original display fallback not raw empty name');
select is(public.get_textbook_class_reference_v1(pg_temp.rid(1801))->'row'->'option'->>'searchText','김 , 김 / 이   영어 중2 사용중 월','original physical class status alias comparison is case insensitive');
select diag(pg_temp.wire('resolveTextbookReference',jsonb_build_object('reference',pg_temp.rid(131),'activeOnly',true,'scope','management','fallbackSupplier','Legacy Vendor'),public.resolve_textbook_reference_v1(pg_temp.rid(131)::text,true,'management','Legacy Vendor')));
select diag(pg_temp.wire('getTextbookClassReference',to_jsonb(pg_temp.rid(1801)),public.get_textbook_class_reference_v1(pg_temp.rid(1801))));
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(904),'role','authenticated')::text,true);
select diag(pg_temp.wire('getTextbookMasterOptions','{"subject":"other","listSubject":"other","bulkSubject":"other"}',public.get_textbook_master_options_v1('{"subject":"other","listSubject":"other","bulkSubject":"other"}')));
reset role;
-- Late scale gate: no impact on the original completeness/oracle/wire fixtures.
-- The deliberately unused 4KB lessons payload must not enter picker projection.
insert into public.textbooks(id,name,title,subject,status,school_level,grade_level,school_levels,grade_levels,sub_subject,lessons)
select pg_temp.rid(100000+n),'규모 교재 '||n,'규모 교재 '||n,'english','active','middle','m2',array['middle'],array['m2'],'규모검증',jsonb_build_array(jsonb_build_object('unused',repeat('x',4096)))from generate_series(1,5000)n;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(901),'role','authenticated')::text,true);
select is((public.list_textbook_reference_page_v1(pg_temp.rf(),'match-title',1,10)->>'totalCount')::integer,5128,'scale gate retains all5128 authorized active books with5000 additional large-payload rows');
select is((public.list_textbook_reference_page_v1(pg_temp.rf('{"selectedFilters":{"subSubject":["규모검증"]}}'),'match-title',1,10)->>'totalCount')::integer,5000,'scale subset count is complete and uncapped');
select * from pg_temp.measure_reference('book_scale5000_first',$$select public.list_textbook_reference_page_v1(pg_temp.rf('{"selectedFilters":{"subSubject":["규모검증"]}}'),'match-title',1,10)$$);
select * from pg_temp.measure_reference('book_scale5000_middle',$$select public.list_textbook_reference_page_v1(pg_temp.rf('{"selectedFilters":{"subSubject":["규모검증"]}}'),'match-title',250,10)$$);
select * from pg_temp.measure_reference('book_scale5000_final',$$select public.list_textbook_reference_page_v1(pg_temp.rf('{"selectedFilters":{"subSubject":["규모검증"]}}'),'match-title',500,10)$$);
select * from pg_temp.measure_reference('book_scale5000_search',$$select public.list_textbook_reference_page_v1(pg_temp.rf('{"search":"규모","selectedFilters":{"subSubject":["규모검증"]}}'),'match-title',1,10)$$);
reset role;
select is((select count(*)from dashboard_private.notification_events),(select events from sends_before),'complete fixture and scale gate create no events');
select is((select count(*)from dashboard_private.notification_event_fanout_jobs),(select jobs from sends_before),'complete fixture and scale gate create no fanout');
select is((select count(*)from dashboard_private.notification_deliveries),(select deliveries from sends_before),'complete fixture and scale gate create no sends');
select is(dashboard_private.textbook_reference_groups_v1('[{"filterValues":{"teacher":[{"value":"Teacher 2","label":"Teacher 2"},{"value":"Teacher 02","label":"Teacher 02"}]}}]',array['teacher'])->0->'options'->0->>'value','Teacher 2','original same-option numeric teacher facet tie retains value array order');
select is(dashboard_private.textbook_reference_groups_v1('[{"filterValues":{"teacher":[{"value":"가","label":"가"},{"value":"가","label":"가"}]}}]',array['teacher'])->0->'options'->0->>'value','가','original same-option NFC NFD teacher facet tie retains value array order');
select * from finish();
rollback;
