// V8 - RAG no KB GERENCIADO: mesmo v7, outro Knowledge Base
//
// O fluxo é IDÊNTICO ao v7 — retrieval, augmented, generation. Só o
// Knowledge Base mudou. As diferenças estão marcadas com [MANAGED]:
//
//   1. sem retrievalConfiguration (o managed rejeita)
//   2. sem TOP_K — quem decide quantos trechos vêm é o serviço
//   3. score em outra escala (~1.00 aqui, ~0.41 no v7)
//   4. retrieval custa $1.00/mil, contra $2.50/milhão no v7
//
//   pergunta do usuário
//        │
//        ├─► RETRIEVAL   ... busca no Knowledge Base gerenciado
//        │
//        ├─► AUGMENTED   ... os trechos entram no contexto da mensagem
//        │
//        └─► GENERATION  ... o modelo responde usando esse contexto
//
// Repare que a busca acontece SEMPRE, antes do modelo ver a pergunta.
// Não é o modelo que decide buscar — é o código.
//
// Roda o v7 e o v8 lado a lado com a mesma pergunta: é a aula inteira.

import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
// [RAG] cliente do Knowledge Base — é outro pacote, não é o bedrock-runtime
import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { createInterface } from "readline";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const MODEL_ID = "us.anthropic.claude-sonnet-4-6";

const client = new BedrockRuntimeClient({
  region: "us-east-1",
  profile: "formacaoaws",
});

// [MANAGED] ────────────────────────────────────────────────────────────
const KB_ID = "GD1X7FDFTW"; // KB GERENCIADO (type: MANAGED)

// TOP_K existe aqui também — só muda o nome do objeto de configuração.
// O managed rejeita `vectorSearchConfiguration` e aceita
// `managedSearchConfiguration`. Range: 1 a 100.
//
// Sem isso o serviço devolve 5 por padrão. Foi o que fez o "19h59" parecer
// perdido numa medição nossa: ele estava em 8º, e a gente só pedia 5.
const TOP_K = 20; // mesmo valor do v7, pra comparação justa

// Reranking — botão que o S3 Vectors não tem.
//   MANAGED (default) · CUSTOM (modelo seu) · NONE (desliga)
//
// Este KB usa embeddingModelType MANAGED, então o reranker gerenciado está
// disponível e sai de graça. Compare ligado e desligado:
//   RERANKING=NONE node v8-rag-managed.mjs
//
// ARMADILHA: se o KB tivesse sido criado com embeddingModelType CUSTOM,
// pedir MANAGED aqui devolveria:
//   ValidationException: Managed reranking is not supported for
//   knowledge bases with custom embedding models.
// Da doc: "Managed reranking is available only for knowledge bases that use
// managed embedding." E o tipo de embedding é imutável depois da criação —
// escolher seu próprio modelo desliga o reranker pra sempre naquele KB.
const RERANKING = process.env.RERANKING ?? "MANAGED";

// Corte por score — MESMA ideia do v7, número completamente diferente.
//
// O managed devolve score em outra escala: no v7 (S3 Vectors) o melhor
// trecho dá ~0.44; aqui dá 1.000, e "bom dia" (irrelevante) dá 0.945.
// Não existe corte que separe os dois — por isso o default é 0.
// Comparar score entre os dois KBs não significa nada; só a ordem é comparável.
const SCORE_MINIMO = Number(process.env.SCORE_MINIMO ?? 0.5);

const kbClient = new BedrockAgentRuntimeClient({
  region: "us-east-1",
  profile: "formacaoaws",
});

// RETRIEVAL: busca os trechos mais parecidos com a pergunta
async function buscar(pergunta) {
  const resposta = await kbClient.send(
    new RetrieveCommand({
      knowledgeBaseId: KB_ID,
      retrievalQuery: { text: pergunta },
      // [MANAGED] managedSearchConfiguration, não vectorSearchConfiguration.
      // Não existe overrideSearchType aqui: a busca é SEMPRE híbrida
      // (vetor + palavra). Semantic-only não é opção no managed.
      retrievalConfiguration: {
        managedSearchConfiguration: {
          numberOfResults: TOP_K,
          rerankingModelType: RERANKING,
        },
      },
    })
  );

  return (resposta.retrievalResults ?? []).map((r) => ({
    // [MANAGED] a uri vem como URL (https://bucket.s3.amazonaws.com/...),
    // não como s3://bucket/... — o split por "/" funciona nos dois
    fonte: r.location?.s3Location?.uri?.split("/").slice(-2).join("/") ?? "?",
    score: r.score ?? 0,
    texto: r.content?.text ?? "",
  }));
}

