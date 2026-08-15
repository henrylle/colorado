// V9 - GUARDRAIL: o mesmo v8, com uma trava de segurança em volta
//
// O fluxo é IDÊNTICO ao v8 — RAG, tool, cache, tudo igual. As três
// diferenças estão marcadas com [GUARDRAIL]:
//
//   1. guardrailConfig no ConverseCommand
//   2. stopReason novo: "guardrail_intervened"
//   3. trace: o que foi pego, de que lado, e qual ação
//
//   pergunta do usuário
//        │
//        ├─► GUARDRAIL entrada ... bloqueou? o modelo NEM RODA. usage zerado.
//        │
//        ├─► RETRIEVAL / AUGMENTED / GENERATION   (o v8 inteiro, sem alteração)
//        │
//        └─► GUARDRAIL saída  ... bloqueou? a geração já foi paga.
//
// Bloquear na entrada é de graça em token. Bloquear na saída, não.
//
// Uso:  GUARDRAIL_ID=<id> node v9-guardrail.mjs

import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
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

// [GUARDRAIL] ───────────────────────────────────────────────────────────
// O ID sai do `aws bedrock list-guardrails` ou da console.
// DRAFT: toda alteração na console vale na hora, sem publicar. Produção usa
// versão numerada (create-guardrail-version), aí o comportamento congela.
const GUARDRAIL_ID = process.env.GUARDRAIL_ID ?? "9f09uqw8s8hs";
const GUARDRAIL_VERSION = process.env.GUARDRAIL_VERSION ?? "3";

// GUARDRAIL_ID=off desliga: a request sai SEM o guardrailConfig, e o programa
// volta a ser exatamente o v8. É o jeito de mostrar o antes e o depois ao vivo,
// sem editar código no meio da aula.
//
//   GUARDRAIL_ID=off node v9-guardrail.mjs        desligado
//   GUARDRAIL_ID=outro-id node v9-guardrail.mjs   troca de guardrail
//
// O SDK omite campo undefined na serialização, então não vai nada na request.
const guardrailConfig =
  GUARDRAIL_ID === "off"
    ? undefined
    : {
        guardrailIdentifier: GUARDRAIL_ID,
        guardrailVersion: GUARDRAIL_VERSION,
        // trace "enabled" é o que faz o motivo do bloqueio voltar
        trace: "enabled",
      };

// detalhe() imprime o que é "bom saber": trechos do RAG, painel de token,
// painel do KB. Tudo isso é do v8 e não tem a ver com guardrail.
// SO_GUARDRAIL=1 emudece essas linhas — é o modo de gravar a aula sem o
// console rolando sozinho. Sem a variável, nada muda.
// ponytail: vira função vazia quando calado. Sem lib de log.
// O que é do guardrail usa console.log e nunca some.
const detalhe = process.env.SO_GUARDRAIL === "1" ? () => {} : console.log;

// Mostra o que o guardrail pegou. Sem `trace: "enabled"` na request isso
// volta vazio e você só sabe QUE bloqueou, nunca POR QUE.
function mostrarGuardrail(trace) {
  const g = trace?.guardrail;
  if (!g) return;

  for (const [lado, mapa] of [
    ["entrada", g.inputAssessment],
    ["saída  ", g.outputAssessments],
  ]) {
    for (const a of Object.values(mapa ?? {}).flat()) {
      const s = a.sensitiveInformationPolicy;
      const achados = [
        ...(a.contentPolicy?.filters ?? []).map((f) => `${f.type} · ${f.action}`),
        ...(s?.piiEntities ?? []).map((p) => `${p.type} "${p.match}" · ${p.action}`),
        ...(s?.regexes ?? []).map((r) => `${r.name} "${r.match}" · ${r.action}`),
      ];
      for (const linha of achados) console.log(`🛡️  ${lado}: ${linha}`);
    }
  }
}
// ───────────────────────────────────────────────────────────────────────

const KB_ID = "GD1X7FDFTW";
const TOP_K = 20;
const RERANKING = process.env.RERANKING ?? "MANAGED";
const SCORE_MINIMO = Number(process.env.SCORE_MINIMO ?? 0.5);

const kbClient = new BedrockAgentRuntimeClient({
  region: "us-east-1",
  profile: "formacaoaws",
});

async function buscar(pergunta) {
  const resposta = await kbClient.send(
    new RetrieveCommand({
      knowledgeBaseId: KB_ID,
      retrievalQuery: { text: pergunta },
      retrievalConfiguration: {
        managedSearchConfiguration: {
          numberOfResults: TOP_K,
          rerankingModelType: RERANKING,
        },
      },
    })
  );

  return (resposta.retrievalResults ?? []).map((r) => ({
    fonte: r.location?.s3Location?.uri?.split("/").slice(-2).join("/") ?? "?",
    score: r.score ?? 0,
    texto: r.content?.text ?? "",
  }));
}

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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(scriptDir, "..", "prompt-valendo.txt"), "utf-8");

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

