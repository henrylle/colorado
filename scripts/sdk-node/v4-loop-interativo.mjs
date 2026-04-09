// V4 - Loop Interativo com SDK Node.js
// Versão Node.js do v4-loop-interativo.sh usando @aws-sdk/client-bedrock-runtime

import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { createInterface } from "readline";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

const client = new BedrockRuntimeClient({
  region: "us-east-1",
  profile: "seattle",
});

// Ler system prompt do arquivo externo (mesmo do shell)
const scriptDir = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(scriptDir, "..", "prompt-valendo.txt"), "utf-8");

const messages = [];

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

console.log("🤖 Chatbot de Venda de Ingressos - V4 Loop Interativo (Node.js)");
console.log("================================================================");
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
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: systemPrompt }],
      messages,
      inferenceConfig: { maxTokens: 512, temperature: 0.7 },
    })
  );

  const assistantText = response.output.message.content[0].text;
  messages.push({ role: "assistant", content: [{ text: assistantText }] });

  console.log("\n🎫 Assistente:");
  console.log(assistantText);
  console.log("");
}
