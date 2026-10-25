// A word boundary reported alongside synthesized audio. Offsets and durations
// are in 100-nanosecond ticks relative to the start of the audio stream; `text`
// is the verbatim span of the input text.
export interface TTSWordBoundary {
  offset: number;
  duration: number;
  text: string;
}
