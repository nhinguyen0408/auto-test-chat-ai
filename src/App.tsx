import { useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import Editor from '@monaco-editor/react'
import { createAiService, type ModelKey } from './services/aiService'
import './App.css'

type StepType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'assertText'
  | 'assertVisible'
  | 'assertValidationError'

export interface TestStep {
  id: string
  type: StepType
  selector?: string
  value?: string
  expected?: string
  timeoutMs?: number
  delayMs?: number
}

export interface TestScenario {
  id: string
  name: string
  description: string
  steps: TestStep[]
}

export type StepStatus = 'idle' | 'running' | 'pass' | 'fail'

export interface StepResult {
  stepId: string
  index: number
  status: StepStatus
  message: string
  timestamp: number
}

export interface TestResult {
  scenarioId: string
  startedAt: number
  finishedAt: number
  steps: StepResult[]
}

interface RunOptions {
  continueOnFail?: boolean
}

async function delay(ms: number) {
  if (!ms) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type OutputMode = 'json' | 'cypress'

async function runScenarioOnIframe(
  iframe: HTMLIFrameElement,
  scenario: TestScenario,
  options: RunOptions = {},
  onStepResult?: (result: StepResult) => void,
): Promise<TestResult> {
  const { continueOnFail = true } = options
  const startedAt = Date.now()
  const results: StepResult[] = []

  const doc = iframe.contentDocument
  if (!doc) {
    const errorResult: StepResult = {
      stepId: 'bootstrap',
      index: -1,
      status: 'fail',
      message: 'Không truy cập được DOM trong iframe (có thể khác origin).',
      timestamp: Date.now(),
    }
    results.push(errorResult)
    onStepResult?.(errorResult)
    return {
      scenarioId: scenario.id,
      startedAt,
      finishedAt: Date.now(),
      steps: results,
    }
  }

  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index]

    const runningResult: StepResult = {
      stepId: step.id,
      index,
      status: 'running',
      message: `Đang chạy step ${index + 1} (${step.type})`,
      timestamp: Date.now(),
    }
    results.push(runningResult)
    onStepResult?.(runningResult)

    try {
      if (step.delayMs) {
        await delay(step.delayMs)
      }

      switch (step.type) {
        case 'navigate': {
          if (!step.value) {
            throw new Error('Thiếu URL cho step navigate')
          }
          iframe.src = step.value
          await delay(step.timeoutMs ?? 2000)
          break
        }
        case 'click': {
          if (!step.selector) {
            throw new Error('Thiếu selector cho step click')
          }
          const el = doc.querySelector<HTMLElement>(step.selector)
          if (!el) {
            throw new Error(`Không tìm thấy element với selector: ${step.selector}`)
          }
          el.click()
          break
        }
        case 'type': {
          if (!step.selector) {
            throw new Error('Thiếu selector cho step type')
          }
          const el = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(step.selector)
          if (!el) {
            throw new Error(`Không tìm thấy input với selector: ${step.selector}`)
          }
          const value = step.value ?? ''
          el.focus()
          el.value = value

          const inputEvent = new Event('input', { bubbles: true })
          const changeEvent = new Event('change', { bubbles: true })
          el.dispatchEvent(inputEvent)
          el.dispatchEvent(changeEvent)

          break
        }
        case 'assertText': {
          if (!step.selector) {
            throw new Error('Thiếu selector cho step assertText')
          }
          const el = doc.querySelector<HTMLElement>(step.selector)
          if (!el) {
            throw new Error(`Không tìm thấy element với selector: ${step.selector}`)
          }
          const expected = step.expected ?? ''
          const text = el.textContent ?? ''
          if (!text.includes(expected)) {
            throw new Error(`Text thực tế "${text}" không chứa "${expected}"`)
          }
          break
        }
        case 'assertVisible': {
          if (!step.selector) {
            throw new Error('Thiếu selector cho step assertVisible')
          }
          const el = doc.querySelector<HTMLElement>(step.selector)
          if (!el) {
            throw new Error(`Không tìm thấy element với selector: ${step.selector}`)
          }
          const rect = el.getBoundingClientRect()
          const visible = rect.width > 0 && rect.height > 0
          if (!visible) {
            throw new Error('Element không hiển thị (width/height = 0)')
          }
          break
        }
        case 'assertValidationError': {
          if (!step.selector) {
            throw new Error('Thiếu selector cho step assertValidationError')
          }
          const el = doc.querySelector<HTMLElement>(step.selector)
          if (!el) {
            throw new Error(`Không tìm thấy element với selector: ${step.selector}`)
          }
          const expected = step.expected ?? ''
          const text = (el.textContent ?? '').trim()
          if (!text || (expected && !text.includes(expected))) {
            throw new Error(
              expected
                ? `Lỗi validation thực tế "${text}" không chứa "${expected}"`
                : 'Không thấy nội dung lỗi validation',
            )
          }
          break
        }
        default: {
          throw new Error(`Loại step chưa hỗ trợ: ${(step as TestStep).type}`)
        }
      }

      const okResult: StepResult = {
        stepId: step.id,
        index,
        status: 'pass',
        message: `✅ PASS - ${step.type}`,
        timestamp: Date.now(),
      }
      results.push(okResult)
      onStepResult?.(okResult)
    } catch (err) {
      const failResult: StepResult = {
        stepId: step.id,
        index,
        status: 'fail',
        message: `❌ FAIL - ${(err as Error).message}`,
        timestamp: Date.now(),
      }
      results.push(failResult)
      onStepResult?.(failResult)

      if (!continueOnFail) {
        break
      }
    }
  }

  return {
    scenarioId: scenario.id,
    startedAt,
    finishedAt: Date.now(),
    steps: results,
  }
}

