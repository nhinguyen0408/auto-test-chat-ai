import type { TestScenario } from '../App'

export type ModelKey = 'mock' | 'openai' | 'gemini' | 'claude'

export interface AiService {
  generateTestScript: (params: { description: string; targetUrl: string }) => Promise<TestScenario>
}

const mockAiService: AiService = {
  async generateTestScript({ description, targetUrl }) {
    const baseId = `demo-${Date.now()}`

    const steps: TestScenario['steps'] = [
      {
        id: `${baseId}-navigate`,
        type: 'navigate',
        value: targetUrl || 'https://example.org',
      },
      {
        id: `${baseId}-assert-title`,
        type: 'assertVisible',
        selector: 'h1, h2, [data-testid="page-title"]',
      },
    ]

    if (description.toLowerCase().includes('login')) {
      steps.push(
        {
          id: `${baseId}-type-username`,
          type: 'type',
          selector: 'input[name="username"], input[type="email"], [data-testid="username"]',
          value: 'demo@example.com',
        },
        {
          id: `${baseId}-type-password`,
          type: 'type',
          selector: 'input[name="password"], input[type="password"], [data-testid="password"]',
          value: 'Password123!',
        },
        {
          id: `${baseId}-click-submit`,
          type: 'click',
          selector: 'button[type="submit"], [data-testid="login-submit"]',
        },
      )
    }

    return {
      id: baseId,
      name: 'Kịch bản demo từ AI mock',
      description:
        description ||
        'Kịch bản demo được sinh từ mock AI. Khi nối API thật, JSON sẽ theo cùng schema.',
      steps,
    }
  },
}

async function callClaudeGenerateTestScript(params: {
  description: string
  targetUrl: string
}): Promise<TestScenario> {
  const baseUrl = import.meta.env.VITE_CLAUDE_PROXY_URL ?? 'http://localhost:4000'

  const response = await fetch(`${baseUrl}/api/claude/generate-test`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Claude proxy lỗi: ${response.status} ${response.statusText} ${text}`)
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>
  }

  const textContent =
    data.content?.find((c) => c.type === 'text')?.text ??
    JSON.stringify(
      {
        id: `fallback-${Date.now()}`,
        name: 'Kịch bản từ Claude (fallback)',
        description: params.description,
        steps: [],
      },
      null,
      2,
    )

  const cleaned = textContent
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()

  let parsed: TestScenario
  try {
    parsed = JSON.parse(cleaned) as TestScenario
  } catch (err) {
    throw new Error(`Không parse được JSON từ Claude: ${(err as Error).message}`)
  }

  if (!parsed.steps || !Array.isArray(parsed.steps)) {
    throw new Error('JSON từ Claude không có trường steps hợp lệ.')
  }

  return parsed
}

export const createAiService = (model: ModelKey): AiService => {
  if (model === 'claude') {
    return {
      async generateTestScript(params) {
        // Ném lỗi từ Claude ra cho layer UI xử lý, không fallback sang mock.
        return callClaudeGenerateTestScript(params)
      },
    }
  }

  return mockAiService
}

