import { useRef } from "react";
import { synthesizeSpeech } from "./api.ts";

export function TtsPlay(props: { text: string }): JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function play(): Promise<void> {
    const trimmed = props.text.trim();
    if (trimmed.length === 0) {
      return;
    }
    try {
      const blob = await synthesizeSpeech(trimmed);
      const url = URL.createObjectURL(blob);
      if (audioRef.current !== null) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      // TTS unavailable or failed.
    }
  }

  return (
    <button type="button" className="btn-ghost bubble-tts" onClick={() => void play()}>
      朗读
    </button>
  );
}
