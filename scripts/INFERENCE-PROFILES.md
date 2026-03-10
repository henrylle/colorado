# Inference Profiles no Amazon Bedrock

## O que são Inference Profiles?

**Inference Profiles** são recursos do Bedrock que definem um modelo e uma ou mais regiões AWS para onde as requisições podem ser roteadas.

## Prefixos de Região

| Prefixo | Regiões Incluídas |
|---------|-------------------|
| `us.` | Regiões dos EUA (us-east-1, us-west-2, etc.) |
| `eu.` | Regiões da Europa |
| `ap.` | Regiões da Ásia-Pacífico |

**Exemplo:**
- `us.anthropic.claude-sonnet-4-5-20250929-v1:0` → Roteamento entre regiões dos EUA

---

## Preços

O preço é calculado baseado na **região de onde você chama** o inference profile, não nas regiões para onde ele roteia.

**Exemplo:**
- Você chama de `us-east-1`
- Inference profile roteia para `us-west-2`
- **Você paga o preço de `us-east-1`**

---
-  Inference Profile é como um **load balancer** para modelos de IA.

1. **Modelos antigos (Claude 3.x):** Você liga direto
2. **Modelos novos (Claude 4.5+):** Você precisa passar pelo "load balancer" (inference profile)

### Vantagens:

✅ Maior disponibilidade (não fica sem acesso se uma região cair)  
✅ Melhor performance (distribui carga)  
✅ Mesmo preço (não custa mais caro)

### Quando usar:

- **Claude 4.5+:** Obrigatório usar inference profile
- **Claude 3.x:** Opcional (pode usar model ID direto)