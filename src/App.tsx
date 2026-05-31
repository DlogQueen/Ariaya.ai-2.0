import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Camera, 
  CameraOff, 
  Send, 
  Sparkles, 
  RefreshCw, 
  Compass, 
  Cpu, 
  ExternalLink, 
  Heart, 
  HelpCircle, 
  Check, 
  Trash2,
  ChevronRight,
  Smile,
  Mic,
  MicOff
} from "lucide-react";
import { Message } from "./types";

// Quick beauty search cards for interactive exploration
const COSMETIC_TIPS = [
  {
    title: "Olive Undertone Grayness",
    text: "Babe, why do cool pink blushes make my olive undertones look grey?",
    icon: "🎨"
  },
  {
    title: "Hide Dark Circles",
    text: "How do I use color correction to hide tired dark under-eye circles?",
    icon: "👁️"
  },
  {
    title: "Espresso Makeup Look",
    text: "Can you search the web for the viral Latte and Espresso makeup trend?",
    icon: "☕"
  },
  {
    title: "Acne Redness Rule",
    text: "Explain the color science behind canceling out angry acne breakouts.",
    icon: "🧪"
  }
];

// Aesthetic camera filters applied via CSS
const FILTERS = [
  { id: "none", name: "Natural", css: "scaleX(-1)" },
  { id: "soft-glam", name: "🎀 Soft Glam", css: "scaleX(-1) saturate(1.1) brightness(1.05) contrast(1.02) sepia(0.05)" },
  { id: "contour", name: "✨ Sculpted Matte", css: "scaleX(-1) contrast(1.08) brightness(1.02) sepia(0.08)" },
  { id: "strawberry", name: "🍓 Strawberry Girl", css: "scaleX(-1) saturate(1.25) hue-rotate(-5deg) contrast(1.05) brightness(1.03)" },
  { id: "espresso", name: "☕ Espresso Grunge", css: "scaleX(-1) sepia(0.3) saturate(1.1) contrast(1.1) brightness(0.95)" }
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "ariya",
      text: "Hey gorgeous! I am literally so excited to get ready with you today! 💋 Prop your phone up, show me your face, and let me know what look we are getting ready for!",
      timestamp: new Date()
    }
  ]);
  const [inputText, setInputText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Camera state
  const [hasCameraAccess, setHasCameraAccess] = useState<boolean | null>(null);
  const [cameraActive, setCameraActive] = useState(true);
  const [activeFilter, setActiveFilter] = useState(FILTERS[0]);
  const [flashActive, setFlashActive] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Voice websocket and audio processing refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const voiceTimerRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);

  const pcmToBase64 = (float32Array: Float32Array) => {
    let pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const buffer = new ArrayBuffer(pcm16.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < pcm16.length; i++) {
      view.setInt16(i * 2, pcm16[i], true); // little-endian
    }
    
    // base64 encoding from ArrayBuffer
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };
  
  const playAudioChunk = (audioCtx: AudioContext, base64Audio: string) => {
    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const view = new DataView(bytes.buffer);
    const pcm16 = new Int16Array(len / 2);
    for (let i = 0; i < pcm16.length; i++) {
      pcm16[i] = view.getInt16(i * 2, true); // little-endian
    }
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
    }
  
    const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000); 
    audioBuffer.getChannelData(0).set(float32);
  
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
  
    const currentTime = audioCtx.currentTime;
    if (nextStartTimeRef.current < currentTime) {
      nextStartTimeRef.current = currentTime;
    }
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;
  };
  
  const toggleVoiceMode = async () => {
    if (isVoiceMode) {
      setIsVoiceMode(false);
      if (wsRef.current) wsRef.current.close();
      if (processorRef.current) processorRef.current.disconnect();
      if (audioCtxRef.current) audioCtxRef.current.close();
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      return;
    }
  
    // start voice
    try {
      setIsVoiceMode(true);
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/live`);
      wsRef.current = ws;
  
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
  
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      voiceTimerRef.current = setInterval(() => {
         if (ws.readyState === WebSocket.OPEN && cameraActive) {
           const image = captureFrame();
           if (image) {
              ws.send(JSON.stringify({ image }));
           }
         }
      }, 3000);
  
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      source.connect(processor);
      processor.connect(audioCtx.destination);
  
      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ audio: base64 }));
        }
      };
  
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.audio && audioCtxRef.current) {
           playAudioChunk(audioCtxRef.current, msg.audio);
        }
        if (msg.interrupted) {
           nextStartTimeRef.current = 0;
        }
      };
  
      ws.onclose = () => {
         setIsVoiceMode(false);
         if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      };
    } catch (err) {
      console.error("Voice Error", err);
      setIsVoiceMode(false);
    }
  };

  // Initialize and request access to front-facing camera
  useEffect(() => {
    if (cameraActive) {
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false
      })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setHasCameraAccess(true);
      })
      .catch(err => {
        console.error("Camera access error:", err);
        setHasCameraAccess(false);
      });
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [cameraActive]);

  // Keep chat scrolled to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAnalyzing]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: `clear-${Date.now()}`,
        sender: "ariya",
        text: "Resetting! Okay babe, let's start fresh. Tell me, what beautiful vibe are we going for now? ✨",
        timestamp: new Date()
      }
    ]);
  };

  // Capture canvas frame
  const captureFrame = (): string | undefined => {
    if (!videoRef.current || !hasCameraAccess) return undefined;
    
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    
    if (ctx) {
      // Draw reversed for correct mirrored view matching the video transform
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Also apply some basic filter qualities to the backup canvas if a filter is on
      if (activeFilter.id === "soft-glam") {
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = "rgba(255, 192, 203, 0.10)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (activeFilter.id === "strawberry") {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = "rgba(244, 63, 94, 0.12)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (activeFilter.id === "espresso") {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = "rgba(139, 69, 19, 0.15)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      
      return canvas.toDataURL("image/jpeg", 0.7);
    }
    return undefined;
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText || inputText).trim();
    if (!textToSend && !hasCameraAccess) return;

    // Trigger physical capture flash feedback on device
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 200);

    // Try capturing current photo snapshot
    const capturedBase64 = captureFrame();

    const userMsgId = `msg-${Date.now()}`;
    const newUserMsg: Message = {
      id: userMsgId,
      sender: "user",
      text: textToSend,
      imageUrl: capturedBase64,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newUserMsg]);
    setInputText("");
    setIsAnalyzing(true);

    try {
      // Map current messages to history format
      const historyPayload = messages.map(m => ({
        sender: m.sender,
        text: m.text,
        imageUrl: m.imageUrl
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          image: capturedBase64,
          history: historyPayload
        })
      });

      if (!res.ok) {
        throw new Error(`Server returned error code: ${res.status}`);
      }

      const result = await res.json();
      
      const ariyaMsg: Message = {
        id: `ariya-${Date.now()}`,
        sender: "ariya",
        text: result.reply,
        timestamp: new Date(),
        engine: result.engine,
        citations: result.citations
      };

      setMessages(prev => [...prev, ariyaMsg]);
    } catch (err: any) {
      console.error(err);
      const errAriya: Message = {
        id: `err-${Date.now()}`,
        sender: "ariya",
        text: "Oh my god babe, my system literally got so dizzy! 😵 Make sure our backend server is fully connected or check your Secrets under the Settings menu, alright? Let's try that again!",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errAriya]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const triggerTipQuery = (text: string) => {
    handleSendMessage(text);
  };

  return (
    <div id="ariya-root" className="min-h-screen bg-plum-950 text-cream font-sans flex flex-col md:flex-row relative overflow-hidden">
      
      {/* LEFT PANEL: Viewfinder of camera feed */}
      <div id="viewfinder" className="w-full md:w-1/2 h-[45vh] md:h-screen relative bg-black flex flex-col border-b md:border-b-0 md:border-r border-plum-800">
        
        {/* Flash Effect Layer */}
        <AnimatePresence>
          {flashActive && (
            <motion.div 
              id="flash-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-white z-50 pointer-events-none"
              transition={{ duration: 0.15 }}
            />
          )}
        </AnimatePresence>

        {/* Live Video Frame */}
        {cameraActive && hasCameraAccess !== false ? (
          <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
            <video
              id="webcam"
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover transition-all duration-300"
              style={{ transform: activeFilter.css }}
            />
          </div>
        ) : (
          <div id="camera-fallback" className="absolute inset-0 bg-gradient-to-b from-plum-850 to-plum-950 flex flex-col justify-center items-center p-6 text-center">
            <div className="w-20 h-20 bg-plum-800 rounded-full border border-rose-gold/30 flex items-center justify-center mb-4">
              <CameraOff className="w-10 h-10 text-rose-gold/70" />
            </div>
            {hasCameraAccess === false ? (
              <div className="max-w-md">
                <h3 className="font-serif text-lg text-rose-gold mb-2">Camera Access Blocked</h3>
                <p className="text-sm text-cream-dark leading-relaxed">
                  Enable your webcam in Google AI Studio browser settings so Ariya can analyze your makeup undertones in real-time!
                </p>
              </div>
            ) : (
              <div className="max-w-md">
                <h3 className="font-serif text-lg text-rose-gold mb-2">Camera is Off</h3>
                <p className="text-sm text-cream-dark leading-relaxed">
                  Enable the camera below when you're ready for Ariya's optical makeup analysis.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Brand Overlay */}
        <header id="header-brand" className="absolute top-0 left-0 right-0 p-5 bg-gradient-to-b from-black/70 to-transparent flex justify-between items-center z-10">
          <div className="flex flex-col">
            <h1 className="font-serif text-2xl tracking-[0.25em] text-rose-gold font-light">
              ARIYA
            </h1>
            <p className="text-[10px] tracking-widest text-rose-gold-light/80 uppercase mt-0.5">
              Beauty Companion
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-mono text-cream-dark/80 tracking-widest uppercase">
              Lens Active
            </span>
          </div>
        </header>

        {/* Camera Control Panel (Bottom of lens view) */}
        <div id="camera-controls" className="absolute bottom-4 left-4 right-4 z-10 flex flex-col gap-3 bg-plum-900 rounded-3xl border-2 border-cream shadow-[4px_4px_0px_#111827] p-4 sm:p-5">
          <div className="flex justify-between items-center gap-2">
            <span className="text-xs font-serif italic text-rose-gold">
              Captured Filters:
            </span>
            <button 
              id="camera-toggle-btn"
              onClick={() => setCameraActive(!cameraActive)}
              className="flex items-center gap-1.5 px-4 py-2 bg-plum-800 hover:bg-plum-750 text-cream border-2 border-cream rounded-full font-bold text-xs shadow-[2px_2px_0px_#111827] active:translate-y-[2px] active:shadow-none transition-all"
            >
              {cameraActive ? (
                <>
                  <CameraOff className="w-3.5 h-3.5" />
                  <span>Disable Cam</span>
                </>
              ) : (
                <>
                  <Camera className="w-3.5 h-3.5" />
                  <span>Enable Cam</span>
                </>
              )}
            </button>
          </div>

          {/* Filters List */}
          <div id="filter-selector" className="flex flex-col gap-2">
            <div className="flex gap-2 overflow-x-auto pb-1 select-none scrollbar-hide">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setActiveFilter(f)}
                  className={`py-2 px-4 text-xs font-bold rounded-full border-2 transition-all whitespace-nowrap ${
                    activeFilter.id === f.id 
                      ? "border-cream bg-rose-gold text-white shadow-[2px_2px_0px_#111827]" 
                      : "border-cream bg-plum-950 hover:bg-plum-800 text-cream-dark shadow-[2px_2px_0px_transparent] hover:shadow-[2px_2px_0px_#111827]"
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
            {activeFilter.id !== "none" && (
              <motion.button
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                onClick={() => triggerTipQuery(`Teach me how to create the ${activeFilter.name.replace(/[🎀✨🍓☕]/g, '').trim()} look using real makeup! Guide me step-by-step babe!`)}
                className="w-full py-3 bg-rose-gold hover:bg-rose-gold-light text-white text-xs font-extrabold rounded-2xl border-2 border-cream shadow-[4px_4px_0px_#111827] hover:shadow-[2px_2px_0px_#111827] hover:translate-y-[2px] active:translate-y-[4px] active:shadow-none flex items-center justify-center gap-2 transition-all"
              >
                💄 TEACH ME THIS LOOK!
              </motion.button>
            )}
          </div>
        </div>

      </div>

      {/* RIGHT PANEL: Chat overlay sidebar */}
      <div id="chat-panel" className="w-full md:w-1/2 h-[55vh] md:h-screen flex flex-col bg-plum-900 overflow-hidden relative">
        
        {/* Chat Feed Header (Utility Bar) */}
        <div id="control-bar" className="p-4 border-b-2 border-cream flex justify-between items-center bg-plum-900 z-20 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-plum-700 border-2 border-cream shadow-[2px_2px_0px_#111827] flex items-center justify-center">
              <Smile className="w-6 h-6 text-cream" />
            </div>
            <div>
              <p className="text-base font-serif italic font-bold text-cream">Ariya</p>
              <p className="text-[10px] font-mono tracking-widest text-rose-gold uppercase font-bold">Prodigy</p>
            </div>
          </div>
          
          <button 
            id="clear-chat-btn"
            onClick={clearChat}
            className="flex items-center gap-2 px-3 py-2 bg-plum-950 border-2 border-cream hover:bg-plum-800 hover:text-rose-gold rounded-xl font-bold text-xs text-cream shadow-[2px_2px_0px_#111827] hover:translate-y-[1px] transition-all"
            title="Reset Chat History"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Start Fresh</span>
          </button>
        </div>

        {/* Scrollable Chat Feed */}
        <div id="chat-feed" className="flex-1 overflow-y-auto p-4 space-y-6">
          {isVoiceMode && (
            <div className="bg-plum-950/60 border border-emerald-500/30 rounded-2xl p-4 flex flex-col items-center justify-center gap-3 animate-pulse">
               <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center">
                  <Mic className="w-6 h-6 text-emerald-400" />
               </div>
               <p className="text-sm font-medium text-emerald-400 font-serif">Voice Mode Active</p>
               <p className="text-xs text-center text-cream-dark/60">Ariya is listening and watching your camera feed live...</p>
            </div>
          )}
          {messages.map((message) => {
            const isUser = message.sender === "user";
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 max-w-[85%] ${isUser ? "ml-auto flex-row-reverse" : "mr-auto"}`}
              >
                {/* Avatar Icon */}
                <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center border-2 border-cream shadow-[2px_2px_0px_#111827] ${
                  isUser 
                    ? "bg-plum-700 text-cream" 
                    : "bg-rose-gold text-white"
                }`}>
                  {isUser ? <HelpCircle className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                </div>

                {/* Message Box */}
                <div className="flex flex-col gap-1.5">
                  <div className={`rounded-2xl p-4 text-sm font-medium leading-relaxed border-2 border-cream ${
                    isUser
                      ? "bg-plum-700 text-cream-light rounded-tr-none shadow-[2px_2px_0px_#111827]"
                      : "bg-plum-900 text-cream-light rounded-tl-none font-medium shadow-[2px_2px_0px_#e60073]"
                  }`}>
                    {/* Render message images */}
                    {message.imageUrl && (
                      <div className="mb-3 max-w-[200px] border-2 border-cream rounded-xl overflow-hidden shadow-[2px_2px_0px_#111827] bg-plum-950">
                        <img 
                          src={message.imageUrl} 
                          alt="Captured visual makeup diagnostic feed" 
                          className="w-full h-auto brightness-105"
                          referrerPolicy="no-referrer"
                        />
                        <div className="px-3 py-1.5 bg-plum-700 border-t-2 border-cream flex items-center justify-between text-[11px] font-mono font-bold text-cream">
                          <span>SNAPSHOT</span>
                          <Check className="w-3 h-3 text-cream" />
                        </div>
                      </div>
                    )}
                    
                    {/* Message body text */}
                    <p className="whitespace-pre-line select-text text-cream">{message.text}</p>
                    
                    {/* Render live search citations */}
                    {message.citations && message.citations.length > 0 && (
                      <div className="mt-3.5 border-t border-rose-gold/10 pt-3 flex flex-col gap-1.5">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-rose-gold flex items-center gap-1">
                          <Compass className="w-3 h-3" /> Shop & Discover Trends:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {message.citations.map((cite, index) => (
                            <a
                              key={index}
                              href={cite.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-plum-900 hover:bg-plum-800 border border-rose-gold/25 text-rose-gold transition"
                            >
                              <span className="max-w-[120px] truncate">{cite.title}</span>
                              <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Engine & Time stamp banner */}
                  <div className={`flex items-center gap-2 text-[10px] text-cream-dark/40 px-1 font-mono uppercase ${isUser ? "justify-end" : "justify-start"}`}>
                    <span>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {message.engine && (
                      <span className="bg-plum-800 border border-rose-gold/10 px-1.5 py-0.5 rounded text-[8px] font-mono text-rose-gold-light/60 flex items-center gap-1">
                        <Cpu className="w-2.5 h-2.5" />
                        {message.engine}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}

          {/* Loader */}
          {isAnalyzing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-3 max-w-[80%] mr-auto"
            >
              <div className="w-8 h-8 shrink-0 rounded-full bg-white border-2 border-cream shadow-[2px_2px_0px_#ff007f] flex items-center justify-center animate-spin">
                <RefreshCw className="w-4 h-4 text-rose-gold" />
              </div>
              <div className="bg-plum-900 border-2 border-cream rounded-2xl rounded-tl-none p-3.5 text-sm shadow-[2px_2px_0px_#e60073]">
                <p className="font-serif font-bold italic text-rose-gold animate-pulse flex items-center gap-1.5">
                  Ariya is matching tones... 💋
                </p>
              </div>
            </motion.div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Quick Tips Academy Drawer */}
        {messages.length < 5 && (
          <div id="academy-drawer" className="px-4 py-4 border-t-2 border-cream bg-plum-950 shadow-[inset_0px_2px_0px_rgba(0,0,0,0.05)]">
            <span className="text-[10px] font-mono font-bold tracking-widest text-rose-gold uppercase block mb-3">
              Ask Ariya Quick Questions:
            </span>
            <div className="grid grid-cols-2 gap-3">
              {COSMETIC_TIPS.map((tip, i) => (
                <button
                  key={i}
                  onClick={() => triggerTipQuery(tip.text)}
                  className="p-3 bg-white hover:bg-plum-700 border-2 border-cream rounded-xl shadow-[2px_2px_0px_#111827] hover:shadow-[4px_4px_0px_#111827] hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-none flex items-start gap-2 text-left transition-all group"
                >
                  <span className="text-xl group-hover:scale-110 transition">{tip.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-cream leading-tight line-clamp-1">{tip.title}</p>
                    <p className="text-[10px] text-cream-dark leading-tight mt-1 line-clamp-1 truncate">{tip.text}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Console */}
        <div id="input-container" className="p-4 border-t-2 border-cream bg-plum-900 z-10 flex flex-col gap-3">
          <div className="flex gap-3 items-center">
            <button
              onClick={toggleVoiceMode}
              className={`h-12 w-12 shrink-0 rounded-2xl flex items-center justify-center transition-all border-2 border-cream shadow-[4px_4px_0px_#111827] active:translate-y-[4px] active:shadow-none ${isVoiceMode ? 'bg-plum-700 text-cream animate-pulse' : 'bg-plum-950 hover:bg-plum-800 text-cream'}`}
              title={isVoiceMode ? "Stop Voice Mode" : "Start Voice Mode"}
            >
              {isVoiceMode ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input
              id="user-text"
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSendMessage()}
              placeholder={isVoiceMode ? "Voice mode active... speak to Ariya!" : (cameraActive ? "Talk to Ariya... (Face snaps on Send!)" : "Talk to Ariya...")}
              disabled={isAnalyzing || isVoiceMode}
              className="flex-1 bg-plum-950 focus:bg-white border-2 border-cream focus:border-rose-gold disabled:opacity-50 text-cream placeholder-cream-dark/60 font-semibold text-sm px-4 py-3 rounded-2xl outline-none shadow-[inset_2px_2px_0px_#e5e7eb] focus:shadow-[4px_4px_0px_#ff007f] transition-all"
              autoComplete="off"
            />
            <button
              id="send-btn"
              onClick={() => handleSendMessage()}
              disabled={isAnalyzing || (!inputText.trim() && !hasCameraAccess) || isVoiceMode}
              className="h-12 w-12 shrink-0 bg-rose-gold hover:bg-rose-gold-light border-2 border-cream text-white font-black rounded-2xl flex items-center justify-center transition-all shadow-[4px_4px_0px_#111827] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#111827] active:translate-y-[4px] active:shadow-none disabled:opacity-50 disabled:pointer-events-none"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="flex justify-between items-center text-[10px] text-cream-dark/40 px-1 font-mono uppercase">
            <span>Lens snaps with each message</span>
            <span className="flex items-center gap-1">
              Made in Google AI Studio
            </span>
          </div>
        </div>

      </div>

    </div>
  );
}
