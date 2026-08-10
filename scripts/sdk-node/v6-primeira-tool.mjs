// V6 - Primeira Tool: o agente consulta a matrícula do aluno
//
// Sem streaming de propósito: aqui o conceito novo é o loop de tool use.
// A versão com streaming vem depois (v7).

import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { createInterface } from "readline";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const MODEL_ID = "us.anthropic.claude-sonnet-4-6";

const client = new BedrockRuntimeClient({
  region: "us-east-1",
  profile: "formacaoaws",
});

const scriptDir = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(scriptDir, "..", "prompt-valendo.txt"), "utf-8");

// 1. A "base de dados" da tool
// ponytail: map em memória; troca por DynamoDB/RDS quando existir de verdade
const ALUNOS = {
  "maria@email.com": { nome: "Maria", ingresso: "VIP", status: "confirmado", pedido: "HP-88213", data_pagamento: "01/01/2027" },
  "joao@email.com": { nome: "João", ingresso: "Normal", status: "pendente", pedido: "HP-77104" },
};

function consultarMatricula({ email }) {
  const aluno = ALUNOS[email.trim().toLowerCase()];
  return aluno ? { encontrado: true, ...aluno } : { encontrado: false };
}

// ponytail: link fixo; troca por gateway (Stripe/Pagar.me) quando existir checkout de verdade
const LINK_PAGAMENTO = "https://formacaoaws.com.br/link-pagamento";

function gerarLinkPagamento({ email }) {
  const limpo = (email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo)) {
    return { gerado: false, motivo: "e-mail inválido" };
  }
  return { gerado: true, email: limpo, link: LINK_PAGAMENTO };
}

// 2. A declaração da tool para o modelo
//    description é o que o modelo lê pra decidir SE chama a tool.
//    Prompt ruim aqui = tool que nunca dispara (ou dispara sempre).
const toolConfig = {
  tools: [
    {
      toolSpec: {
        name: "consultar_matricula",
        description:
          "Consulta a matrícula de um aluno pelo e-mail de compra. " +
          "Use quando a pessoa perguntar se a compra dela foi confirmada, " +
          "qual ingresso ela tem, ou o número do pedido. " +
          "Só chame se a pessoa já tiver informado o e-mail. Se a pessoa disse que vai pra lua, chame a tool, pois o ingresso tambem leva pra lua.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              email: { type: "string", description: "E-mail usado na compra do ingresso" },
            },
            required: ["email"],
          },
        },
      },
    },
    {
      toolSpec: {
        name: "gerar_link_pagamento",
        description:
          "Gera o link de pagamento do ingresso. " +
          "Use quando a pessoa quiser comprar, pagar ou finalizar a compra. " +
          "Só chame depois que a pessoa informar o e-mail.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              email: { type: "string", description: "E-mail para envio do link de pagamento" },
            },
            required: ["email"],
          },
        },
      },
    },
  ],
};

// Executor local: nome da tool -> função
const EXECUTORES = {
  consultar_matricula: consultarMatricula,
  gerar_link_pagamento: gerarLinkPagamento,
};

const MAX_TURNOS_TOOL = 5;

const messages = [];

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

console.log("🤖 Chatbot de Venda de Ingressos - V6 Primeira Tool");
console.log("===================================================");
console.log("");
console.log("📄 System prompt carregado de: prompt-valendo.txt");
console.log("🗄️  Cache: 1h (system prompt)");
console.log("🔧 Tools disponíveis: consultar_matricula(email), gerar_link_pagamento(email)");
console.log("💡 Teste: 'minha compra saiu? meu email é maria@email.com'");
console.log("💡 Teste: 'quero pagar, meu email é joao@email.com'");
console.log("💡 Digite 'sair' para encerrar");
console.log("");

let running = true;
rl.on("close", () => { running = false; });

while (running) {
  const userInput = await ask("👤 Você: ");

  if (!running || userInput === "sair") {
    console.log("👋 Até logo!");
    rl.close();
    break;
  }

  messages.push({ role: "user", content: [{ text: userInput }] });

  let usage = {};

  // 3. O loop de tool use
  //    O modelo pode pedir a tool, ler o resultado e pedir OUTRA.
  //    Por isso é loop, não if.
  //    O teto existe pra um loop maluco não torrar token: cada volta
  //    é uma request cobrada.
  for (let turno = 0; ; turno++) {
    if (turno >= MAX_TURNOS_TOOL) {
      console.log(`\n⚠️  Limite de ${MAX_TURNOS_TOOL} chamadas de tool atingido. Parando.`);
      break;
    }

    const response = await client.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [
          { text: systemPrompt },
          //{ text: "Você tem a tool consultar_matricula. Peça o e-mail antes de usá-la. Nunca invente dados de matrícula." },
          { cachePoint: { type: "default", ttl: "1h" } },
        ],
        messages,
        toolConfig,
        inferenceConfig: { maxTokens: 512, temperature: 0.7 },
      })
    );

    usage = response.usage ?? {};
    const assistantMessage = response.output.message;

    // Sempre devolve a resposta do modelo pro histórico, inclusive o bloco toolUse
    messages.push(assistantMessage);

    if (response.stopReason !== "tool_use") {
      const assistantText = assistantMessage.content
        .filter((b) => b.text)
        .map((b) => b.text)
        .join("");

      process.stdout.write("\n🎫 Assistente:\n");
      process.stdout.write(assistantText);
      break;
    }

    // 4. Executa cada tool pedida e devolve os toolResult
    //    Regra: um toolResult por toolUse, todos na MESMA mensagem user.
    const toolResults = [];

    for (const bloco of assistantMessage.content) {
      if (!bloco.toolUse) continue;

      const { toolUseId, name, input } = bloco.toolUse;
      console.log(`\n🔧 Tool chamada: ${name}(${JSON.stringify(input)})`);

      const executor = EXECUTORES[name];
      const resultado = executor
        ? executor(input)
        : { erro: `tool desconhecida: ${name}` };

      console.log(`   ↳ resultado: ${JSON.stringify(resultado)}`);

      toolResults.push({
        toolResult: {
          toolUseId,
          content: [{ json: resultado }],
          status: executor ? "success" : "error",
        },
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheWrite = usage.cacheWriteInputTokens ?? 0;
  const inputSemCache = usage.inputTokens ?? 0;
  const input = inputSemCache + cacheRead;

  console.log("\n");
  console.log("┌─────────────────────────────────────────┐");
  console.log("│            📊 Consumo de Tokens          │");
  console.log("├─────────────────────────────────────────┤");
  console.log(`│ Input total:        ${String(input).padStart(8)}  tokens  │`);
  console.log(`│   ├ Cache read:     ${String(cacheRead).padStart(8)}  (10% do preço) │`);
  console.log(`│   ├ Cache write:    ${String(cacheWrite).padStart(8)}  (200% do preço)│`);
  console.log(`│   └ Sem cache:      ${String(inputSemCache).padStart(8)}  (preço cheio)│`);
  console.log(`│ Output:             ${String(output).padStart(8)}  tokens  │`);
  console.log("└─────────────────────────────────────────┘");
  console.log("");
}
