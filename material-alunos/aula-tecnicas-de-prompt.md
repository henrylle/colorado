# Técnicas de Prompt — Material de Apoio

Referência consolidada a partir da documentação oficial da Anthropic, OpenAI e AWS Bedrock.

---

## 1. Zero-Shot Prompting

Você dá a instrução diretamente, sem nenhum exemplo. O modelo usa apenas o conhecimento do treinamento.

```
Diga o sentimento da seguinte manchete e classifique como positivo, negativo ou neutro:
"Nova companhia aérea entre São Paulo e Recife oferece ótima oportunidade para passageiros e investidores."
```

**Quando usar:** Tarefas simples onde o modelo já entende o formato esperado.

> Fonte: AWS Bedrock — Prompt Engineering Concepts

---

## 2. Few-Shot Prompting (Multishot)

Você fornece alguns exemplos de entrada/saída no prompt para "ensinar" o padrão desejado. O modelo generaliza a partir desses exemplos.

### Exemplo genérico (AWS Bedrock)

```
Classifique o sentimento como positivo, negativo ou neutro. Exemplos:

"Empresa de pesquisa se defende de alegações sobre nova tecnologia."
Resposta: Negativo

"Parques eólicos continuam prosperando enquanto minoria vocal diminui."
Resposta: Positivo

"Fábrica é o mais recente alvo de investigação por autoridades estaduais."
Resposta:
```

### Com tags XML (Anthropic Claude)

A Anthropic recomenda usar tags `<example>` para separar exemplos das instruções:

```
Classifique o email como "Pessoal" ou "Comercial".

<example>
H: Oi João, faz tempo que não nos vemos. Vamos ter uma festa no sábado, você vem?
A: Pessoal
</example>

<example>
H: Oi João, temos uma oferta especial. Por tempo limitado, economize até 35%. Reserve agora!
A: Comercial
</example>

H: Oi João, lançamos uma nova linha de produtos. Peça agora e economize R$100.
A:
```

### Com roles de mensagem (OpenAI)

A OpenAI usa a estrutura de roles (`developer`, `user`, `assistant`) para fornecer exemplos:

```
# Instructions (role: developer)
Classifique reviews como Positive, Negative ou Neutral.
Responda apenas uma palavra.

<product_review id="example-1">
Adoro esses fones — qualidade de som incrível!
</product_review>
<assistant_response id="example-1">
Positive
</assistant_response>

<product_review id="example-2">
Bateria ok, mas as almofadas parecem baratas.
</product_review>
<assistant_response id="example-2">
Neutral
</assistant_response>
```

### Boas práticas para exemplos

| Prática | Fonte |
|---------|-------|
| Use 3-5 exemplos diversos | Anthropic |
| Cubra edge cases nos exemplos | Anthropic, OpenAI |
| Envolva exemplos em tags XML (`<example>`) | Anthropic, AWS Bedrock |
| Exemplos devem espelhar o caso de uso real | OpenAI |
| Use delimitadores diferentes dos da conversa (H:/A: em vez de Human:/Assistant:) | AWS Bedrock |

---

## 3. Chain-of-Thought (CoT)

Técnica que pede ao modelo para "pensar passo a passo" antes de dar a resposta final. Melhora drasticamente a performance em tarefas de raciocínio complexo.

### CoT básico (Anthropic)

Basta pedir para o modelo pensar antes de responder:

```
Antes de responder, pense passo a passo sobre o problema.
Coloque seu raciocínio dentro de tags <thinking>.
Depois dê a resposta final em tags <answer>.
```

### CoT com tags estruturadas

```
Um cliente comprou 3 ingressos normais (R$47 cada) e 1 VIP (R$97).
Qual o total?

<thinking>
3 ingressos normais: 3 × R$47 = R$141
1 ingresso VIP: R$97
Total: R$141 + R$97 = R$238
</thinking>

<answer>
O total é R$238.
</answer>
```

### Extended Thinking (Anthropic)

Modelos mais recentes da Anthropic têm "extended thinking" nativo — o modelo raciocina internamente antes de responder. Pode ser ativado via API:

```js
// Anthropic API
client.messages.create({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 16000,
  thinking: { type: "enabled", budget_tokens: 10000 },
  messages: [{ role: "user", content: "..." }]
});
```

### Reasoning Models (OpenAI)

A OpenAI tem modelos de raciocínio (como o1, o3) que geram uma "chain of thought interna" automaticamente. A diferença:

- **Modelos GPT:** precisam de instruções explícitas e detalhadas (como um júnior)
- **Modelos de raciocínio:** funcionam melhor com instruções de alto nível (como um sênior)

> "Um modelo de raciocínio é como um colega sênior. Você dá o objetivo e confia que ele vai resolver os detalhes." — OpenAI Docs

---

## 4. Outras Técnicas Importantes

### Constraints (Restrições)

Regras rígidas do que o modelo NÃO deve fazer. Evita alucinações.

```
REGRA CRÍTICA: NUNCA invente preços ou informações que não estejam
EXPLICITAMENTE escritos acima.
```

> Já demonstrado no v7b-prompt-corrigido.sh do curso.

### Grounding (Ancoragem)

Ancorar as respostas apenas nos dados fornecidos no prompt.

```
Responda APENAS com base nas informações fornecidas acima.
Se a informação não estiver presente, diga que não sabe.
```

### Fallback Behavior (Comportamento Padrão)

Definir o que o modelo deve fazer quando não sabe a resposta.

```
Se perguntarem sobre qualquer produto que não consta aqui, responda:
"Não tenho essa informação. Vou pedir para alguém do time te ajudar."
```

### Role Setting (Definir Papel)

Dar uma identidade ao modelo no system prompt.

```
Você é a Bia, atendente comercial da equipe do Henrylle Maia.
Tom: informal, amigável, direto.
```

### XML Tags para Estruturação

Tanto Anthropic quanto OpenAI recomendam usar XML para organizar prompts complexos:

```xml
<instructions>Suas instruções aqui</instructions>
<context>Dados de contexto aqui</context>
<examples>Exemplos aqui</examples>
<input>A pergunta do usuário</input>
```

---

## 5. Resumo Comparativo

| Técnica | Anthropic | OpenAI | AWS Bedrock |
|---------|-----------|--------|-------------|
| Zero-shot | ✅ | ✅ | ✅ Documentado com exemplos |
| Few-shot | ✅ "Multishot prompting" com tags `<example>` | ✅ "Few-shot learning" com roles e XML | ✅ Com tags `<example>` para Claude |
| Chain-of-thought | ✅ Tags `<thinking>` + Extended Thinking nativo | ✅ Reasoning models (o1, o3) com CoT interno | Referencia docs da Anthropic |
| XML tags | ✅ Recomendação forte | ✅ Recomendado junto com Markdown | ✅ Tags `<example>` documentadas |
| Role/Persona | ✅ Via system prompt | ✅ Via role "developer" | ✅ Via system no Converse API |
| Prompt templates | — | — | ✅ Templates com `{{ }}` |

---

## 6. Fontes

- Anthropic: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/claude-prompting-best-practices
- OpenAI: https://platform.openai.com/docs/guides/prompt-engineering
- AWS Bedrock: https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-engineering-guidelines.html
