delete from public.registos where id='7e570000-0000-0000-0000-00000000a001';
delete from public.pesos where utilizador_id='2f92c1ce-b786-4f87-82e7-59bef040def5' and medido_em='2026-10-01';
delete from public.alimentos_meus where id='7e570000-0000-0000-0000-00000000a002';
delete from public.alimentos where id='7e570000-0000-0000-0000-00000000a003';
delete from public.receitas where id='7e570000-0000-0000-0000-00000000b001';
delete from public.alimentos_meus where id='7e570000-0000-0000-0000-00000000b003';
update public.profiles set sexo=null, data_nascimento=null, altura_cm=null, nivel_atividade=null, objetivo_kg_semana=null
 where id='2f92c1ce-b786-4f87-82e7-59bef040def5';
select (select count(*) from public.registos where descricao like '%TESTE%')
     + (select count(*) from public.alimentos where nome like 'MARCADOR%')
     + (select count(*) from public.alimentos_meus where nome like '%TESTE%' or nome like 'MARCADOR%')
     + (select count(*) from public.receitas where nome like 'MARCADOR%' or nome like 'TESTE%') as restos;
