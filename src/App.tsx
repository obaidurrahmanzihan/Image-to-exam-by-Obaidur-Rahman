/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Loader2, 
  RefreshCcw,
  Key,
  Trophy,
  BookOpen,
  Send,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Question, UserAnswer, AppPhase } from './types';

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('setup');
  const [apiKey, setApiKey] = useState(process.env.GEMINI_API_KEY || '');
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Processing image...');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [duration, setDuration] = useState(10);
  const [processingTime, setProcessingTime] = useState(0);
  const [expectedCount, setExpectedCount] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as new questions arrive
  useEffect(() => {
    if (phase === 'exam' && isStreaming) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [questions.length, phase, isStreaming]);

  // Countdown timer logic
  useEffect(() => {
    let timer: number;
    if (phase === 'exam' && timeLeft !== null && timeLeft > 0) {
      timer = window.setInterval(() => {
        setTimeLeft(prev => (prev !== null ? prev - 1 : null));
      }, 1000);
    } else if (timeLeft === 0 && phase === 'exam') {
      submitExam();
    }
    return () => clearInterval(timer);
  }, [phase, timeLeft]);

  // Processing timer logic
  useEffect(() => {
    let timer: number;
    if (phase === 'loading') {
      timer = window.setInterval(() => {
        setProcessingTime(prev => prev + 1);
      }, 1000);
    } else if (phase === 'setup') {
      setProcessingTime(0);
    }
    return () => clearInterval(timer);
  }, [phase]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setImages(prev => [...prev, ...files]);
      
      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setImagePreviews(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const processExam = async () => {
    if (!apiKey) {
      setError("Please provide a Gemini API Key.");
      return;
    }
    if (images.length === 0) {
      setError("Please upload at least one image of an exam.");
      return;
    }

    setPhase('loading');
    setError(null);
    setQuestions([]);
    setUserAnswers([]);
    setLoadingMessage('Analyzing images with AI...');
    setIsStreaming(true);

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const imageParts = await Promise.all(images.map(async (img) => {
        const base64Data = await fileToBase64(img);
        return {
          inlineData: {
            mimeType: img.type,
            data: base64Data,
          },
        };
      }));

      const prompt = `Read these exam paper images. Extract the questions, multiple-choice options, solve the correct answer (if not marked), and provide a short explanation for each. 
      ${expectedCount ? `I expect to find exactly ${expectedCount} questions in these images. Please ensure you identify and extract all of them.` : ''}
      Return the result as a sequence of JSON objects, one per line. 
      Each object must follow this structure: {"question": "...", "options": ["A", "B", "C", "D"], "correctAnswer": "...", "explanation": "..."}
      Do not include any markdown tags, preamble, or wrap the objects in an array. Just output one valid JSON object per line.`;

      const stream = await ai.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            ...imageParts,
            { text: prompt },
          ],
        },
      });

      setTimeLeft(duration * 60);
      let buffer = '';
      let hasStartedExam = false;
      let questionsFound = 0;
      
      for await (const chunk of stream) {
        buffer += chunk.text;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine) {
            try {
              // Handle potential markdown block markers if AI ignores instructions
              const cleanLine = trimmedLine.replace(/^```json/, '').replace(/```$/, '').trim();
              if (!cleanLine) continue;
              
              const question: Question = JSON.parse(cleanLine);
              setQuestions(prev => [...prev, question]);
              setUserAnswers(prev => [...prev, { questionIndex: prev.length, selectedOption: null }]);
              
              questionsFound++;
              if (!hasStartedExam && questionsFound >= 1) {
                setPhase('exam');
                hasStartedExam = true;
              }
            } catch (e) {
              console.warn("Failed to parse streaming line:", trimmedLine, e);
            }
          }
        }
      }

      // Final buffer check
      if (buffer.trim()) {
        try {
          const cleanLine = buffer.trim().replace(/^```json/, '').replace(/```$/, '').trim();
          if (cleanLine) {
            const question: Question = JSON.parse(cleanLine);
            setQuestions(prev => [...prev, question]);
            setUserAnswers(prev => [...prev, { questionIndex: prev.length, selectedOption: null }]);
            questionsFound++;
          }
        } catch (e) {
          console.warn("Failed to parse final buffer:", buffer, e);
        }
      }

      if (!hasStartedExam) {
        setPhase('exam');
        hasStartedExam = true;
      }

      setIsStreaming(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred while processing the image.");
      setPhase('setup');
      setIsStreaming(false);
    }
  };

  const handleAnswerSelect = (questionIndex: number, option: string) => {
    setUserAnswers(prev => {
      const next = [...prev];
      if (next[questionIndex]) {
        next[questionIndex] = { ...next[questionIndex], selectedOption: option };
      }
      return next;
    });
  };

  const submitExam = () => {
    setPhase('results');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const restart = () => {
    setPhase('setup');
    setImages([]);
    setImagePreviews([]);
    setQuestions([]);
    setUserAnswers([]);
    setError(null);
    setIsStreaming(false);
    setTimeLeft(null);
    setExpectedCount(null);
  };

  const calculateResults = () => {
    let correct = 0;
    let wrong = 0;
    let skipped = 0;

    userAnswers.forEach((ans, idx) => {
      if (!questions[idx]) return;
      if (ans.selectedOption === null) {
        skipped++;
      } else if (ans.selectedOption === questions[idx].correctAnswer) {
        correct++;
      } else {
        wrong++;
      }
    });

    return { correct, wrong, skipped, total: questions.length };
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-indigo-100 pb-24">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <BookOpen size={24} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-800 leading-none">ExamGenie</h1>
              {phase === 'exam' && (
                <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mt-1">
                  {isStreaming ? `Streaming Questions... (${questions.length} found)` : 'Exam in Progress'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {phase === 'exam' && timeLeft !== null && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono font-bold text-sm ${timeLeft < 60 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-slate-100 text-slate-700'}`}>
                <Clock size={16} />
                {formatTime(timeLeft)}
              </div>
            )}
            {phase !== 'setup' && (
              <button 
                onClick={restart}
                className="text-sm font-medium text-slate-500 hover:text-indigo-600 flex items-center gap-1 transition-colors"
              >
                <RefreshCcw size={16} />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {/* Setup Phase */}
          {phase === 'setup' && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
                <h2 className="text-2xl font-bold mb-6">Create Your Exam</h2>
                
                <div className="space-y-6">
                  {/* API Key Section */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <Key size={16} className="text-indigo-500" />
                      Gemini API Key
                    </label>
                    <input 
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Enter your API key..."
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all bg-slate-50"
                    />
                    <p className="text-xs text-slate-500">
                      Your key is stored locally in your browser and used only for requests.
                    </p>
                  </div>

                  {/* Duration Section */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <Clock size={16} className="text-indigo-500" />
                        Duration (Mins)
                      </label>
                      <input 
                        type="number"
                        min="1"
                        max="180"
                        value={duration}
                        onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all bg-slate-50"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <FileText size={16} className="text-indigo-500" />
                        Expected Questions
                      </label>
                      <input 
                        type="number"
                        min="1"
                        value={expectedCount || ''}
                        onChange={(e) => setExpectedCount(parseInt(e.target.value) || null)}
                        placeholder="Optional"
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all bg-slate-50"
                      />
                    </div>
                  </div>

                  {/* Image Upload Section */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <Upload size={16} className="text-indigo-500" />
                      Upload Exam Images
                    </label>
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all border-slate-200 hover:border-indigo-300 hover:bg-slate-50"
                    >
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleImageUpload}
                        accept="image/*"
                        multiple
                        className="hidden"
                      />
                      <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 mb-3">
                        <Upload size={24} />
                      </div>
                      <p className="font-medium text-slate-700">Click to upload or drag and drop</p>
                      <p className="text-sm text-slate-500 mt-1">You can select multiple images</p>
                    </div>

                    {imagePreviews.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
                        {imagePreviews.map((preview, idx) => (
                          <div key={idx} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                            <img src={preview} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover" />
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                removeImage(idx);
                              }}
                              className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                            >
                              <XCircle size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {error && (
                    <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700 text-sm">
                      <AlertCircle size={18} className="shrink-0 mt-0.5" />
                      <p>{error}</p>
                    </div>
                  )}

                  <button 
                    onClick={processExam}
                    disabled={images.length === 0 || !apiKey}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2"
                  >
                    <FileText size={20} />
                    Process & Stream Exam
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Loading Phase (Initial) */}
          {phase === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20 space-y-6"
            >
              <div className="relative">
                <div className="w-24 h-24 border-4 border-indigo-100 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center text-indigo-600">
                  <Loader2 size={32} className="animate-pulse" />
                </div>
              </div>
              <div className="text-center">
                <h3 className="text-xl font-bold text-slate-800">{loadingMessage}</h3>
                <div className="mt-4 flex flex-col items-center gap-3">
                  <div className="flex flex-wrap justify-center gap-2">
                    <div className="px-4 py-2 bg-indigo-50 rounded-full text-indigo-600 font-mono font-bold text-sm flex items-center gap-2 border border-indigo-100">
                      <Clock size={14} className="animate-pulse" />
                      Elapsed: {processingTime}s
                    </div>
                    <div className="px-4 py-2 bg-emerald-50 rounded-full text-emerald-600 font-mono font-bold text-sm flex items-center gap-2 border border-emerald-100">
                      <FileText size={14} />
                      Questions Found: {questions.length}
                    </div>
                  </div>
                  <p className="text-slate-500 mt-2 text-sm max-w-xs mx-auto">
                    Our AI is reading the questions and preparing your test. This usually takes 10-30 seconds depending on the image complexity.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Exam Phase (Scrolling List) */}
          {phase === 'exam' && (
            <motion.div
              key="exam"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <div className="space-y-8">
                {questions.map((q, qIdx) => (
                  <motion.div
                    key={qIdx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200"
                  >
                    <div className="flex items-center justify-between mb-6">
                      <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">
                        Question {qIdx + 1}
                      </span>
                      {userAnswers[qIdx]?.selectedOption && (
                        <span className="flex items-center gap-1 text-emerald-600 text-xs font-bold uppercase">
                          <CheckCircle2 size={14} />
                          Saved
                        </span>
                      )}
                    </div>

                    <h3 className="text-xl font-bold text-slate-800 mb-8 leading-relaxed">
                      {q.question}
                    </h3>

                    <div className="space-y-3">
                      {q.options.map((option, oIdx) => (
                        <button
                          key={oIdx}
                          onClick={() => handleAnswerSelect(qIdx, option)}
                          className={`
                            w-full p-4 rounded-2xl border-2 text-left transition-all flex items-center gap-4 group
                            ${userAnswers[qIdx]?.selectedOption === option 
                              ? 'border-indigo-600 bg-indigo-50' 
                              : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'}
                          `}
                        >
                          <div className={`
                            w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 transition-colors
                            ${userAnswers[qIdx]?.selectedOption === option 
                              ? 'bg-indigo-600 text-white' 
                              : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'}
                          `}>
                            {String.fromCharCode(65 + oIdx)}
                          </div>
                          <span className={`font-medium ${userAnswers[qIdx]?.selectedOption === option ? 'text-indigo-900' : 'text-slate-700'}`}>
                            {option}
                          </span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>

              {isStreaming && (
                <div className="flex items-center justify-center py-8 gap-3 text-indigo-600 font-medium">
                  <Loader2 size={20} className="animate-spin" />
                  AI is discovering more questions... ({questions.length} found)
                </div>
              )}

              {!isStreaming && expectedCount && questions.length < expectedCount && (
                <div className="p-6 bg-amber-50 border border-amber-200 rounded-3xl flex flex-col items-center gap-4 text-center">
                  <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center text-amber-600">
                    <AlertCircle size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-amber-900">Missing Questions?</h4>
                    <p className="text-sm text-amber-700 mt-1">
                      Found {questions.length} questions, but you expected {expectedCount}. 
                      The image might be blurry or some questions were hard to read.
                    </p>
                  </div>
                  <button 
                    onClick={processExam}
                    className="px-6 py-2 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 transition-all flex items-center gap-2"
                  >
                    <RefreshCcw size={18} />
                    Re-analyze Image
                  </button>
                </div>
              )}

              <div ref={scrollEndRef} />

              {/* Sticky Submit Button */}
              <div className="fixed bottom-8 left-0 right-0 z-40 px-4 pointer-events-none">
                <div className="max-w-3xl mx-auto flex justify-end pointer-events-auto">
                  <button
                    onClick={submitExam}
                    disabled={isStreaming || questions.length === 0}
                    className={`
                      px-8 py-4 rounded-2xl font-bold shadow-2xl flex items-center gap-2 transition-all
                      ${isStreaming || questions.length === 0
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:-translate-y-1 active:translate-y-0'}
                    `}
                  >
                    {isStreaming ? 'Waiting for AI...' : 'Submit Exam'}
                    <Send size={20} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Results Phase */}
          {phase === 'results' && (
            <motion.div
              key="results"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8"
            >
              {/* Score Dashboard */}
              <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600" />
                <div className="flex justify-center mb-4">
                  <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
                    <Trophy size={40} />
                  </div>
                </div>
                <h2 className="text-3xl font-black text-slate-800">Exam Completed!</h2>
                <p className="text-slate-500 mt-2">Here's how you performed on the test.</p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8">
                  <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                    <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Correct</p>
                    <p className="text-2xl font-black text-emerald-700">{calculateResults().correct}</p>
                  </div>
                  <div className="p-4 bg-red-50 rounded-2xl border border-red-100">
                    <p className="text-xs font-bold text-red-600 uppercase tracking-wider">Wrong</p>
                    <p className="text-2xl font-black text-red-700">{calculateResults().wrong}</p>
                  </div>
                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                    <p className="text-xs font-bold text-amber-600 uppercase tracking-wider">Skipped</p>
                    <p className="text-2xl font-black text-amber-700">{calculateResults().skipped}</p>
                  </div>
                  <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                    <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Score</p>
                    <p className="text-2xl font-black text-indigo-700">
                      {calculateResults().total > 0 ? Math.round((calculateResults().correct / calculateResults().total) * 100) : 0}%
                    </p>
                  </div>
                </div>

                <button 
                  onClick={restart}
                  className="mt-8 px-8 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-all"
                >
                  Try Another Exam
                </button>
              </div>

              {/* Detailed Review */}
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <FileText size={24} className="text-indigo-600" />
                  Detailed Review
                </h3>

                {questions.map((q, idx) => {
                  const userAns = userAnswers[idx]?.selectedOption;
                  const isCorrect = userAns === q.correctAnswer;
                  const isSkipped = userAns === undefined || userAns === null;

                  return (
                    <div key={idx} className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <h4 className="font-bold text-slate-800 leading-relaxed">
                          <span className="text-slate-400 mr-2">{idx + 1}.</span>
                          {q.question}
                        </h4>
                        {isSkipped ? (
                          <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-full shrink-0">SKIPPED</span>
                        ) : isCorrect ? (
                          <CheckCircle2 size={24} className="text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle size={24} className="text-red-500 shrink-0" />
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {q.options.map((opt, oIdx) => {
                          const isSelected = userAns === opt;
                          const isCorrectOpt = opt === q.correctAnswer;
                          
                          let borderClass = 'border-slate-100';
                          let bgClass = 'bg-slate-50';
                          let textClass = 'text-slate-600';

                          if (isCorrectOpt) {
                            borderClass = 'border-emerald-500';
                            bgClass = 'bg-emerald-50';
                            textClass = 'text-emerald-700 font-bold';
                          } else if (isSelected && !isCorrect) {
                            borderClass = 'border-red-500';
                            bgClass = 'bg-red-50';
                            textClass = 'text-red-700 font-bold';
                          }

                          return (
                            <div key={oIdx} className={`p-3 rounded-xl border-2 text-sm ${borderClass} ${bgClass} ${textClass}`}>
                              {opt}
                            </div>
                          );
                        })}
                      </div>

                      <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/50">
                        <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <AlertCircle size={14} />
                          AI Explanation
                        </p>
                        <div className="text-sm text-slate-700 prose prose-slate max-w-none">
                          <ReactMarkdown>{q.explanation}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-3xl mx-auto px-4 py-12 text-center text-slate-400 text-sm">
        <p>© 2026 ExamGenie AI • Powered by Google Gemini</p>
      </footer>
    </div>
  );
}
