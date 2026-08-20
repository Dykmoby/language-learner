import { query } from '@anthropic-ai/claude-agent-sdk';
for await (const msg of query({
  prompt: 'Reply with the single word: ok',
  options: {
    model: 'claude-opus-5',
    systemPrompt: 'You reply with one word.',
    tools: [], skills: [], settingSources: [], strictMcpConfig: true, maxTurns: 1,
    env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
  },
} as any)) {
  const m = msg as any;
  if (m.type === 'result') console.log('RESULT usage =', JSON.stringify(m.usage, null, 2), '\nmodelUsage =', JSON.stringify(m.modelUsage ?? null, null, 2));
  if (m.type === 'assistant') console.log('ASSISTANT usage =', JSON.stringify(m.message?.usage ?? null));
}
