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

  const { description, targetUrl } = req.body || {}

  if (!description || typeof description !== 'string') {
    return res.status(400).json({ error: 'description is required and must be a string.' })
  }

  const systemPrompt = [
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

  const userPrompt = [
    'Mô tả kịch bản test (tiếng Việt):',
    description,
    '',
    `Target URL: ${targetUrl || 'N/A'}`,
    '',
    'Yêu cầu:',
    '- Thiết kế các step tuần tự, ưu tiên selector ổn định (data-testid nếu có).',
    '- Đảm bảo JSON hợp lệ, không có comment, không bọc trong ```.',
  ].join('\n')

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

