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
  Printer,
  FileDown,
  Trophy,
  BookOpen,
  Send,
  Clock,
  Share2,
  Copy,
  ExternalLink,
  LogIn,
  LogOut,
  User
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Question, UserAnswer, AppPhase } from './types';
import { db, auth } from './firebase';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  signOut,
  User as FirebaseUser
} from 'firebase/auth';

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('setup');
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
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Check for shared exam on mount
  useEffect(() => {
    const checkSharedExam = () => {
      const params = new URLSearchParams(window.location.search);
      const examId = params.get('examId');
      if (examId && phase === 'setup') {
        loadSharedExam(examId);
      }
    };
    
    if (isAuthReady) {
      checkSharedExam();
    }
    // Also listen for popstate in case of navigation
    window.addEventListener('popstate', checkSharedExam);
    return () => window.removeEventListener('popstate', checkSharedExam);
  }, [phase, isAuthReady]);

  // Test connection to Firestore
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  const loadSharedExam = async (id: string) => {
    setError(null);
    setPhase('loading');
    setLoadingMessage('Loading shared exam...');
    console.log('Fetching shared exam from Firestore:', id);
    
    try {
      const examDoc = await getDoc(doc(db, 'exams', id));
      
      if (!examDoc.exists()) {
        console.warn(`Exam not found: ${id}`);
        throw new Error('Exam not found. The link might be incorrect or the exam was deleted.');
      }
      
      const data = examDoc.data();
      console.log('Exam data loaded:', data);
      
      if (!data.questions || data.questions.length === 0) {
        throw new Error('This exam has no questions.');
      }

      setQuestions(data.questions);
      setUserAnswers(data.questions.map((_: any, idx: number) => ({
        questionIndex: idx,
        selectedOption: null
      })));
      setDuration(data.duration || 30);
      setTimeLeft((data.duration || 30) * 60);
      setPhase('exam');
      setLoadingMessage('Exam loaded!');
    } catch (err: any) {
      console.error('Failed to load shared exam:', err);
      setError(err.message || 'Could not load the shared exam. The link may be invalid.');
      setPhase('setup');
    }
  };

  const handleShare = async () => {
    setIsSharing(true);
    try {
      const examId = crypto.randomUUID();
      await setDoc(doc(db, 'exams', examId), {
        questions,
        duration,
        createdAt: serverTimestamp(),
        authorId: user?.uid || 'anonymous'
      });
      
      const url = `${window.location.origin}${window.location.pathname}?examId=${examId}`;
      setShareUrl(url);
    } catch (err: any) {
      console.error('Error sharing exam:', err);
      setError('Failed to generate sharing link. ' + (err.message || ''));
    } finally {
      setIsSharing(false);
    }
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError('Login failed: ' + err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err: any) {
      setError('Logout failed: ' + err.message);
    }
  };

  const [copied, setCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      setError("Gemini API Key is not configured in the environment.");
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
      const ai = new GoogleGenAI({ apiKey: key });
      
      const imageParts = await Promise.all(images.map(async (img) => {
        const base64Data = await fileToBase64(img);
        return {
          inlineData: {
            mimeType: img.type,
            data: base64Data,
          },
        };
      }));

      const prompt = `You are an expert exam paper analyzer. Your task is to accurately transcribe and solve questions from the provided images.
      
      CRITICAL INSTRUCTIONS FOR IMAGE QUALITY:
      - HANDWRITING: Carefully decipher handwritten text, including cursive or messy scripts. Use context to resolve ambiguous characters.
      - LIGHTING & QUALITY: The images may have poor lighting, shadows, glare, or be from low-quality paper. Apply advanced visual reasoning to filter out noise and focus on the actual content.
      - MULTIPLE IMAGES: These images represent a single exam. Maintain continuity across them.
      
      LANGUAGE & EXPLANATION RULES:
      - If the question is in Bangla: Provide the explanation entirely in Bangla.
      - If the question is in English: Provide the explanation in both English and Bangla (Bilingual).
      
      TASK:
      1. Extract every question and its multiple-choice options.
      2. Identify or solve for the correct answer.
      3. Provide a concise, helpful explanation for the answer following the language rules above.
      
      ${expectedCount ? `EXPECTATION: I expect to find exactly ${expectedCount} questions. If some are hard to read, try your best to reconstruct them using available visual cues.` : ''}
      
      OUTPUT FORMAT:
      Return the result as a sequence of JSON objects, one per line. 
      Each object must follow this structure: {"question": "...", "options": ["A", "B", "C", "D"], "correctAnswer": "...", "explanation": "..."}
      Do not include markdown tags, code blocks, preamble, or wrap the objects in an array. Just output one valid JSON object per line.`;

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
    // Clear the examId from URL without refreshing
    const url = new URL(window.location.href);
    url.searchParams.delete('examId');
    window.history.pushState({}, '', url.toString());
    
    setPhase('setup');
    setImages([]);
    setImagePreviews([]);
    setQuestions([]);
    setUserAnswers([]);
    setError(null);
    setIsStreaming(false);
    setTimeLeft(null);
    setExpectedCount(null);
    setShareUrl(null);
  };

  const handlePrint = () => {
    // Small delay to ensure any hover states or active animations settle
    setTimeout(() => {
      window.print();
    }, 100);
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

  const getBanglaLetter = (index: number) => {
    const letters = ['ক)', 'খ)', 'গ)', 'ঘ)', 'ঙ)', 'চ)', 'ছ)', 'জ)'];
    return letters[index] || `${index + 1})`;
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-indigo-100 pb-24">
      {/* Print-only Header */}
      <div className="hidden print:block mb-8 border-b-2 border-slate-900 pb-4">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Exam Paper</h1>
            <p className="text-slate-600">Generated by ExamGenie AI</p>
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>Date: {new Date().toLocaleDateString()}</p>
            <p>Duration: {duration} Minutes</p>
          </div>
        </div>
      </div>

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
            {user ? (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 overflow-hidden border border-indigo-200">
                  {user.photoURL ? <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" /> : <User size={16} />}
                </div>
                <button onClick={handleLogout} className="text-xs font-bold text-slate-500 hover:text-red-600 transition-colors">Logout</button>
              </div>
            ) : (
              <button onClick={handleLogin} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm">
                <LogIn size={14} className="text-indigo-600" />
                Login
              </button>
            )}
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
        
        {/* Progress Bar in Header */}
        {phase === 'exam' && isStreaming && expectedCount && (
          <div className="absolute bottom-0 left-0 w-full h-0.5 bg-indigo-100 overflow-hidden">
            <motion.div 
              className="h-full bg-indigo-600"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((questions.length / expectedCount) * 100, 100)}%` }}
              transition={{ type: "spring", bounce: 0, duration: 0.5 }}
            />
          </div>
        )}
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
                    disabled={images.length === 0}
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
              <div className="text-center w-full max-w-md">
                <h3 className="text-xl font-bold text-slate-800">{loadingMessage}</h3>
                
                {/* Progress Bar */}
                <div className="mt-6 w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
                  <motion.div 
                    className="h-full bg-indigo-600"
                    initial={{ width: 0 }}
                    animate={{ 
                      width: expectedCount 
                        ? `${Math.min((questions.length / expectedCount) * 100, 100)}%`
                        : `${Math.min(95, (processingTime / 30) * 100)}%` 
                    }}
                    transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                  />
                </div>
                <div className="flex justify-between mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <span>Starting Analysis</span>
                  <span>{expectedCount ? `${questions.length} / ${expectedCount} Questions` : 'Processing...'}</span>
                </div>

                <div className="mt-8 flex flex-col items-center gap-3">
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
              <div className="flex justify-end gap-2 no-print">
                <button 
                  onClick={handleShare}
                  disabled={isSharing}
                  className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold hover:bg-indigo-100 transition-all flex items-center gap-2 text-sm"
                >
                  {isSharing ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
                  Share Test
                </button>
                <button 
                  onClick={handlePrint}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center gap-2 text-sm"
                >
                  <FileDown size={16} />
                  Export as PDF
                </button>
              </div>
              
              <div className="space-y-8 print-two-columns">
                {questions.map((q, qIdx) => (
                  <motion.div
                    key={qIdx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 exam-question-item"
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
                            <span className="print:hidden">{String.fromCharCode(65 + oIdx)}</span>
                            <span className="hidden print:inline text-red-500">{getBanglaLetter(oIdx)}</span>
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
                <div className="space-y-4 py-8 no-print">
                  <div className="flex items-center justify-center gap-3 text-indigo-600 font-medium">
                    <Loader2 size={20} className="animate-spin" />
                    AI is discovering more questions... ({questions.length} found)
                  </div>
                  {expectedCount && (
                    <div className="max-w-xs mx-auto">
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden border border-slate-200">
                        <motion.div 
                          className="h-full bg-indigo-600"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min((questions.length / expectedCount) * 100, 100)}%` }}
                          transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                        />
                      </div>
                      <p className="text-[10px] text-center mt-1 font-bold text-slate-400 uppercase tracking-widest">
                        {Math.round((questions.length / expectedCount) * 100)}% Complete
                      </p>
                    </div>
                  )}
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
                    className="px-6 py-2 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 transition-all flex items-center gap-2 no-print"
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

                <div className="flex flex-wrap justify-center gap-4 mt-8 no-print">
                  <button 
                    onClick={handleShare}
                    disabled={isSharing}
                    className="px-8 py-3 bg-indigo-50 text-indigo-600 rounded-xl font-bold hover:bg-indigo-100 transition-all flex items-center gap-2"
                  >
                    {isSharing ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
                    Share Test Link
                  </button>
                  <button 
                    onClick={restart}
                    className="px-8 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-all flex items-center gap-2"
                  >
                    <RefreshCcw size={18} />
                    Try Another Exam
                  </button>
                  <button 
                    onClick={handlePrint}
                    className="px-8 py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all flex items-center gap-2"
                  >
                    <FileDown size={18} />
                    Export results as PDF
                  </button>
                </div>
              </div>

              {/* Detailed Review */}
              <div className="space-y-6 print-two-columns">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2 no-print">
                  <FileText size={24} className="text-indigo-600" />
                  Detailed Review
                </h3>

                {questions.map((q, idx) => {
                  const userAns = userAnswers[idx]?.selectedOption;
                  const isCorrect = userAns === q.correctAnswer;
                  const isSkipped = userAns === undefined || userAns === null;

                  return (
                    <div key={idx} className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-4 detailed-review-item">
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
                            textClass = 'text-emerald-700 font-bold print:text-red-600';
                          } else if (isSelected && !isCorrect) {
                            borderClass = 'border-red-500';
                            bgClass = 'bg-red-50';
                            textClass = 'text-red-700 font-bold';
                          }

                          return (
                            <div key={oIdx} className={`p-3 rounded-xl border-2 text-sm ${borderClass} ${bgClass} ${textClass}`}>
                              <span className="hidden print:inline mr-1">{getBanglaLetter(oIdx)}</span>
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
        {/* Share Modal */}
        <AnimatePresence>
          {shareUrl && (
            <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/50 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-200"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
                    <Share2 size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">Share Online Test</h3>
                    <p className="text-sm text-slate-500">Anyone with this link can take the test.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 break-all font-mono text-xs text-slate-600">
                    {shareUrl}
                  </div>
                  
                  <div className="flex gap-3">
                    <button
                      onClick={() => copyToClipboard(shareUrl)}
                      className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${copied ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                    >
                      {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                      {copied ? 'Copied!' : 'Copy Link'}
                    </button>
                    <button
                      onClick={() => setShareUrl(null)}
                      className="px-6 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-all"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-3xl mx-auto px-4 py-12 text-center text-slate-400 text-sm">
        <p>© 2026 ExamGenie AI • Powered by Google Gemini</p>
      </footer>
    </div>
  );
}
