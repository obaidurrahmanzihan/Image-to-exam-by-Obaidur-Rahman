export interface Question {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

export interface UserAnswer {
  questionIndex: number;
  selectedOption: string | null;
}

export type AppPhase = 'setup' | 'loading' | 'exam' | 'results';
