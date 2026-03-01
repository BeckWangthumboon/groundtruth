import { useCallback, useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX, ChevronRight, ChevronDown } from 'lucide-react'
import { postChat, postTts } from '../lib/api'
import { buildLocationContextForChat } from '../lib/locationContextForChat'

/**
 * Build a data URL for TTS playback from base64 and format (e.g. "wav").
 */
function buildAudioDataUrl(audioBase64, format) {
  const mime = format === 'wav' ? 'audio/wav' : `audio/${format}`
  return `data:${mime};base64,${audioBase64}`
}

/**
 * Collapsible reasoning block (Elements-style): trigger + content, optional streaming state.
 * Plain CSS + BEM; no Tailwind.
 */
function ReasoningBlock({ reasoningText, defaultOpen = false, id, isStreaming = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen || isStreaming)
  const hasContent = typeof reasoningText === 'string' && reasoningText.trim().length > 0
  const contentId = id != null ? `assistant-reasoning-content-${id}` : 'assistant-reasoning-content'

  const open = isStreaming || isOpen
  const setOpen = (next) => setIsOpen(!!next)

  if (!hasContent && !isStreaming) {
    return null
  }

  const label = isStreaming ? 'Thinking…' : 'Reasoning'

  return (
    <div
      className={`assistant-panel__reasoning${isStreaming ? ' assistant-panel__reasoning--streaming' : ''}${open ? ' assistant-panel__reasoning--open' : ''}`}
    >
      <button
        type="button"
        className="assistant-panel__reasoning-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <span className="assistant-panel__reasoning-icon" aria-hidden>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        {isStreaming ? (
          <span className="assistant-panel__reasoning-dot" aria-hidden />
        ) : null}
        <span className="assistant-panel__reasoning-label">{label}</span>
      </button>
      <div
        id={contentId}
        className="assistant-panel__reasoning-content-wrap"
        role="region"
        aria-label="Reasoning content"
      >
        <div className="assistant-panel__reasoning-content">
          {hasContent ? reasoningText : (isStreaming ? '…' : '')}
        </div>
      </div>
    </div>
  )
}

export function AssistantPanel({ censusData = null, locationLabel = '' }) {
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [supportReasoningUI, setSupportsReasoningUI] = useState(false)
  const [focus, setFocus] = useState('tenant')
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const conversationRef = useRef(null)

  const scrollToBottom = useCallback(() => {
    const el = conversationRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const handleSubmit = useCallback(
    async (e) => {
      e?.preventDefault?.()
      const text = (typeof inputValue === 'string' ? inputValue : '').trim()
      if (!text || isLoading) {
        return
      }

      const userMessage = { role: 'user', content: text }
      setMessages((prev) => [...prev, userMessage])
      setInputValue('')
      setError(null)
      setIsLoading(true)

      const conversationHistory = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }))

      try {
        const locationsWithMetrics = buildLocationContextForChat(censusData, locationLabel)
        const result = await postChat({
          message: text,
          conversationHistory,
          focus,
          useDefaults: true,
          weights: null,
          locationsWithMetrics: locationsWithMetrics.length > 0 ? locationsWithMetrics : null,
        })

        const reply = result?.reply ?? ''
        const supportsReasoning = Boolean(
          result && 'supportsReasoning' in result && result.supportsReasoning
        )
        setSupportsReasoningUI(supportsReasoning)
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: reply,
            reasoning: supportsReasoning ? (result?.reasoning ?? undefined) : undefined,
          },
        ])

        if (voiceEnabled && reply) {
          try {
            const tts = await postTts({ text: reply })
            const dataUrl = buildAudioDataUrl(tts?.audioBase64 ?? '', tts?.format ?? 'wav')
            const audio = new Audio(dataUrl)
            await audio.play()
          } catch (ttsErr) {
            console.warn('TTS playback failed:', ttsErr)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Request failed'
        setError(message)
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${message}` }])
      } finally {
        setIsLoading(false)
      }
    },
    [inputValue, isLoading, messages, focus, voiceEnabled, censusData, locationLabel]
  )

  return (
    <aside className="assistant-panel" aria-label="Location Assistant">
      <header className="assistant-panel__header">
        <h2 className="assistant-panel__location">Location Assistant</h2>
        <p className="assistant-panel__subtitle">Ask about locations, scores, and comparisons</p>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          <select
            aria-label="Focus mode"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: 10,
              border: '1px solid rgba(184, 204, 241, 0.34)',
              background: 'rgba(15, 24, 40, 0.94)',
              color: 'rgba(232, 241, 255, 0.94)',
              fontSize: '0.8rem',
            }}
          >
            <option value="tenant">Tenant</option>
            <option value="small_business">Small business</option>
          </select>
          <button
            type="button"
            className={`assistant-panel__voice-btn${voiceEnabled ? ' is-active' : ''}`}
            onClick={() => setVoiceEnabled((prev) => !prev)}
            aria-label={voiceEnabled ? 'Voice on (speak replies)' : 'Voice off'}
            aria-pressed={voiceEnabled}
            title={voiceEnabled ? 'Voice on: replies will be spoken' : 'Voice off'}
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            {voiceEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            <span style={{ marginLeft: 4 }}>{voiceEnabled ? 'Voice on' : 'Voice off'}</span>
          </button>
        </div>
        <div className="assistant-panel__divider" />
      </header>

      <div
        ref={conversationRef}
        className="assistant-panel__conversation"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        {messages.length === 0 ? (
          <p className="assistant-panel__subtitle" style={{ margin: 0, padding: '8px 0' }}>
            Send a message to get started.
          </p>
        ) : null}
        {messages.map((msg, i) => (
          <div
            key={`${msg.role}-${i}`}
            className={`assistant-panel__message assistant-panel__message--${msg.role}`}
          >
            {msg.role === 'assistant' && supportReasoningUI && (
              <ReasoningBlock
                reasoningText={msg.reasoning}
                defaultOpen={false}
                id={i}
                isStreaming={false}
              />
            )}
            <div>{msg.content}</div>
          </div>
        ))}
        {isLoading ? (
          <div className="assistant-panel__message assistant-panel__message--assistant">
            {supportReasoningUI ? (
              <ReasoningBlock reasoningText="" defaultOpen={true} id="loading" isStreaming={true} />
            ) : (
              <div className="assistant-panel__buffer" aria-live="polite">
                <span className="assistant-panel__buffer-dots">...</span>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <form className="assistant-panel__input-wrap" onSubmit={handleSubmit}>
        <textarea
          className="assistant-panel__input"
          placeholder="Ask about a location..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
          rows={1}
          disabled={isLoading}
          aria-label="Message"
        />
        <button
          type="submit"
          className="assistant-panel__submit"
          disabled={!inputValue.trim() || isLoading}
          aria-label="Send message"
        >
          {isLoading ? 'Sending…' : 'Send'}
        </button>
      </form>

      {error ? (
        <p className="assistant-panel__error" role="alert">
          {error}
        </p>
      ) : null}
    </aside>
  )
}
