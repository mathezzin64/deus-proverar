# DEUS PROVERAR

App online para venda de lanches com cardapio, carrinho, fila publica de pedidos, controle de pagamento, controle de entrega e resumo de vendas.

## Rodar localmente

```bash
npm install
npm start
```

Depois abra:

```txt
http://localhost:3000
```

## Senha master

Por padrao, em desenvolvimento:

```txt
DEUSPROVERAR2026
```

Em producao, configure a variavel:

```txt
ADMIN_PASSWORD=sua-senha-forte
```

## Publicar no Render

O projeto ja inclui `render.yaml`.

1. Suba este projeto para o GitHub.
2. No Render, crie um Blueprint apontando para o repositorio.
3. Configure a variavel secreta `ADMIN_PASSWORD`.
4. O app sera publicado como Web Service Node.

## Dados

Em producao, use MongoDB para os dados nao sumirem:

```txt
MONGODB_URI=mongodb+srv://...
MONGODB_DB=deus_proverar
```

Rodando localmente sem `MONGODB_URI`, o app usa fallback em:

```txt
data/database.json
```

Esse arquivo local nao entra no Git, para nao vazar pedidos reais.
