#!/bin/bash

# V7a - Técnicas de Prompt: System Prompt que ALUCINA
# Demonstra o problema: sem regra explícita, o modelo inventa preços

export AWS_PROFILE=seattle
MODEL_ID="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
REGION="us-east-1"

# System prompt SIMPLES — sem proteção contra alucinação
SYSTEM_PROMPT="Você é a Bia, atendente comercial da equipe do Henrylle Maia.
Tom: informal, amigável, direto. Respostas curtas (máximo 30 palavras).

Produtos disponíveis:
- Imersão AWS & IA: R\$ 47 (normal) / R\$ 97 (VIP)
- Gravação em formato de curso: de R\$ 497 por R\$ 297"

# Pergunta que vai causar alucinação
USER_MESSAGE="quanto custa a formação AWS?"

echo "🤖 V7a - Prompt que ALUCINA"
echo "============================"
echo ""
echo "📄 System prompt SEM proteção contra alucinação"
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
echo "⚠️  PROBLEMA: O modelo provavelmente inventou um preço para a 'Formação AWS'"
echo "   que NÃO existe no system prompt. Isso é uma ALUCINAÇÃO."
echo ""
echo "👉 Agora rode o v7b-prompt-corrigido.sh para ver a correção."
