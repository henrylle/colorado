#!/bin/bash

# V7b - Técnicas de Prompt: System Prompt CORRIGIDO
# Demonstra a solução: constraints + grounding + fallback behavior

export AWS_PROFILE=seattle
MODEL_ID="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
REGION="us-east-1"

# System prompt COM proteção contra alucinação (constraints + grounding)
SYSTEM_PROMPT="Você é a Bia, atendente comercial da equipe do Henrylle Maia.
Tom: informal, amigável, direto. Respostas curtas (máximo 30 palavras).

Produtos disponíveis:
- Imersão AWS & IA: R\$ 47 (normal) / R\$ 97 (VIP)
- Gravação em formato de curso: de R\$ 497 por R\$ 297

REGRA CRÍTICA: NUNCA invente preços, valores ou informações que não estejam EXPLICITAMENTE escritos acima. Se perguntarem sobre qualquer produto ou preço que não consta aqui, responda: \"Não tenho essa informação agora. Vou pedir para alguém do time do Henrylle te ajudar com isso.\""

# Mesma pergunta do v7a
USER_MESSAGE="quanto custa a formação AWS?"

echo "🤖 V7b - Prompt CORRIGIDO"
echo "=========================="
echo ""
echo "📄 System prompt COM proteção contra alucinação"
echo ""
echo "👤 User: $USER_MESSAGE"
echo ""
echo "⏳ Enviando para o Bedrock..."
echo ""

SYSTEM_JSON=$(jq -n --arg text "$SYSTEM_PROMPT" '[{text: $text}]')
MESSAGES_JSON=$(jq -n --arg text "$USER_MESSAGE" '[{role: "user", content: [{text: $text}]}]')

RESPONSE=$(aws bedrock-runtime converse \
  --region $REGION \
  --model-id $MODEL_ID \
  --system "$SYSTEM_JSON" \
  --messages "$MESSAGES_JSON" \
  --inference-config '{"maxTokens":256,"temperature":0.7}' \
  --output json)

ASSISTANT_RESPONSE=$(echo $RESPONSE | jq -r '.output.message.content[0].text')

echo "🎫 Assistente:"
echo "$ASSISTANT_RESPONSE"
echo ""
echo "✅ CORRIGIDO: O modelo agora recusa inventar preços e escala para humano."
echo ""
echo "📚 Técnicas usadas:"
echo "   1. Constraints  — regras rígidas do que NÃO fazer"
echo "   2. Grounding     — ancorar respostas apenas nos dados fornecidos"
echo "   3. Fallback      — comportamento padrão quando não sabe a resposta"
