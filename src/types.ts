export type Lane = 0 | 1 | 2 | 3;
export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

export interface Note {
  /** hit time in seconds */
  t: number;
  lane: Lane;
  /** release time for hold notes */
  end?: number;
}

export interface ChartInfo {
  notes: Note[];
  stars: number;
  nps: number;
}

export interface Analysis {
  version: number;
  duration: number;
  bpm: number;
  beats: number[];
  /** index into `beats` of the first downbeat */
  downbeat: number;
  /** ~200 normalized loudness samples for card art */
  waveform: number[];
  charts: Record<Difficulty, ChartInfo>;
}

export type Grade = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';

export interface BestScore {
  score: number;
  accuracy: number;
  grade: Grade;
  maxCombo: number;
  fullCombo: boolean;
  date: number;
}

export interface SongRecord {
  id: string;
  title: string;
  artist: string;
  source: 'file' | 'demo';
  addedAt: number;
  lastPlayed?: number;
  audio: Blob;
  analysis: Analysis;
  best: Partial<Record<Difficulty, BestScore>>;
}

export interface Settings {
  speed: number;
  offsetMs: number;
  keys: [string, string, string, string];
  musicVolume: number;
  showTiming: boolean;
  effects: boolean;
}
