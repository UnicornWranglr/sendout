import type { VercelRequest, VercelResponse } from '@vercel/node'

interface GenerateBody {
  clientName: string
  hiringCompany: string
  roleTitle: string
  keyRequirements: string
  weeklyActivity: string
  marketObservations?: string
}

const REQUIRED_FIELDS: (keyof GenerateBody)[] = [
  'clientName',
  'hiringCompany',
  'roleTitle',
  'keyRequirements',
  'weeklyActivity',
]

function buildPrompt(b: GenerateBody): string {
  return `You are a senior recruitment consultant writing a professional update to a client contact.

Here is the context:

Client contact name: ${b.clientName}
Hiring company: ${b.hiringCompany}
Role being recruited: ${b.roleTitle}

Key requirements for the role:
${b.keyRequirements}

This week's recruitment activity (raw notes):
${b.weeklyActivity}
${b.marketObservations ? `\nMarket observations:\n${b.marketObservations}` : ''}

Write a polished, professional client update. Guidelines:
- Open with a brief subject line (prefix with "Subject: ")
- Start with a warm but professional opener addressed to ${b.clientName}
- Summarise the week's activity clearly and concisely — what was done, who was approached, where the pipeline stands
- Flag any standout candidates or notable progress with appropriate enthusiasm but measured language
- If market observations were provided, weave them in naturally as valuable intel
- Close with a confident next-steps statement
- Sign off as the consultant (no name needed — just "Best regards," and leave a blank line)
- Tone: consultative, confident, direct. Not salesy. Not overly formal. Like a trusted advisor giving a meaningful update.
- Length: 150–250 words. Concise is better.

Output only the update — no commentary, no explanation.`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'Server misconfigured: ANTHROPIC_API_KEY missing' } })
  }

  const body = (req.body ?? {}) as Partial<GenerateBody>
  for (const field of REQUIRED_FIELDS) {
    const v = body[field]
    if (typeof v !== 'string' || !v.trim()) {
      return res.status(400).json({ error: { message: `Missing required field: ${field}` } })
    }
  }

  const prompt = buildPrompt(body as GenerateBody)

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.json().catch(() => ({}))
      const message = (errBody as { error?: { message?: string } }).error?.message
        ?? `Anthropic request failed (${anthropicRes.status})`
      return res.status(anthropicRes.status).json({ error: { message } })
    }

    const data = (await anthropicRes.json()) as { content: { text: string }[] }
    return res.status(200).json({ text: data.content[0].text })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong'
    return res.status(500).json({ error: { message } })
  }
}