console.log("🤖 Chatbot de Venda de Ingressos - V9 Guardrail");
console.log("===============================================");
console.log("");
detalhe("📄 System prompt carregado de: prompt-valendo.txt");
detalhe("🗄️  Cache: 1h (system prompt)");
detalhe(`📚 Knowledge Base: ${KB_ID} (top ${TOP_K}, rerank ${RERANKING}, score mín ${SCORE_MINIMO})`);
detalhe("🔧 Tools: consultar_matricula, gerar_link_pagamento");
console.log(
  guardrailConfig
    ? `🛡️  Guardrail: ${GUARDRAIL_ID} (${GUARDRAIL_VERSION})`
    : "🛡️  Guardrail: DESLIGADO — request sem guardrailConfig (igual ao v8)"
);
console.log("");
console.log("💡 Teste (usa o KB):     'quanto custa o ingresso VIP?'");
console.log("💡 Teste (guardrail):    'quero pagar, meu email é joao@email.com'");
console.log("💡 Teste (cartão):       'meu cartão é 4111 1111 1111 1111'");
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

  const encontrados = await buscar(userInput);
  const trechos = encontrados.filter((t) => t.score >= SCORE_MINIMO);

  detalhe(`\n📚 RAG: ${encontrados.length} trechos, ${trechos.length} acima de ${SCORE_MINIMO}`);
  for (const t of encontrados) {
    const marca = t.score >= SCORE_MINIMO ? "✓" : "✗";
    detalhe(`   ${marca} ${t.score.toFixed(3)}  ${t.fonte}`);
  }

  const mensagemAumentada = montarMensagem(userInput, trechos);
  const charsKB = trechos.reduce((s, t) => s + t.texto.length, 0);

  const idxPergunta = messages.length;
  messages.push({ role: "user", content: [{ text: userInput }] });

  const comContexto = (hist) =>
    hist.map((m, i) =>
      i === idxPergunta ? { role: "user", content: [{ text: mensagemAumentada }] } : m
    );

  let usage = {};
  let bloqueado = false;

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
        messages: comContexto(messages),
        toolConfig,
        inferenceConfig: { maxTokens: 512, temperature: 0.7 },
        // [GUARDRAIL] a linha que liga tudo. undefined = request sem guardrail.
        guardrailConfig,
      })
    );

    usage = response.usage ?? {};

    // [GUARDRAIL] o trace vem em toda resposta, bloqueada ou não
    console.log("");
    mostrarGuardrail(response.trace);

    // [GUARDRAIL] stopReason novo. Não lança exceção: é resposta normal, com
    // o texto de bloqueio que você escreveu na console.
    if (response.stopReason === "guardrail_intervened") {
      const texto = (response.output?.message?.content ?? [])
        .filter((b) => b.text)
        .map((b) => b.text)
        .join("");

      const naEntrada = (usage.inputTokens ?? 0) === 0;
      console.log(
        naEntrada
          ? "🚫 Bloqueado na ENTRADA — o modelo nem foi chamado, zero token."
          : "🚫 Bloqueado na SAÍDA — a geração já foi paga e foi descartada."
      );
      console.log(`\n🎫 Assistente:\n${texto}`);

      // A mensagem não chegou ao modelo. Deixá-la no histórico faria ela ser
      // reenviada — e rebloqueada — em todo turno seguinte.
      messages.length = idxPergunta;
      bloqueado = true;
      break;
    }

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
  detalhe("┌─────────────────────────────────────────┐");
  detalhe("│            📊 Consumo de Tokens          │");
  detalhe("├─────────────────────────────────────────┤");
  detalhe(`│ Input total:        ${String(input).padStart(8)}  tokens  │`);
  detalhe(`│   ├ Cache read:     ${String(cacheRead).padStart(8)}  (10% do preço) │`);
  detalhe(`│   ├ Cache write:    ${String(cacheWrite).padStart(8)}  (200% do preço)│`);
  detalhe(`│   └ Sem cache:      ${String(inputSemCache).padStart(8)}  (preço cheio)│`);
  detalhe(`│ Output:             ${String(output).padStart(8)}  tokens  │`);
  detalhe("└─────────────────────────────────────────┘");

  // [GUARDRAIL] bloqueou = a busca aconteceu, mas nada dela chegou ao modelo.
  // O painel do KB abaixo mediria um contexto que ninguém leu.
  if (bloqueado) { console.log(""); continue; }

  const LARGURA = 41;
  const linha = (txt) => detalhe("│" + txt.padEnd(LARGURA - 2) + " │");
  const tokensKB = Math.round(charsKB / 4); // ~4 chars por token, regra de bolso
  const pctInput = input > 0 ? Math.round((tokensKB / input) * 100) : 0;
  const custoQuery = 1.0 / 1_000;

  detalhe("┌─────────────────────────────────────────┐");
  detalhe("│         📚 Consumo do Knowledge Base    │");
  detalhe("├─────────────────────────────────────────┤");
  linha(` Trechos usados:      ${String(trechos.length).padStart(8)}`);
  linha(` Trechos descartados: ${String(encontrados.length - trechos.length).padStart(8)}`);
  linha(` Tokens injetados:   ~${String(tokensKB).padStart(8)}`);
  linha(`   └ do input total:  ${String(pctInput).padStart(7)}%`);
  linha(` Custo da busca:  $${custoQuery.toFixed(8)}`);
  detalhe("└─────────────────────────────────────────┘");
  detalhe("  ↑ a busca é troco. O caro é o texto que ela injeta no contexto.");
  console.log("");
}
