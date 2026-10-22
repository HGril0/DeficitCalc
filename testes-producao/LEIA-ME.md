# Testes contra a base de dados real

Ataques e operações normais contra o Supabase de produção, com uma sessão
verdadeira. Correm no browser, na página da app, com sessão iniciada.

1. No editor SQL do Supabase, corre `plantar.sql` (põe dados marcados na
   segunda conta, para provar que a primeira não os vê nem mexe).
2. Abre a app com a **primeira** conta, abre a consola do browser e cola
   `suite.js`. Corre `await suite()`.
3. Corre `limpar.sql`. Deve devolver `restos = 0`.

Resultado de 23/10/2026: 55/55 na base de dados, 14/14 na função
`alimentos` (incluindo o limite de 30 pedidos por minuto).

Os outros testes (`sql/testes/`, `testes-ecra/`,
`supabase/functions/alimentos/teste.mjs`) correm sem tocar em produção.
