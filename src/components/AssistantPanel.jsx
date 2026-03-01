import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Volume2, VolumeX, ChevronRight, ChevronDown } from 'lucide-react'
import { postChat, postTts } from '../lib/api'
import { buildLocationContextForChat } from '../lib/locationContextForChat'
import { DEFAULT_POI_MARKER_COLOR, POI_MARKER_COLOR_BY_TYPE } from '../lib/poiDynamicMap'
import { buildKeypointsContextForChat } from '../lib/keypointsContextForChat'

/**
 * Build a data URL for TTS playback from base64 and format (e.g. "wav").
 */
function buildAudioDataUrl(audioBase64, format) {
  const mime = format === 'wav' ? 'audio/wav' : `audio/${format}`
  return `data:${mime};base64,${audioBase64}`
}

/** Max chars for TTS (Google Cloud limit ~5000; browser has no hard limit but long text is slow). */
const TTS_MAX_CHARS = 4000

/**
 * Prepare text for TTS: strip markdown, truncate.
 */
function prepareTextForTts(text) {
  if (typeof text !== 'string' || !text.trim()) return ''
  let out = text
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1)) // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/\n{2,}/g, '. ') // paragraph breaks
    .replace(/\n/g, ' ')
    .trim()
  return out.length > TTS_MAX_CHARS ? out.slice(0, TTS_MAX_CHARS) + '…' : out
}

/**
 * Speak text using only Google Cloud TTS (no browser fallback).
 * Throws on any error so callers can decide how to handle it.
 */
async function speakReply(text) {
  const clean = prepareTextForTts(text)
  if (!clean) return

  const tts = await postTts({ text: clean })
  if (!tts?.audioBase64) {
    throw new Error('Text-to-speech returned no audio')
  }
  const dataUrl = buildAudioDataUrl(tts.audioBase64, tts?.format ?? 'wav')
  const audio = new Audio(dataUrl)
  await audio.play()
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

/**
 * @param {{
 *   censusData?: unknown
 *   locationLabel?: string
 *   checklistItems?: readonly { id: string, label: string }[]
 *   checklistState?: Record<string, boolean>
 *   onToggleChecklistItem?: ((itemId: string) => void) | null
 *   poiData?: { countsByLabel?: Record<string, number> } | null
 *   poiRadiusM?: number | null
 * }} props
 */
export function AssistantPanel({
  censusData = null,
  locationLabel = '',
  checklistItems = [],
  checklistState = {},
  onToggleChecklistItem = null,
  poiData = null,
  poiRadiusM = null,
}) {
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [supportReasoningUI, setSupportsReasoningUI] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [isChecklistOpen, setIsChecklistOpen] = useState(false)
  const conversationRef = useRef(null)
  const checkedChecklistCount = useMemo(
    () => checklistItems.filter((item) => Boolean(checklistState?.[item.id])).length,
    [checklistItems, checklistState]
  )

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
        const selectedKeypointsData = buildKeypointsContextForChat(
          checklistItems,
          checklistState,
          poiData
        )
        const result = await postChat({
          message: text,
          conversationHistory,
          focus: 'tenant',
          useDefaults: true,
          weights: null,
          locationsWithMetrics: locationsWithMetrics.length > 0 ? locationsWithMetrics : null,
          selectedKeypointsData:
            selectedKeypointsData.length > 0 ? selectedKeypointsData : null,
          keypointsRadiusM: poiRadiusM ?? null,
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
            await speakReply(reply)
          } catch (ttsErr) {
            console.warn('TTS playback failed:', ttsErr)
            setVoiceEnabled(false)
            const ttsMessage =
              ttsErr instanceof Error ? ttsErr.message : 'Text-to-speech failed'
            setError(ttsMessage)
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
    [inputValue, isLoading, messages, voiceEnabled, censusData, locationLabel, checklistItems, checklistState, poiData, poiRadiusM]
  )

  return (
    <aside className="assistant-panel" aria-label="Location Assistant">
      <header className="assistant-panel__header">
        <h2 className="assistant-panel__location">Location Assistant</h2>
        <p className="assistant-panel__subtitle">Ask about locations, scores, and comparisons</p>

        <div className="assistant-panel__controls">
          <button
            type="button"
            className={`assistant-panel__voice-btn${voiceEnabled ? ' is-active' : ''}`}
            onClick={() => setVoiceEnabled((prev) => !prev)}
            aria-label={voiceEnabled ? 'Voice on (speak replies)' : 'Voice off'}
            aria-pressed={voiceEnabled}
            title={voiceEnabled ? 'Voice on: replies will be spoken' : 'Voice off'}
          >
            {voiceEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            <span style={{ marginLeft: 4 }}>{voiceEnabled ? 'Voice on' : 'Voice off'}</span>
          </button>

          <div className={`assistant-panel__checklist${isChecklistOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="assistant-panel__voice-btn assistant-panel__checklist-trigger"
              aria-expanded={isChecklistOpen}
              aria-controls="assistant-checklist-menu"
              onClick={() => setIsChecklistOpen((prev) => !prev)}
            >
              <span>Key Points</span>
              <span className="assistant-panel__checklist-meta">
                {checkedChecklistCount}/{checklistItems.length}
              </span>
              <span
                className={`assistant-panel__checklist-chevron${
                  isChecklistOpen ? ' assistant-panel__checklist-chevron--open' : ''
                }`}
                aria-hidden
              >
                <ChevronDown size={14} />
              </span>
            </button>
          </div>
        </div>

        {isChecklistOpen ? (
          <div id="assistant-checklist-menu" className="assistant-panel__checklist-menu">
            <ul className="persona-checklist" aria-label="POI checklist">
              {checklistItems.map((item) => {
                const isChecked = Boolean(checklistState?.[item.id])
                const markerColor = POI_MARKER_COLOR_BY_TYPE[item.id] ?? DEFAULT_POI_MARKER_COLOR
                const checklistItemStyle = isChecked
                  ? { borderColor: markerColor, background: 'rgba(14, 24, 40, 0.7)' }
                  : undefined
                return (
                  <li
                    key={item.id}
                    className={`persona-checklist__item${isChecked ? ' is-checked' : ''}`}
                    style={checklistItemStyle}
                  >
                    <label className="persona-checklist__label">
                      <input
                        className="persona-checklist__checkbox"
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => onToggleChecklistItem?.(item.id)}
                        style={{ accentColor: markerColor }}
                      />
                      <span className="persona-checklist__text">{item.label}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
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
