// V7 - RAG: Retrieval → Augmented → Generation
//
// É o v6 + o passo de RAG antes de chamar o modelo. As tools de matrícula e
// pagamento continuam iguais. Tudo que é novo está marcado com [RAG].
//
// O fluxo, que é o próprio acrônimo:
//
//   pergunta do usuário
//        │
//        ├─► RETRIEVAL   ... busca no Knowledge Base (top 5, por score)
//        │
//        ├─► AUGMENTED   ... os trechos entram no contexto da mensagem
//        │
//        └─► GENERATION  ... o modelo responde usando esse contexto
//
// Repare que a busca acontece SEMPRE, antes do modelo ver a pergunta.
// Não é o modelo que decide buscar — é o código.

import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
// [RAG] cliente do Knowledge Base — é outro pacote, não é o bedrock-runtime
import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { createInterface } from "readline";
import { readFileSync, appendFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const MODEL_ID = "us.anthropic.claude-sonnet-4-6";

const client = new BedrockRuntimeClient({
  region: "us-east-1",
  profile: "formacaoaws",
});

// [RAG] ────────────────────────────────────────────────────────────────
const KB_ID = "NP0W7DLVVH"; // KB com S3 Vectors
const TOP_K = 20; // quantos trechos trazer por busca

// Corte por score. Abaixo disso o trecho entra como ruído no contexto.
//
// Este é o número mais importante do arquivo e não existe valor "certo":
// depende da sua base. Aqui, "bom dia" traz 5 trechos entre 0.360 e 0.366,
// todos irrelevantes. Com 0.35 eles passam e você paga ~900 tokens à toa.
//
// Ajuste ao vivo:  SCORE_MINIMO=0.40 node v7-rag.mjs
const SCORE_MINIMO = Number(process.env.SCORE_MINIMO ?? 0.4);

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
      retrievalConfiguration: {
        vectorSearchConfiguration: { numberOfResults: TOP_K },
      },
    })
  );

  return (resposta.retrievalResults ?? []).map((r) => ({
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

// [LOG] ────────────────────────────────────────────────────────────────
// Despeja em arquivo, a cada iteração: o SYSTEM, o que voltou do RAG e a
// USER MESSAGE que realmente vai pro modelo. Pra acompanhar em outra aba:
//
//   terminal 1:  LOG=rag.log node scripts/sdk-node/v7-rag.mjs
//   terminal 2:  tail -F rag.log
//
// Sem a variável LOG, não escreve nada e o programa roda igual.
const LOG = process.env.LOG ?? "";
const tk = (s) => Math.round(s.length / 4); // ~4 chars/token, regra de bolso
                                            // (subestima português em ~50%)

function logar(txt) {
  if (LOG) appendFileSync(LOG, txt + "\n");
}

let systemJaLogado = false;

// O system não muda entre turnos neste programa. Despeja inteiro na primeira
// vez e depois só confirma o tamanho — senão o tail vira parede de texto.
function logSystem(blocos) {
  if (!LOG) return;
  const texto = blocos.filter((b) => b.text).map((b) => b.text).join("\n");
  const cache = blocos.find((b) => b.cachePoint)?.cachePoint;

  let out = `\n── SYSTEM  (${texto.length} chars ≈ ${tk(texto)} tokens)`;
  if (cache) out += `  + cachePoint ${cache.type}/${cache.ttl}`;

  if (!systemJaLogado) {
    out += `\n` + texto.split("\n").map((l) => "   │ " + l).join("\n");
    systemJaLogado = true;
  } else {
    out += `\n   │ (inalterado — conteúdo na primeira iteração do log)`;
  }
  logar(out);
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

console.log("🤖 Chatbot de Venda de Ingressos - V7 RAG");
console.log("=========================================");
console.log("");
console.log("📄 System prompt carregado de: prompt-valendo.txt");
console.log("🗄️  Cache: 1h (system prompt)");
console.log(`📚 Knowledge Base: ${KB_ID} (S3 Vectors, top ${TOP_K}, score mín ${SCORE_MINIMO})`);
console.log("🔧 Tools: consultar_matricula, gerar_link_pagamento");
console.log("");
console.log("💡 Teste (usa o KB): 'quanto custa o ingresso VIP?'");
console.log("💡 Teste (usa tool): 'quero pagar, meu email é joao@email.com'");
console.log("💡 Teste (nada relevante): 'bom dia, tudo certo?'");
console.log("💡 Digite 'sair' para encerrar");
console.log("");

let running = true;
rl.on("close", () => { running = false; });

// [LOG] zera o arquivo no início da sessão
if (LOG) {
  writeFileSync(LOG, `# v7-rag.mjs · KB ${KB_ID} · top ${TOP_K} · score mín ${SCORE_MINIMO}\n`);
  console.log(`📝 Log: ${LOG}   (acompanhe com: tail -F ${LOG})`);
  console.log("");
}

let turnoConversa = 0;

while (running) {
  const userInput = await ask("👤 Você: ");

  if (!running || userInput === "sair") {
    console.log("👋 Até logo!");
    rl.close();
    break;
  }

  turnoConversa++;

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

  // [LOG] o que voltou do RAG
  logar(
    `\n${"═".repeat(70)}\nTURNO ${turnoConversa}  ·  ${new Date().toLocaleTimeString("pt-BR")}\n` +
    `${"═".repeat(70)}\n` +
    `── PERGUNTA DO USUÁRIO\n   │ ${userInput}\n` +
    `\n── RAG  (${encontrados.length} trechos, corte ${SCORE_MINIMO})\n` +
    encontrados
      .map((t) => `   ${t.score >= SCORE_MINIMO ? "✓" : "✗"} ${t.score.toFixed(3)}  ${t.fonte}  (${t.texto.length} chars)`)
      .join("\n") +
    `\n   → ${trechos.length} usados · ${charsKB} chars ≈ ${tk(mensagemAumentada) - tk(userInput)} tokens injetados`
  );

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
  //     [4] user      "e o certificado?"        ← idxPergunta
  //
  //   comContexto(messages)  (o que vai pro modelo AGORA)
  //     [0] [1] [2] [3]  ...iguais, sem trecho nenhum
  //     [4] user      "<contexto>...</contexto> ... e o certificado?"
  //
  // O array original nunca é alterado — `map` cria outro. No próximo turno
  // o [4] volta a ser a pergunta limpa e quem ganha contexto é o [6].
  // É isso que segura o input em ~4900 tokens em vez de subir pra 9179.
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

    const system = [
      { text: systemPrompt },
      { cachePoint: { type: "default", ttl: "1h" } },
    ];
    const messagesEnviadas = comContexto(messages); // [RAG] contexto só neste turno

    // [LOG] o request desta iteração
    logar(`\n${"─".repeat(70)}\nITERAÇÃO ${turno + 1}\n${"─".repeat(70)}`);
    logSystem(system);
    logar(
      `\n── USER MESSAGE  (o que de fato vai pro modelo neste turno)\n` +
      messagesEnviadas[idxPergunta].content[0].text
        .split("\n").map((l) => "   │ " + l).join("\n") +
      `\n\n── HISTÓRICO  (${messagesEnviadas.length} mensagens no array)\n` +
      messagesEnviadas
        .map((m, i) => {
          // uma mensagem pode ter vários blocos: texto + toolUse na mesma
          const tipo = m.content
            .map((c) =>
              c.toolUse
                ? `toolUse ${c.toolUse.name}(${JSON.stringify(c.toolUse.input)})`
                : c.toolResult
                ? `toolResult ${JSON.stringify(c.toolResult.content)}`
                : c.text !== undefined
                ? `${c.text.length} chars`
                : Object.keys(c)[0]
            )
            .join(" + ");
          return `   [${i}] ${m.role.padEnd(9)} ${tipo}${i === idxPergunta ? "  ← com contexto do RAG" : ""}`;
        })
        .join("\n")
    );

    const response = await client.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system,
        messages: messagesEnviadas,
        toolConfig,
        inferenceConfig: { maxTokens: 512, temperature: 0.7 },
      })
    );

    usage = response.usage ?? {};

    // [LOG] o que a AWS cobrou de verdade
    logar(
      `\n── RESPOSTA  stopReason=${response.stopReason}\n` +
      `   input=${usage.inputTokens}  cacheRead=${usage.cacheReadInputTokens ?? 0}  ` +
      `cacheWrite=${usage.cacheWriteInputTokens ?? 0}  output=${usage.outputTokens}`
    );

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
  const custoQuery = 2.5 / 1_000_000; // S3 Vectors: $2.50 por milhão de queries

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