interface CypressLikeApi {
  visit: (url: string) => CypressLikeApi
  get: (selector: string) => CypressLikeApi
  contains: (text: string) => CypressLikeApi
  click: () => CypressLikeApi
  type: (value: string) => CypressLikeApi
  should: (assertion: string, expected?: unknown) => CypressLikeApi
}

function createCyForIframe(
  iframe: HTMLIFrameElement,
  pushStep: (step: StepResult) => void,
): { cy: CypressLikeApi; getSteps: () => StepResult[] } {
  const doc = iframe.contentDocument
  const steps: StepResult[] = []
  let index = 0
  let currentElements: HTMLElement[] = []

  const log = (status: StepStatus, message: string) => {
    const step: StepResult = {
      stepId: `cypress-${index}`,
      index,
      status,
      message,
      timestamp: Date.now(),
    }
    index += 1
    steps.push(step)
    pushStep(step)
  }

  if (!doc) {
    log('fail', 'Không truy cập được DOM trong iframe cho chế độ Cypress-like.')
  }

  const cy: CypressLikeApi = {
    visit(url: string) {
      if (!iframe || !url) {
        log('fail', 'cy.visit: thiếu iframe hoặc URL')
        return cy
      }
      iframe.src = url
      log('pass', `cy.visit("${url}")`)
      return cy
    },
    get(selector: string) {
      if (!doc) {
        log('fail', 'cy.get: không có document trong iframe')
        return cy
      }
      const nodes = Array.from(doc.querySelectorAll<HTMLElement>(selector))
      currentElements = nodes
      if (nodes.length === 0) {
        log('fail', `cy.get("${selector}"): không tìm thấy element nào`)
      } else {
        log('pass', `cy.get("${selector}") -> ${nodes.length} phần tử`)
      }
      return cy
    },
    contains(text: string) {
      if (!doc) {
        log('fail', 'cy.contains: không có document trong iframe')
        return cy
      }
      const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_ELEMENT, null)
      const matched: HTMLElement[] = []
      while (walker.nextNode()) {
        const el = walker.currentNode as HTMLElement
        if ((el.textContent || '').includes(text)) {
          matched.push(el)
        }
      }
      currentElements = matched
      if (matched.length === 0) {
        log('fail', `cy.contains("${text}"): không tìm thấy element`)
      } else {
        log('pass', `cy.contains("${text}") -> ${matched.length} phần tử`)
      }
      return cy
    },
    click() {
      if (currentElements.length === 0) {
        log('fail', 'cy.click: không có element nào được chọn (cy.get / cy.contains trước đó)')
        return cy
      }
      currentElements.forEach((el) => el.click())
      log('pass', `cy.click() trên ${currentElements.length} phần tử`)
      return cy
    },
    type(value: string) {
      if (currentElements.length === 0) {
        log('fail', 'cy.type: không có element nào được chọn')
        return cy
      }
      currentElements.forEach((el) => {
        const input = el as HTMLInputElement | HTMLTextAreaElement
        input.focus()
        input.value = value
        const inputEvent = new Event('input', { bubbles: true })
        const changeEvent = new Event('change', { bubbles: true })
        input.dispatchEvent(inputEvent)
        input.dispatchEvent(changeEvent)
      })
      log('pass', `cy.type("${value}")`)
      return cy
    },
    should(assertion: string, expected?: unknown) {
      if (currentElements.length === 0) {
        log('fail', 'cy.should: không có element nào được chọn')
        return cy
      }
      const el = currentElements[0]
      try {
        switch (assertion) {
          case 'be.visible': {
            const rect = el.getBoundingClientRect()
            const visible = rect.width > 0 && rect.height > 0
            if (!visible) throw new Error('Element không hiển thị')
            break
          }
          case 'contain.text': {
            const text = (el.textContent || '').trim()
            if (!expected || typeof expected !== 'string' || !text.includes(expected)) {
              throw new Error(`Text "${text}" không chứa "${String(expected)}"`)
            }
            break
          }
          default:
            throw new Error(`Assertion chưa hỗ trợ: ${assertion}`)
        }
        log('pass', `cy.should("${assertion}", ${JSON.stringify(expected)})`)
      } catch (err) {
        log('fail', `cy.should("${assertion}") lỗi: ${(err as Error).message}`)
      }
      return cy
    },
  }

  return {
    cy,
    getSteps: () => steps,
  }
}

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#020617',
      paper: '#020617',
    },
    text: {
      primary: '#e5e7eb',
      secondary: '#9ca3af',
    },
  },
  components: {
    MuiInputBase: {
      styleOverrides: {
        input: {
          '&::placeholder': {
            color: 'rgba(148, 163, 184, 0.9)',
            opacity: 1,
          },
        },
      },
    },
    MuiFormLabel: {
      styleOverrides: {
        root: {
          color: '#9ca3af',
        },
      },
    },
  },
})

