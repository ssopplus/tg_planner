'use client'

/** Озвучка английского слова через Web Speech API; нет движка — тихо ничего не делаем. */
export function speakEnglish(text: string) {
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    utterance.rate = 0.9
    const voice = synth.getVoices().find((v) => v.lang.startsWith('en-US'))
    if (voice) utterance.voice = voice
    synth.speak(utterance)
  } catch {
    // Вебвью без синтеза речи — кнопка просто ничего не произнесёт.
  }
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}
