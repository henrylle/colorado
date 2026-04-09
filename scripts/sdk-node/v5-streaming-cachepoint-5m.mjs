// V5 - Streaming com Cache Point no System Prompt (5 min)

import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { createInterface } from "readline";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const MODEL_ID = "us.anthropic.claude-sonnet-4-6";

const client = new BedrockRuntimeClient({
  region: "us-east-1",
  profile: "seattle",
});

const scriptDir = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(scriptDir, "..", "prompt-valendo.txt"), "utf-8");

const messages = [];

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

console.log("🤖 Chatbot de Venda de Ingressos - V5 Streaming + Cache Point");
console.log("===============================================================");
console.log("");
console.log("📄 System prompt carregado de: prompt-valendo.txt");
console.log("🗄️  Cache: 5min (system prompt)");
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

  const response = await client.send(
    new ConverseStreamCommand({
      modelId: MODEL_ID,
      system: [
        { text: systemPrompt },
        { cachePoint: { type: "default", ttl: "5m" } },
      ],
      messages,
      inferenceConfig: { maxTokens: 512, temperature: 0.7 },
    })
  );

  process.stdout.write("\n🎫 Assistente:\n");

  let assistantText = "";
  let usage = {};

  for await (const event of response.stream) {
    if (event.contentBlockDelta?.delta?.text) {
      const chunk = event.contentBlockDelta.delta.text;
      process.stdout.write(chunk);
      assistantText += chunk;
    }
    if (event.metadata?.usage) {
      usage = event.metadata.usage;
    }
  }

  messages.push({ role: "assistant", content: [{ text: assistantText }] });

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
  console.log(`│   ├ Cache write:    ${String(cacheWrite).padStart(8)}  (125% do preço)│`);
  console.log(`│   └ Sem cache:      ${String(inputSemCache).padStart(8)}  (preço cheio)│`);
  console.log(`│ Output:             ${String(output).padStart(8)}  tokens  │`);
  console.log("└─────────────────────────────────────────┘");
  console.log("");
}