type TabKey = 'description' | 'script' | 'result'

function formatTimestamp(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString('vi-VN', { hour12: false })
}

function App() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  const [selectedModel, setSelectedModel] = useState<ModelKey>('mock')
  const [targetUrl, setTargetUrl] = useState('https://example.org')
  const [loadedUrl, setLoadedUrl] = useState('https://example.org')

  const [description, setDescription] = useState(
    'Kịch bản: người dùng mở màn hình login, nhập email + password và submit thành công.',
  )
  const [note, setNote] = useState(
    'Yêu cầu: kiểm tra có hiển thị tiêu đề trang, form login và không có lỗi validation ban đầu.',
  )

  const [currentScenario, setCurrentScenario] = useState<TestScenario | null>(null)
  const [scriptText, setScriptText] = useState<string>('// Script test sẽ xuất hiện ở đây\n')
  const [isCallingAi, setIsCallingAi] = useState(false)
  const [isRunningTest, setIsRunningTest] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('description')
  const [outputMode, setOutputMode] = useState<OutputMode>('json')

  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [stepLiveLog, setStepLiveLog] = useState<StepResult[]>([])

  const effectiveAiService = useMemo(() => createAiService(selectedModel), [selectedModel])

  const handleLoadUrl = () => {
    setLoadedUrl(targetUrl.trim() || 'about:blank')
  }

  const handleGenerateScript = async () => {
    if (!description.trim()) {
      return
    }
    setIsCallingAi(true)
    setActiveTab('script')
    try {
      if (outputMode === 'json') {
        const scenario = await effectiveAiService.generateTestScript({
          description: `${description}\n\nGhi chú/validate:\n${note}`,
          targetUrl: targetUrl.trim() || loadedUrl,
        })
        setCurrentScenario(scenario)
        setScriptText(JSON.stringify(scenario, null, 2))
      } else {
        const baseUrl = import.meta.env.VITE_CLAUDE_PROXY_URL ?? 'http://localhost:4000'
        const response = await fetch(`${baseUrl}/api/claude/generate-test`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            description: `${description}\n\nGhi chú/validate:\n${note}`,
            targetUrl: targetUrl.trim() || loadedUrl,
            mode: 'cypress',
          }),
        })

        if (!response.ok) {
          const text = await response.text().catch(() => '')
          throw new Error(`Claude proxy lỗi (Cypress mode): ${response.status} ${response.statusText} ${text}`)
        }

        const data = (await response.json()) as {
          content?: Array<{ type: string; text?: string }>
        }

        const textContent =
          data.content?.find((c) => c.type === 'text')?.text ??
          '// Không nhận được nội dung code từ Claude ở chế độ Cypress.'

        const cleaned = textContent.replace(/```[a-z]*/gi, '').replace(/```/g, '').trim()

        setCurrentScenario(null)
        setScriptText(cleaned || '// (Empty Cypress-like code)')
      }
    } catch (err) {
      setScriptText(
        `// Lỗi khi generate script từ AI\n// ${String((err as Error).message ?? err)}`,
      )
    } finally {
      setIsCallingAi(false)
    }
  }

  const handleRunTest = async () => {
    if (!iframeRef.current) {
      return
    }
    setIsRunningTest(true)
    setActiveTab('result')
    setTestResult(null)
    setStepLiveLog([])

    try {
      if (outputMode === 'json') {
        if (!currentScenario) {
          setIsRunningTest(false)
          return
        }
        const result = await runScenarioOnIframe(
          iframeRef.current,
          currentScenario,
          {
            continueOnFail: true,
          },
          (stepResult) => {
            setStepLiveLog((prev) => [...prev, stepResult])
          },
        )
        setTestResult(result)
      } else {
        const iframe = iframeRef.current
        const { cy, getSteps } = createCyForIframe(iframe, (step) => {
          setStepLiveLog((prev) => [...prev, step])
        })

        const startedAt = Date.now()

        try {
          const normalizedCode = scriptText
            .replace(/\bexport\s+default\s+/g, '')
            .replace(/\bexport\s+/g, '')

          const runnerFactory = new Function(
            'cy',
            `"use strict";\n${normalizedCode}\nreturn typeof runCypressLikeTest === "function" ? runCypressLikeTest(cy) : null;`,
          )
          const maybePromise = runnerFactory(cy)
          if (maybePromise && typeof maybePromise.then === 'function') {
            await maybePromise
          }
        } catch (err) {
          const errorStep: StepResult = {
            stepId: 'cypress-runtime-error',
            index: getSteps().length,
            status: 'fail',
            message: `Lỗi khi thực thi code Cypress-like: ${(err as Error).message}`,
            timestamp: Date.now(),
          }
          setStepLiveLog((prev) => [...prev, errorStep])
        }

        const steps = getSteps()
        const finishedAt = Date.now()
        setTestResult({
          scenarioId: 'cypress-code',
          startedAt,
          finishedAt,
          steps,
        })
      }
    } finally {
      setIsRunningTest(false)
    }
  }

  const totalSteps =
    testResult?.steps.length ?? currentScenario?.steps.length ?? 0
  const passedSteps = testResult?.steps.filter((s) => s.status === 'pass').length ?? 0
  const failedSteps = testResult?.steps.filter((s) => s.status === 'fail').length ?? 0

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <div className="app-root">
        <header className="app-header">
        <div className="app-header-left">
          <div className="app-logo">
            <div className="app-logo-dot" />
          </div>
          <div className="app-title-group">
            <span className="app-title">React Auto Test AI</span>
            <span className="app-subtitle">
              Sinh kịch bản test từ ngôn ngữ tự nhiên · FE-only
            </span>
          </div>
        </div>
        <div className="app-header-right">
          <span className="app-badge">MVP · Frontend only</span>
          <span className="app-status">
            <span className="app-status-dot" />
            {isCallingAi
              ? 'Đang gọi AI...'
              : isRunningTest
                ? 'Đang chạy test...'
                : 'Sẵn sàng'}
          </span>
        </div>
      </header>

      {(isCallingAi || isRunningTest) && <LinearProgress color="primary" />}

      <main className="app-main">
        <section className="app-column">
          <div className="app-column-header">
            <div>
              <div className="app-column-title">Ứng dụng cần test</div>
              <div className="app-column-subtitle">
                Nhập URL và load vào iframe (cần cùng origin để chạy test).
              </div>
            </div>
          </div>
          <div className="app-column-body">
            <Container disableGutters>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    size="small"
                    fullWidth
                    label="Target URL"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://localhost:3000 hoặc trang nội bộ"
                    InputLabelProps={{ shrink: true }}
                  />
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleLoadUrl}
                    sx={{ whiteSpace: 'nowrap' }}
                  >
                    Load
                  </Button>
                </Stack>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Typography variant="caption" color="text.secondary">
                    URL hiện tại: {loadedUrl || 'chưa load'}
                  </Typography>
                  <Chip
                    size="small"
                    label="Yêu cầu cùng origin để truy cập DOM"
                    variant="outlined"
                    color="warning"
                  />
                </Stack>
              </Stack>
            </Container>

            <div className="app-iframe-wrapper">
              <iframe
                ref={iframeRef}
                className="app-iframe"
                src={loadedUrl}
                title="Target app iframe"
              />
            </div>
          </div>
        </section>

        <section className="app-column">
          <div className="app-column-header">
            <div>
              <div className="app-column-title">Kịch bản test & AI</div>
              <div className="app-column-subtitle">
                Mô tả kịch bản → sinh script → chạy test trực tiếp trên iframe.
              </div>
            </div>
          </div>

          <div className="app-column-body">
            <Stack spacing={0.75} className="app-right-tabs">
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                className="app-toolbar"
              >
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="model-select-label">Model</InputLabel>
                  <Select
                    labelId="model-select-label"
                    label="Model"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value as ModelKey)}
                  >
                    <MenuItem value="mock">Mock (local)</MenuItem>
                    <MenuItem value="openai">OpenAI (planned)</MenuItem>
                    <MenuItem value="gemini">Gemini (planned)</MenuItem>
                    <MenuItem value="claude">Claude (đã nối LLM)</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="output-mode-label">Output</InputLabel>
                  <Select
                    labelId="output-mode-label"
                    label="Output"
                    value={outputMode}
                    onChange={(e) => setOutputMode(e.target.value as OutputMode)}
                  >
                    <MenuItem value="json">JSON steps</MenuItem>
                    <MenuItem value="cypress">Cypress-like code</MenuItem>
                  </Select>
                </FormControl>

                <Box flex={1} />

                <Button
                  size="small"
                  variant="outlined"
                  color="secondary"
                  disabled={isCallingAi}
                  onClick={handleGenerateScript}
                >
                  Generate test
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  disabled={isRunningTest}
                  onClick={handleRunTest}
                >
                  Run test
                </Button>
              </Stack>

              <Tabs
                value={activeTab}
                onChange={(_, v) => setActiveTab(v)}
                aria-label="Tabs kịch bản"
                textColor="inherit"
                indicatorColor="primary"
                variant="fullWidth"
                sx={{
                  minHeight: 32,
                  '& .MuiTab-root': { minHeight: 32, fontSize: 12 },
                }}
              >
                <Tab value="description" label="Mô tả kịch bản" />
                <Tab value="script" label="Script test (JSON)" />
                <Tab value="result" label="Kết quả chạy" />
              </Tabs>

              <Divider flexItem />

              {activeTab === 'description' && (
                <div className="app-tab-panel">
                  <TextField
                    label="Mô tả kịch bản (tiếng Việt)"
                    multiline
                    minRows={4}
                    maxRows={8}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="VD: người dùng mở trang login, nhập email + password hợp lệ, submit và chuyển sang dashboard."
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="Ghi chú / điều kiện validate"
                    multiline
                    minRows={3}
                    maxRows={6}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="VD: cần kiểm tra không hiển thị lỗi validation khi form còn trống, sau khi submit thì phải thấy thông báo thành công..."
                    InputLabelProps={{ shrink: true }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Lưu ý: giai đoạn này AI chỉ là mock local, nhưng schema JSON sẽ giữ nguyên
                    khi nối API thật.
                  </Typography>
                </div>
              )}

              {activeTab === 'script' && (
                <div className="app-tab-panel">
                  <Box sx={{ flex: 1, borderRadius: 1, overflow: 'hidden', border: '1px solid rgba(30,64,175,0.7)' }}>
                    <Editor
                      height="260px"
                      language={outputMode === 'cypress' ? 'javascript' : 'json'}
                      theme="vs-dark"
                      value={scriptText}
                      onChange={(value) => setScriptText(value ?? '')}
                      options={{
                        fontSize: 12,
                        minimap: { enabled: false },
                        lineNumbers: 'on',
                        readOnly: false,
                        scrollBeyondLastLine: false,
                      }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    Bạn có thể chỉnh tay JSON (tuỳ chọn). Sau này có thể parse ngược lại thành
                    `TestScenario`.
                  </Typography>
                </div>
              )}

              {activeTab === 'result' && (
                <div className="app-tab-panel">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip
                      size="small"
                      label={`Steps: ${totalSteps}`}
                      color="default"
                      variant="outlined"
                    />
                    <Chip
                      size="small"
                      label={`PASS: ${passedSteps}`}
                      color="success"
                      variant="outlined"
                    />
                    <Chip
                      size="small"
                      label={`FAIL: ${failedSteps}`}
                      color={failedSteps > 0 ? 'error' : 'default'}
                      variant="outlined"
                    />
                    {testResult && (
                      <Typography variant="caption" color="text.secondary" sx={{ marginLeft: 'auto' }}>
                        {formatTimestamp(testResult.startedAt)} → {formatTimestamp(testResult.finishedAt)}
                      </Typography>
                    )}
                  </Stack>

                  <div className="app-log-container">
                    {stepLiveLog.length === 0 && (
                      <div className="app-log-line-meta">
                        Chưa có log. Bấm &quot;Run test&quot; sau khi đã generate script.
                      </div>
                    )}
                    {stepLiveLog.map((r) => {
                      const cls =
                        r.status === 'pass'
                          ? 'app-log-line-pass'
                          : r.status === 'fail'
                            ? 'app-log-line-fail'
                            : 'app-log-line-meta'
                      return (
                        <div key={`${r.index}-${r.stepId}-${r.timestamp}`} className={cls}>
                          [{formatTimestamp(r.timestamp)}] [#{r.index + 1}] {r.message}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </Stack>
          </div>
        </section>
        </main>

        <footer className="app-footer">
          <span>MVP demo · chạy hoàn toàn trên browser (FE only).</span>
          <span>
            Lưu ý: cần cấu hình LLM API key trong môi trường local trước khi nối AI thật.
          </span>
        </footer>
      </div>
    </ThemeProvider>
  )
}

export default App
