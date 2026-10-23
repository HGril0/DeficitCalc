# Função `receitas-ia`

Sugere pratos a partir dos ingredientes que a pessoa diz ter em casa.

## O que é preciso para ligar

Falta **uma coisa só**: a chave da API da Anthropic, em
Supabase → Edge Functions → Secrets, com o nome `ANTHROPIC_API_KEY`.

Enquanto a chave não existir, a função responde 503 com `desligado: true` e a
app mostra a mensagem "As sugestões por IA ainda não estão ligadas". O resto
da app continua a funcionar na mesma.

A chave **nunca** entra no repositório nem no código do browser. Vive só nos
segredos do Supabase e é lida pela função em cada pedido.

## Segredos que a função lê

| Nome | Obrigatório | Para que serve |
|---|---|---|
| `ANTHROPIC_API_KEY` | sim | chave da IA |
| `MODELO_IA` | não | modelo a usar (por omissão `claude-haiku-5-5`) |
| `PRECO_IA_ENTRADA` | não | $ por milhão de tokens de entrada (por omissão 0,10) |
| `PRECO_IA_SAIDA` | não | $ por milhão de tokens de saída (por omissão 0,50) |
| `ORIGENS_PERMITIDAS` | não | endereços da app que podem chamar a função |

Se mudares de modelo, muda também os dois preços: é com eles que o teto de
gastos é contado.

## Quanto custa

Com o Haiku 5.5, um pedido anda pelos **0,0007 $** (cerca de 600 tokens de
entrada e 1200 de saída). Oito pessoas a pedir 10 vezes por dia durante um mês
dão cerca de **1,60 $**. O teto de 20 € é uma rede de segurança contra um erro
em ciclo, não um orçamento apertado.

## Travões, do mais apertado para o mais largo

1. **30 pedidos por minuto** por pessoa (`registar_uso`, igual às outras funções).
2. **25 pedidos por dia** por pessoa (`pedir_ia`).
3. **20 € por mês** no total de todos, com aviso aos 80% (`pedir_ia`).

Os três estão na base de dados, não aqui: se esta função tiver um erro, os
limites continuam a valer. Ver `sql/14-ia.sql`.

## O que NÃO se guarda

O texto que a pessoa escreve e a resposta da IA **não são guardados**. A
tabela `ia_pedidos` só tem quem pediu, quando, que modelo respondeu, quantos
tokens e quanto custou. A bateria 10 tem um teste que falha se alguém
acrescentar uma coluna para guardar o texto.

## O que a função recusa

- Resposta da IA que não seja JSON com a forma certa (422).
- Receitas sem passos, com menos de 2 ingredientes, com porções fora de 1–12
  ou gramas fora de 1–5000 g.
- Calorias vindas da IA: são deitadas fora de propósito. As calorias da app
  vêm da tabela do INSA, pelos ingredientes que a pessoa junta a seguir.

## Testes

```bash
node --experimental-strip-types supabase/functions/receitas-ia/teste.mjs
```
