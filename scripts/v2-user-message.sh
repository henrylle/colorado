#!/bin/bash

# V2 - Separação: System + User Message
# Demonstra a separação correta entre comportamento (system) e contexto (user)

# Configurar profile AWS
export AWS_PROFILE=seattle

# Usar inference profile (cross-region) - prefixo "us."
MODEL_ID="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
REGION="us-east-1"

# System prompt: apenas o comportamento
SYSTEM_PROMPT="COMPORTE-SE COM UM ATENDENTE QUE VENDE INGRESSO. \nVocê vai vender ingressos para o meu treinamento de AWS com IA.\nLimite-se a falar sobre o ingressso normal e vip.\nIngresso normal custa 47 e VIP custa 97.\nNormal: Evento ao vivo + 2 dias de gravação.\nVIP: Tudo do normal + aula extra + 7 dias de gravação.\n Limite sua resposta a 40 palavras. \n Evite o uso de emojis e uso um tom mais amigável nas mensagens."

# User message: a mensagem real do usuário
USER_MESSAGE="Quero comprar meu ingresso para o seu evento"

echo "🤖 Chatbot de Venda de Ingressos - V2 User Message"
echo "==================================================="
echo ""
echo "📝 System (comportamento):"
echo -e "$SYSTEM_PROMPT"
echo ""
echo "💬 User (mensagem):"
echo "$USER_MESSAGE"
echo ""
echo "⏳ Enviando para o Bedrock..."
echo ""

# Criar JSON do system usando jq (mais seguro)
SYSTEM_JSON=$(jq -n --arg text "$SYSTEM_PROMPT" '[{text: $text}]')

# Criar JSON das messages usando jq
MESSAGES_JSON=$(jq -n --arg text "$USER_MESSAGE" '[{role: "user", content: [{text: $text}]}]')

# Invocar Bedrock usando Converse API
RESPONSE=$(aws bedrock-runtime converse \
  --region $REGION \
  --model-id $MODEL_ID \
  --system "$SYSTEM_JSON" \
  --messages "$MESSAGES_JSON" \
  --inference-config '{"maxTokens":512,"temperature":0.7}' \
  --output json)

# Extrair resposta
ASSISTANT_RESPONSE=$(echo $RESPONSE | jq -r '.output.message.content[0].text')

echo "Assistente:"
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
