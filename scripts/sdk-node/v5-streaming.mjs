// V5 - Streaming com SDK Node.js
// Versão com ConverseStreamCommand para respostas em tempo real

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

console.log("🤖 Chatbot de Venda de Ingressos - V5 Streaming (Node.js)");
console.log("==========================================================");
console.log("");
console.log("📄 System prompt carregado de: prompt-valendo.txt");
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
      system: [{ text: systemPrompt }],
      messages,
      inferenceConfig: { maxTokens: 512, temperature: 0.7 },
    })
  );

  process.stdout.write("\n🎫 Assistente:\n");

  let assistantText = "";
  for await (const event of response.stream) {
    if (event.contentBlockDelta?.delta?.text) {
      const chunk = event.contentBlockDelta.delta.text;
      process.stdout.write(chunk);
      assistantText += chunk;
    }
  }

  messages.push({ role: "assistant", content: [{ text: assistantText }] });
  console.log("\n");
}
