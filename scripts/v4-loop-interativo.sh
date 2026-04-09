#!/bin/bash

# V4 - Loop Interativo com Histórico
# Demonstra conversação contínua mantendo histórico de mensagens

# Configurar profile AWS
export AWS_PROFILE=seattle

# Usar inference profile (cross-region) - prefixo "us."
MODEL_ID="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
REGION="us-east-1"

# Ler system prompt de arquivo externo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEM_PROMPT=$(cat "$SCRIPT_DIR/prompt-valendo.txt")
SYSTEM_JSON=$(jq -n --arg text "$SYSTEM_PROMPT" '[{text: $text}]')

# Inicializar histórico de mensagens vazio
MESSAGES_JSON='[]'

echo "🤖 Chatbot de Venda de Ingressos - V4 Loop Interativo"
echo "======================================================"
echo ""
echo "📄 System prompt carregado de: system-prompt.txt"
echo "💡 Digite 'sair' para encerrar"
echo ""

while true; do
  # Ler input do usuário
  echo -n "👤 Você: "
  read USER_INPUT
  
  # Verificar se quer sair
  if [[ "$USER_INPUT" == "sair" ]]; then
    echo "👋 Até logo!"
    break
  fi
  
  # Adicionar mensagem do usuário ao histórico
  MESSAGES_JSON=$(echo "$MESSAGES_JSON" | jq --arg text "$USER_INPUT" '. += [{role: "user", content: [{text: $text}]}]')
  
  # Invocar Bedrock
  RESPONSE=$(aws bedrock-runtime converse \
    --region $REGION \
    --model-id $MODEL_ID \
    --system "$SYSTEM_JSON" \
    --messages "$MESSAGES_JSON" \
    --inference-config '{"maxTokens":512,"temperature":0.7}' \
    --output json)
  
  # Extrair resposta do assistente
  ASSISTANT_RESPONSE=$(echo $RESPONSE | jq -r '.output.message.content[0].text')
  
  # Adicionar resposta do assistente ao histórico
  MESSAGES_JSON=$(echo "$MESSAGES_JSON" | jq --arg text "$ASSISTANT_RESPONSE" '. += [{role: "assistant", content: [{text: $text}]}]')
  
  # Mostrar resposta
  echo ""
  echo "🎫 Assistente:"
  echo "$ASSISTANT_RESPONSE"
  echo ""
  
  # Métricas (opcional, comentado para não poluir)
  # INPUT_TOKENS=$(echo $RESPONSE | jq -r '.usage.inputTokens')
  # OUTPUT_TOKENS=$(echo $RESPONSE | jq -r '.usage.outputTokens')
  # echo "📊 Tokens: $INPUT_TOKENS in / $OUTPUT_TOKENS out"
  # echo ""
done
