import { useRef, useState } from "react";
import { transcribeAudio } from "./api.ts";

export function VoiceInput(props: {
  disabled: boolean;
  onText: (text: string) => void;
}): JSX.Element {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  async function toggle(): Promise<void> {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      void transcribeAudio(blob)
        .then((text) => {
          const trimmed = text.trim();
          if (trimmed.length > 0) {
            props.onText(trimmed);
          }
        })
        .catch(() => {
          // ASR unavailable or failed; composer stays editable.
        });
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }

  return (
    <button
      type="button"
      className="composer-tool-btn"
      disabled={props.disabled || recording}
      onClick={() => void toggle()}
    >
      {recording ? "停止" : "语音"}
    </button>
  );
}
