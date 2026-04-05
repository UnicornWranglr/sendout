import { useState } from 'react'

interface FormData {
  clientName: string
  hiringCompany: string
  roleTitle: string
  keyRequirements: string
  weeklyActivity: string
  marketObservations: string
}

const emptyForm: FormData = {
  clientName: '',
  hiringCompany: '',
  roleTitle: '',
  keyRequirements: '',
  weeklyActivity: '',
  marketObservations: '',
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-white"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function Label({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <label className="block text-sm font-medium text-slate-700 mb-1.5">
      {children}
      {optional && <span className="ml-1.5 text-slate-400 font-normal text-xs">Optional</span>}
    </label>
  )
}

const inputClass =
  'w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow'

export default function App() {
  const [form, setForm] = useState<FormData>(emptyForm)
  const [output, setOutput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const isValid =
    form.clientName.trim() &&
    form.hiringCompany.trim() &&
    form.roleTitle.trim() &&
    form.keyRequirements.trim() &&
    form.weeklyActivity.trim()

  const generate = async () => {
    if (!isValid || isGenerating) return
    setIsGenerating(true)
    setError('')
    setOutput('')

    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    if (!apiKey) {
      setError('API key not configured. Create a .env file with VITE_ANTHROPIC_API_KEY=your_key.')
      setIsGenerating(false)
      return
    }

    const prompt = `You are a senior recruitment consultant writing a professional update to a client contact.

Here is the context:

Client contact name: ${form.clientName}
Hiring company: ${form.hiringCompany}
Role being recruited: ${form.roleTitle}

Key requirements for the role:
${form.keyRequirements}

This week's recruitment activity (raw notes):
${form.weeklyActivity}
${form.marketObservations ? `\nMarket observations:\n${form.marketObservations}` : ''}

Write a polished, professional client update. Guidelines:
- Open with a brief subject line (prefix with "Subject: ")
- Start with a warm but professional opener addressed to ${form.clientName}
- Summarise the week's activity clearly and concisely — what was done, who was approached, where the pipeline stands
- Flag any standout candidates or notable progress with appropriate enthusiasm but measured language
- If market observations were provided, weave them in naturally as valuable intel
- Close with a confident next-steps statement
- Sign off as the consultant (no name needed — just "Best regards," and leave a blank line)
- Tone: consultative, confident, direct. Not salesy. Not overly formal. Like a trusted advisor giving a meaningful update.
- Length: 150–250 words. Concise is better.

Output only the update — no commentary, no explanation.`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: { message?: string } }).error?.message ?? `Request failed (${res.status})`)
      }

      const data = await res.json() as { content: { text: string }[] }
      setOutput(data.content[0].text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* Header */}
      <header style={{ background: 'linear-gradient(135deg, #0d1f4e 0%, #0f2660 100%)' }} className="py-6 px-6 shadow-md">
        <div className="max-w-2xl mx-auto flex items-end gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </div>
              <span className="text-xl font-bold tracking-tight text-white">SendOut</span>
            </div>
            <p className="mt-1 text-blue-200 text-sm tracking-wide">Client updates, written for you</p>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-8 sm:px-6">

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 sm:px-8">
            <h2 className="text-base font-semibold text-slate-900">New Update</h2>
            <p className="text-sm text-slate-500 mt-0.5">Fill in the details and we'll write it for you.</p>
          </div>

          <div className="px-6 py-6 sm:px-8 space-y-5">

            {/* Client + Company */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Client Name</Label>
                <input
                  type="text"
                  name="clientName"
                  value={form.clientName}
                  onChange={handleChange}
                  placeholder="e.g. Sarah Mitchell"
                  className={inputClass}
                />
              </div>
              <div>
                <Label>Hiring Company</Label>
                <input
                  type="text"
                  name="hiringCompany"
                  value={form.hiringCompany}
                  onChange={handleChange}
                  placeholder="e.g. Acme Corp"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Role */}
            <div>
              <Label>Role Title</Label>
              <input
                type="text"
                name="roleTitle"
                value={form.roleTitle}
                onChange={handleChange}
                placeholder="e.g. Senior Product Manager"
                className={inputClass}
              />
            </div>

            {/* Key requirements */}
            <div>
              <Label>Key Requirements</Label>
              <textarea
                name="keyRequirements"
                value={form.keyRequirements}
                onChange={handleChange}
                rows={3}
                placeholder="What are they looking for? Skills, experience level, culture fit, must-haves..."
                className={`${inputClass} resize-none`}
              />
            </div>

            {/* Weekly activity */}
            <div>
              <Label>This Week's Activity</Label>
              <textarea
                name="weeklyActivity"
                value={form.weeklyActivity}
                onChange={handleChange}
                rows={6}
                placeholder="Brain dump everything — who was approached, response rates, interviews booked, candidate feedback, any blockers, where the pipeline stands..."
                className={`${inputClass} resize-none`}
              />
            </div>

            {/* Market observations */}
            <div>
              <Label optional>Market Observations</Label>
              <textarea
                name="marketObservations"
                value={form.marketObservations}
                onChange={handleChange}
                rows={3}
                placeholder="Anything notable about the candidate market for this role — availability, competing offers, salary trends..."
                className={`${inputClass} resize-none`}
              />
            </div>

            {/* Error */}
            {error && (
              <div className="flex gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <svg className="h-4 w-4 mt-0.5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
                </svg>
                {error}
              </div>
            )}

            {/* Button */}
            <button
              onClick={generate}
              disabled={!isValid || isGenerating}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold text-white transition-all
                bg-blue-600 hover:bg-blue-700 active:scale-[0.99]
                disabled:bg-slate-300 disabled:cursor-not-allowed disabled:active:scale-100
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {isGenerating ? (
                <>
                  <Spinner />
                  Generating...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate Update
                </>
              )}
            </button>
          </div>
        </div>

        {/* Output card */}
        {output && (
          <div className="mt-5 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 sm:px-8 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Your Client Update</h2>
                <p className="text-xs text-slate-400 mt-0.5">Ready to copy and send</p>
              </div>
              <button
                onClick={copyToClipboard}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium border transition-all
                  ${copied
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="px-6 py-6 sm:px-8">
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed font-[Georgia,_serif]">
                {output}
              </p>
            </div>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-slate-400">
        SendOut &mdash; AI-powered recruitment updates
      </footer>

    </div>
  )
}
