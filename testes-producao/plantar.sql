-- Dados marcados na SEGUNDA conta (OUTRO em suite.js). Apagar com limpar.sql.
insert into public.registos(id,utilizador_id,refeicao,descricao,kcal)
  values ('7e570000-0000-0000-0000-00000000a001','2f92c1ce-b786-4f87-82e7-59bef040def5','almoco','MARCADOR-TESTE-SEGURANCA',111) on conflict (id) do nothing;
insert into public.pesos(utilizador_id,kg,medido_em) values ('2f92c1ce-b786-4f87-82e7-59bef040def5',77.7,date '2026-10-01') on conflict (utilizador_id,medido_em) do nothing;
insert into public.alimentos_meus(id,utilizador_id,nome,kcal_100) values ('7e570000-0000-0000-0000-00000000a002','2f92c1ce-b786-4f87-82e7-59bef040def5','MARCADOR-TESTE-SEGURANCA',123) on conflict do nothing;
insert into public.alimentos(id,nome,kcal_100,fonte) values ('7e570000-0000-0000-0000-00000000a003','MARCADOR catalogo teste',100,'insa') on conflict do nothing;
-- Perfil preenchido, para o estimar_gasto TER o que devolver se a guarda falhar.
update public.profiles set sexo='m', data_nascimento='1990-01-01', altura_cm=180, nivel_atividade='leve', objetivo_kg_semana=0.5
 where id='2f92c1ce-b786-4f87-82e7-59bef040def5';
select 'plantado' as estado;
