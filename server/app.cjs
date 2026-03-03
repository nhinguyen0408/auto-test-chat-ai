const path = require('path')
const express = require('express')
const cors = require('cors')
// node-fetch v3 là ESM-only, dùng dynamic import để có hàm fetch
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

// Load .env từ root project (1 level trên thư mục server)
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
})

const app = express()

const PORT = process.env.PORT || 4000
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3030'

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
  }),
)

app.use(express.json())

app.post('/api/claude/generate-test', async (req, res) => {
  // Hỗ trợ cả tên biến dành cho FE (VITE_CLAUDE_API_KEY) lẫn riêng cho server (CLAUDE_API_KEY)
  const apiKey = process.env.CLAUDE_API_KEY || process.env.VITE_CLAUDE_API_KEY
  const model =
    process.env.CLAUDE_MODEL || process.env.VITE_CLAUDE_MODEL || 'claude-3-5-sonnet-latest'

  if (!apiKey) {
    return res.status(500).json({ error: 'Missing CLAUDE_API_KEY in server environment.' })
  }

  
console.log(`apikey: ${apiKey}`)

  const { description, targetUrl, mode } = req.body || {}

  if (!description || typeof description !== 'string') {
    return res.status(400).json({ error: 'description is required and must be a string.' })
  }

  const outputMode = mode === 'cypress' ? 'cypress' : 'json-steps'

  const systemPromptSteps = [
    'Bạn là trợ lý chuyên thiết kế kịch bản test E2E cho web app.',
    'Trả về DUY NHẤT JSON thuần theo schema sau, không thêm giải thích hoặc text bên ngoài:',
    '{',
    '  "id": string,',
    '  "name": string,',
    '  "description": string,',
    '  "steps": [',
    '    {',
    '      "id": string,',
    '      "type": "navigate" | "click" | "type" | "assertText" | "assertVisible" | "assertValidationError",',
    '      "selector"?: string,',
    '      "value"?: string,',
    '      "expected"?: string,',
    '      "timeoutMs"?: number,',
    '      "delayMs"?: number',
    '    }',
    '  ]',
    '}',
    '',
    'Nếu cần navigate lần đầu, dùng URL được cung cấp trong mô tả hoặc targetUrl.',
  ].join('\n')

  const systemPromptCypress = [
    'Bạn là trợ lý chuyên sinh test E2E theo phong cách Cypress.',
    'Nhiệm vụ:',
    '- Sinh ra MỘT file test Cypress dạng JavaScript có thể chạy trong browser context (không require từ Node).',
    '- Sử dụng cú pháp gần giống Cypress (`cy.visit`, `cy.get`, `cy.contains`, `cy.click`, `cy.type`, ...) nhưng giả định rằng phía browser đã có sẵn một đối tượng `cy` được inject để điều khiển DOM của iframe.',
    '- Không import hoặc require thư viện ngoài Node, chỉ dùng JavaScript thuần và API của `cy`.',
    '',
    'QUAN TRỌNG:',
    '- Trả về DUY NHẤT code JavaScript của file test, không bọc trong ``` và không kèm giải thích.',
    '- Không in thêm log/thuyết minh bên ngoài code.',
    '- Có thể export một hàm chính, ví dụ `export async function runCypressLikeTest(cy) { ... }` để phía frontend có thể gọi trực tiếp trong trình duyệt.',
  ].join('\n')

  const systemPrompt = outputMode === 'cypress' ? systemPromptCypress : systemPromptSteps

  const userPromptBase = [
    'Mô tả kịch bản test (tiếng Việt):',
    description,
    '',
    `Target URL: ${targetUrl || 'N/A'}`,
  ]

  const userPromptSteps = [
    ...userPromptBase,
    '',
    'Yêu cầu:',
    '- Thiết kế các step tuần tự, ưu tiên selector ổn định (data-testid nếu có).',
    '- Đảm bảo JSON hợp lệ, không có comment, không bọc trong ```.',
  ].join('\n')

  const userPromptCypress = [
    ...userPromptBase,
    '',
    'Yêu cầu:',
    '- Viết code test theo phong cách Cypress sử dụng đối tượng `cy` đã được cung cấp sẵn trong browser.',
    '- Dùng `cy.visit` với URL ở trên cho bước điều hướng đầu tiên (nếu phù hợp).',
    '- Dùng các lệnh `cy.get`, `cy.contains`, `cy.click`, `cy.type`, `cy.should`... để mô tả thao tác/kiểm tra.',
    '- Không bọc code trong ``` và không thêm bất kỳ mô tả nào bên ngoài code.',
  ].join('\n')

  const userPrompt = outputMode === 'cypress' ? userPromptCypress : userPromptSteps

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return res
        .status(response.status)
        .json({ error: `Claude API error: ${response.status} ${response.statusText}`, detail: text })
    }

    const data = await response.json()
    return res.json(data)
  } catch (err) {
    console.error('Claude proxy error:', err)
    return res.status(500).json({ error: 'Internal error calling Claude API.' })
  }
})

app.listen(PORT, () => {
  console.log(`Claude proxy server listening on http://localhost:${PORT}`)
})

