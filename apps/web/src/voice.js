import { useCallback, useEffect, useRef, useState } from 'react';

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
export const fileToDataUrl = toDataUrl;

/**
 * Records a voice note and, where the browser supports it, transcribes it live
 * (Web Speech API, en-IN). The transcript is editable before sending, which also
 * covers browsers without speech recognition and denied microphones.
 * In production the transcript comes from a speech-to-text service instead (see services.transcribe).
 */
export function useVoiceRecorder() {
  const [phase, setPhase] = useState('idle'); // idle | recording | review
  const [seconds, setSeconds] = useState(0);
  const [draft, setDraft] = useState(null); // { dataUrl, mime, durationSec, transcript, note }
  const rec = useRef({});

  const cleanup = () => {
    const r = rec.current;
    clearInterval(r.timer);
    try { r.recognition?.stop(); } catch { /* already stopped */ }
    r.stream?.getTracks().forEach((t) => t.stop());
    rec.current = {};
  };
  useEffect(() => cleanup, []);

  const start = useCallback(async () => {
    const r = rec.current = { startedAt: Date.now(), transcript: '', chunks: [] };
    setSeconds(0); setDraft(null); setPhase('recording');
    r.timer = setInterval(() => setSeconds(Math.round((Date.now() - r.startedAt) / 1000)), 250);

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const recognition = new SR();
      recognition.lang = 'en-IN'; recognition.continuous = true; recognition.interimResults = true;
      let finals = '';
      recognition.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finals += e.results[i][0].transcript + ' '; else interim += e.results[i][0].transcript;
        }
        r.transcript = (finals + interim).trim();
      };
      recognition.onerror = () => {};
      try { recognition.start(); r.recognition = recognition; } catch { /* ignore */ }
    }

    try {
      r.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(r.stream);
      recorder.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
      recorder.start();
      r.recorder = recorder;
    } catch {
      // No microphone or permission denied: let the person type what they would have said.
      cleanup();
      setDraft({ dataUrl: null, mime: null, durationSec: 0, transcript: '', note: 'Microphone unavailable. Type what you would say.' });
      setPhase('review');
    }
  }, []);

  const stop = useCallback(async () => {
    const r = rec.current;
    if (!r.recorder) return;
    const durationSec = Math.max(1, Math.round((Date.now() - r.startedAt) / 1000));
    const done = new Promise((res) => { r.recorder.onstop = res; });
    r.recorder.stop();
    await done;
    const mime = r.recorder.mimeType || 'audio/webm';
    const blob = new Blob(r.chunks, { type: mime });
    const dataUrl = await toDataUrl(blob);
    const transcript = r.transcript || '';
    cleanup();
    setDraft({ dataUrl, mime, durationSec, transcript, note: transcript ? '' : 'No transcript captured. Type what you said so the assistant can understand it.' });
    setPhase('review');
  }, []);

  const discard = useCallback(() => { cleanup(); setDraft(null); setPhase('idle'); }, []);
  const setTranscript = (transcript) => setDraft((d) => d && { ...d, transcript });
  const finish = () => { cleanup(); setDraft(null); setPhase('idle'); };

  return { phase, seconds, draft, start, stop, discard, setTranscript, finish };
}
