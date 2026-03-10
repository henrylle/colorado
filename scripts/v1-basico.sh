#!/bin/bash

# V1 - Chatbot Básico com Converse API
# Demonstra o uso apenas do system prompt (tudo em um lugar)

# Configurar profile AWS
export AWS_PROFILE=seattle

# Usar inference profile (cross-region) - prefixo "us."
MODEL_ID="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
REGION="us-east-1"

# System prompt: comportamento + contexto (tudo junto na V1)
COMPORTAMENTO="COMPORTE-SE COM UM ATENDENTE QUE VENDE INGRESSO. \nVocê vai vender ingressos para o meu treinamento de AWS com IA.\nLimite-se a falar sobre o ingressso normal e vip.\nIngresso normal custa 47 e VIP custa 97.\nNormal: Evento ao vivo + 2 dias de gravação.\nVIP: Tudo do normal + aula extra + 7 dias de gravação."
CONTEXTO="Quero comprar meu ingresso para o seu evento"
SYSTEM_PROMPT="$COMPORTAMENTO. $CONTEXTO"

echo "🤖 Chatbot de Venda de Ingressos - V1 Básico (Converse API)"
echo "============================================================"
echo ""
echo "📝 System Prompt: $SYSTEM_PROMPT"
echo ""
echo "⏳ Enviando para o Bedrock..."
echo ""

# Invocar Bedrock usando Converse API
# User message é apenas "Olá" (dummy) - tudo está no system
RESPONSE=$(aws bedrock-runtime converse \
  --region $REGION \
  --model-id $MODEL_ID \
  --system "[{\"text\":\"$SYSTEM_PROMPT\"}]" \
  --messages '[{"role":"user","content":[{"text":"Olá"}]}]' \
  --inference-config '{"maxTokens":512,"temperature":0.7}' \
  --output json)

# Extrair resposta
ASSISTANT_RESPONSE=$(echo $RESPONSE | jq -r '.output.message.content[0].text')

echo "🎫 Assistente:"
echo "$ASSISTANT_RESPONSE"
echo ""

# Métricas
INPUT_TOKENS=$(echo $RESPONSE | jq -r '.usage.inputTokens')
OUTPUT_TOKENS=$(echo $RESPONSE | jq -r '.usage.outputTokens')
TOTAL_TOKENS=$(echo $RESPONSE | jq -r '.usage.totalTokens')

echo "📊 Métricas:"
echo "  Input tokens: $INPUT_TOKENS"
echo "  Output tokens: $OUTPUT_TOKENS"
echo "  Total tokens: $TOTAL_TOKENS"