// AUGMENTED: monta a mensagem que o modelo vai receber.
// A pergunta do usuário vai junto com os trechos, marcados como contexto.
function montarMensagem(pergunta, trechos) {
  if (trechos.length === 0) {
    return (
      `<contexto>\nNenhum trecho relevante encontrado na base.\n</contexto>\n\n` +
      `Pergunta do cliente: ${pergunta}`
    );
  }

  const contexto = trechos
    .map((t, i) => `[${i + 1}] fonte: ${t.fonte}\n${t.texto}`)
    .join("\n\n");

  return (
    `<contexto>\n${contexto}\n</contexto>\n\n` +
    `Responda a pergunta do cliente usando SOMENTE o contexto acima. ` +
    `Se a resposta não estiver lá, diga que não encontrou e ofereça o suporte.\n\n` +
    `Pergunta do cliente: ${pergunta}`
  );
}
// ───────────────────────────────────────────────────────────────────────

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
  // ponytail: a checagem de pagamento duplicado é feita pelo MODELO, encadeando
  // consultar_matricula antes desta tool (é o comportamento que a aula demonstra).
  // Em produção, repetir a checagem aqui dentro — prompt não é garantia.
  return { gerado: true, email: limpo, link: LINK_PAGAMENTO };
}

// 2. A declaração da tool para o modelo — igual ao v6, sem mexer
const toolConfig = {
  tools: [
    {
      toolSpec: {
        name: "consultar_matricula",
        description:
          "Consulta a matrícula de um aluno pelo e-mail de compra. " +
          "Use quando a pessoa perguntar se a compra dela foi confirmada, " +
          "qual ingresso ela tem, ou o número do pedido. " +
          "Só chame se a pessoa já tiver informado o e-mail.",
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
          "Só chame depois que a pessoa informar o e-mail. " +
          "OBRIGATÓRIO antes de chamar esta tool: chame consultar_matricula com o " +
          "mesmo e-mail. Se voltar status 'confirmado', NÃO chame esta tool — a " +
          "pessoa já pagou, avise isso e informe o número do pedido. " +
          "Só gere o link se a matrícula não existir ou não estiver confirmada.",
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

const EXECUTORES = {
  consultar_matricula: consultarMatricula,
  gerar_link_pagamento: gerarLinkPagamento,
};

const MAX_TURNOS_TOOL = 5;

const messages = [];

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

console.log("🤖 Chatbot de Venda de Ingressos - V8 RAG no KB Gerenciado");
console.log("===========================================================");
console.log("");
console.log("📄 System prompt carregado de: prompt-valendo.txt");
console.log("🗄️  Cache: 1h (system prompt)");
console.log(`📚 Knowledge Base: ${KB_ID} (GERENCIADO, top ${TOP_K}, rerank ${RERANKING}, score mín ${SCORE_MINIMO})`);
console.log("🔧 Tools: consultar_matricula, gerar_link_pagamento");
console.log("");
console.log("💡 Teste (usa o KB): 'quanto custa o ingresso VIP?'");
console.log("💡 Teste (usa tool): 'quero pagar, meu email é joao@email.com'");
console.log("💡 Teste (nada relevante): 'bom dia, tudo certo?'");
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

  // [RAG] ──────────────────────────────────────────────────────────────
  // RETRIEVAL — acontece aqui, antes do modelo. Sempre.
  const encontrados = await buscar(userInput);
  const trechos = encontrados.filter((t) => t.score >= SCORE_MINIMO);

  console.log(`\n📚 RAG: ${encontrados.length} trechos, ${trechos.length} acima de ${SCORE_MINIMO}`);
  for (const t of encontrados) {
    const marca = t.score >= SCORE_MINIMO ? "✓" : "✗";
    console.log(`   ${marca} ${t.score.toFixed(3)}  ${t.fonte}`);
  }

  // AUGMENTED — a pergunta vai pro modelo junto com os trechos
  const mensagemAumentada = montarMensagem(userInput, trechos);
  const charsKB = trechos.reduce((s, t) => s + t.texto.length, 0);

  // O histórico guarda a pergunta LIMPA. Os trechos entram só na hora de
  // enviar, no turno em que foram buscados.
  //
  // Guardar a mensagem aumentada no histórico é o erro clássico de RAG:
  // os trechos de todo turno ficam lá pra sempre e são reenviados sempre.
  // Medido nesta base: input vai a 4796 → 6320 → 7780 → 9179 em 4 turnos,
  // carregando ~3700 tokens de trecho velho que ninguém mais usa.
  const idxPergunta = messages.length;
  messages.push({ role: "user", content: [{ text: userInput }] });

  // Devolve uma CÓPIA do histórico com uma única mensagem trocada: a deste
  // turno (índice idxPergunta), que sai como pergunta limpa e volta com os
  // trechos colados. Todas as outras passam intactas.
  //
  //   messages[]  (o que fica guardado, turno 3 de uma conversa)
  //     [0] user      "quanto custa o normal?"
  //     [1] assistant "R$ 47..."
  //     [2] user      "e o VIP?"
  //     [3] assistant "R$ 97..."
  //     [4] user      "e o certificado?"        <- idxPergunta
  //
  //   comContexto(messages)  (o que vai pro modelo AGORA)
  //     [0] [1] [2] [3]  ...iguais, sem trecho nenhum
  //     [4] user      "<contexto>...</contexto> ... e o certificado?"
  //
  // O array original nunca e alterado - `map` cria outro. No proximo turno
  // o [4] volta a ser a pergunta limpa e quem ganha contexto e o [6].
  // E isso que segura o input constante em vez de crescer a cada turno.
  const comContexto = (hist) =>
    hist.map((m, i) =>
      i === idxPergunta ? { role: "user", content: [{ text: mensagemAumentada }] } : m
    );
  // ─────────────────────────────────────────────────────────────────────

  let usage = {};

  // GENERATION — daqui pra baixo é o v6 sem alteração
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
          { cachePoint: { type: "default", ttl: "1h" } },
        ],
        messages: comContexto(messages), // [RAG] contexto só neste turno
        toolConfig,
        inferenceConfig: { maxTokens: 512, temperature: 0.7 },
      })
    );

    usage = response.usage ?? {};
    const assistantMessage = response.output.message;

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

  // [RAG] o painel que mostra que RAG não é de graça
  const LARGURA = 41;
  const linha = (txt) => console.log("│" + txt.padEnd(LARGURA - 2) + " │");
  const tokensKB = Math.round(charsKB / 4); // ~4 chars por token, regra de bolso
  const pctInput = input > 0 ? Math.round((tokensKB / input) * 100) : 0;
  // [MANAGED] $1.00 por MIL retrievals. No v7 (S3 Vectors) era $2.50 por MILHÃO.
  const custoQuery = 1.0 / 1_000;

  console.log("┌─────────────────────────────────────────┐");
  console.log("│         📚 Consumo do Knowledge Base    │");
  console.log("├─────────────────────────────────────────┤");
  linha(` Trechos usados:      ${String(trechos.length).padStart(8)}`);
  linha(` Trechos descartados: ${String(encontrados.length - trechos.length).padStart(8)}`);
  linha(` Tokens injetados:   ~${String(tokensKB).padStart(8)}`);
  linha(`   └ do input total:  ${String(pctInput).padStart(7)}%`);
  linha(` Custo da busca:  $${custoQuery.toFixed(8)}`);
  console.log("└─────────────────────────────────────────┘");
  console.log("  ↑ a busca é troco. O caro é o texto que ela injeta no contexto.");
  console.log("");
}
