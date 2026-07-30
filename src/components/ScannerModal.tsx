import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Sparkles, Search, Clipboard, AlertCircle, RefreshCw, Flashlight } from 'lucide-react';
import { JobCard } from '../types';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobCards: JobCard[];
  onSelectJobCard: (jobCardNo: string) => void;
}

export default function ScannerModal({ isOpen, onClose, jobCards, onSelectJobCard }: ScannerModalProps) {
  const [activeTab, setActiveTab] = useState<'camera' | 'simulator' | 'manual'>('camera');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanSuccessMsg, setScanSuccessMsg] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [simFilter, setSimFilter] = useState('');
  const [cameraInitialized, setCameraInitialized] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const qrCodeInstanceRef = useRef<Html5Qrcode | null>(null);

  // Play crisp physical barcode beep sound using Web Audio API
  const playBeep = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const audioCtx = new AudioContext();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(1200, audioCtx.currentTime); // High pitch crisp beep
      gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);

      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.12);
      oscillator.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
      console.warn("Could not play scan beep", e);
    }
  };

  // Safe stop camera helper
  const stopCamera = async () => {
    if (qrCodeInstanceRef.current && qrCodeInstanceRef.current.isScanning) {
      try {
        await qrCodeInstanceRef.current.stop();
      } catch (err) {
        console.warn("Error while stopping camera scanner", err);
      }
    }
    setCameraInitialized(false);
    setTorchOn(false);
  };

  // Toggle Torch
  const toggleTorch = async () => {
    if (!qrCodeInstanceRef.current) return;
    try {
      const newTorchState = !torchOn;
      // Depending on the version of html5-qrcode, this might differ, 
      // but standard approach is applying constraints.
      // We need the video track to apply constraints.
      // This is a simplified implementation.
      // Since Html5Qrcode doesn't have a direct toggleTorch, 
      // we assume it might work via applyVideoConstraints if the browser supports it.
      // A more robust way would be to get the track from the instance.
      
      // Attempt using applyVideoConstraints
      await qrCodeInstanceRef.current.applyVideoConstraints({
        advanced: [{ torch: newTorchState } as any]
      });
      setTorchOn(newTorchState);
    } catch (err) {
      console.error("Failed to toggle torch", err);
    }
  };

  // Start scanning
  const startCamera = async () => {
    setCameraError(null);
    setScanSuccessMsg(null);
    try {
      // Stop existing scanning if any
      await stopCamera();

      // Ensure the target element exists before initialization
      const element = document.getElementById('qr-camera-stream');
      if (!element) return;

      const html5QrCode = new Html5Qrcode('qr-camera-stream');
      qrCodeInstanceRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: (width, height) => {
            const size = Math.min(width, height) * 0.7;
            return { width: Math.max(160, size), height: Math.max(160, size) };
          }
        },
        (decodedText) => {
          handleSuccessfulScan(decodedText);
        },
        () => {
          // Silent callback for error scan to avoid console spam
        }
      );
      setCameraInitialized(true);
    } catch (err: any) {
      console.error('Failed to initialize webcam qr-scanner', err);
      const errMsg = err.message || String(err);
      if (
        errMsg.includes('NotFoundError') || 
        errMsg.includes('Requested device not found') || 
        errMsg.includes('no video input') ||
        err.name === 'NotFoundError' ||
        err.name === 'DevicesNotFoundError'
      ) {
        setCameraError(
          "No physical webcam/camera device was found on this system. Please use the 'Scanner Sim' or 'Manual Match' tab instead."
        );
      } else if (errMsg.includes('NotAllowedError') || errMsg.includes('Permission denied') || err.name === 'NotAllowedError') {
        setCameraError(
          "Camera permission denied by the browser. Please grant camera permission or check your security frame policies."
        );
      } else {
        setCameraError(
          err.message || 
          "Webcam permissions denied, or another application is using the camera. Please check your browser's frame security policies."
        );
      }
    }
  };

  // Handle successful scan (works for both Camera scanner and Simulator)
  const handleSuccessfulScan = (code: string) => {
    const trimmedCode = code.trim();
    if (!trimmedCode) return;

    let matchedJob: JobCard | undefined;

    // 1. Direct exact match (case-insensitive)
    matchedJob = jobCards.find(
      (jc) => jc.jobCardNo.toLowerCase() === trimmedCode.toLowerCase()
    );

    // 2. Query param match (e.g. "file:///?jobCardNo=JC-1003", "https://.../?jobCardNo=JC-1003", "?jobCardNo=JC-1003", "jobCardNo=JC-1003")
    if (!matchedJob) {
      const paramMatch = trimmedCode.match(/jobCardNo=([^&"'\s]+)/i);
      if (paramMatch && paramMatch[1]) {
        const extractedNo = decodeURIComponent(paramMatch[1]).trim();
        matchedJob = jobCards.find(
          (jc) => jc.jobCardNo.toLowerCase() === extractedNo.toLowerCase()
        );
      }
    }

    // 3. Try URL parsing for general URLs / pathnames / query params
    if (!matchedJob) {
      try {
        let urlToParse = trimmedCode;
        if (urlToParse.startsWith('file:///')) {
          urlToParse = urlToParse.replace('file:///', 'http://dummy.com/');
        } else if (!urlToParse.includes('://') && urlToParse.includes('?')) {
          urlToParse = 'http://dummy.com/' + urlToParse;
        }
        if (urlToParse.includes('://')) {
          const parsedUrl = new URL(urlToParse);
          const jcParam = parsedUrl.searchParams.get('jobCardNo') || 
                          parsedUrl.searchParams.get('jobcardno') || 
                          parsedUrl.searchParams.get('id');
          if (jcParam) {
            matchedJob = jobCards.find(
              (jc) => jc.jobCardNo.toLowerCase() === jcParam.trim().toLowerCase()
            );
          }
          if (!matchedJob) {
            const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
            const lastSegment = pathSegments[pathSegments.length - 1];
            if (lastSegment) {
              const decodedSegment = decodeURIComponent(lastSegment).trim();
              matchedJob = jobCards.find(
                (jc) => jc.jobCardNo.toLowerCase() === decodedSegment.toLowerCase()
              );
            }
          }
        }
      } catch (e) {
        // Ignored
      }
    }

    // 4. Try JSON parsing (e.g. {"jobCardNo": "JC-1003"})
    if (!matchedJob) {
      try {
        const json = JSON.parse(trimmedCode);
        if (json && typeof json === 'object') {
          const jsonNo = json.jobCardNo || json.job_card_no || json.id || json.jobCard;
          if (typeof jsonNo === 'string') {
            matchedJob = jobCards.find(
              (jc) => jc.jobCardNo.toLowerCase() === jsonNo.trim().toLowerCase()
            );
          }
        }
      } catch (e) {
        // Ignored
      }
    }

    // 5. Substring search in jobCards (sorted by length descending so longer IDs match first)
    if (!matchedJob) {
      const sortedJobCards = [...jobCards].sort((a, b) => b.jobCardNo.length - a.jobCardNo.length);
      const lowerCode = trimmedCode.toLowerCase();
      matchedJob = sortedJobCards.find((jc) => {
        const lowerNo = jc.jobCardNo.toLowerCase();
        return lowerCode.includes(lowerNo);
      });
    }

    // 6. Alphanumeric normalized match (ignoring dashes, slashes, spaces)
    if (!matchedJob) {
      const cleanCode = trimmedCode.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (cleanCode.length > 2) {
        matchedJob = jobCards.find((jc) => {
          const cleanNo = jc.jobCardNo.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          return cleanNo === cleanCode || cleanCode.includes(cleanNo);
        });
      }
    }

    playBeep();

    if (matchedJob) {
      setCameraError(null);
      setScanSuccessMsg(`Job Card "${matchedJob.jobCardNo}" found successfully!`);
      setTimeout(() => {
        onSelectJobCard(matchedJob!.jobCardNo);
        onClose();
        // Clear success msg
        setScanSuccessMsg(null);
      }, 1000);
    } else {
      setCameraError(`Decoded Code: "${trimmedCode}" matches no active Job Card in the system ledger.`);
    }
  };

  // Manage Camera startup based on Tab Selection and Modal Open State
  useEffect(() => {
    if (isOpen) {
      const checkCameraPresence = async () => {
        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            setActiveTab('simulator');
            setCameraError("Camera APIs are blocked or not supported in this browser context (e.g., non-secure contexts or inside an iframe).");
            return;
          }
          const devices = await navigator.mediaDevices.enumerateDevices();
          const hasVideoInput = devices.some(device => device.kind === 'videoinput');
          if (!hasVideoInput) {
            setActiveTab('simulator');
            setCameraError("No physical webcam/camera detected on this system. Defaulting to Scanner Simulator.");
          }
        } catch (e) {
          console.warn("Failed to check camera presence:", e);
        }
      };

      checkCameraPresence();

      if (activeTab === 'camera') {
        // Wait a tick for DOM element to mount
        const timer = setTimeout(() => {
          startCamera();
        }, 150);
        return () => clearTimeout(timer);
      } else {
        stopCamera();
      }
    } else {
      stopCamera();
      setScanSuccessMsg(null);
      setCameraError(null);
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  // Filter job cards for simulator quick select
  const filteredSimList = jobCards.filter(jc =>
    jc.jobCardNo.toLowerCase().includes(simFilter.toLowerCase()) ||
    jc.partyName.toLowerCase().includes(simFilter.toLowerCase()) ||
    jc.itemName.toLowerCase().includes(simFilter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden animate-fade-in" id="qr-scanner-overlay">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <span className="text-xl">📷</span>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">
                QR Code Scanner
              </h3>
              <p className="text-[10px] text-slate-400 font-medium">
                Verify Job Cards & material flows instantly
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs Controller */}
        <div className="flex border-b border-slate-100 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-900/50 p-1.5 gap-1">
          <button
            onClick={() => setActiveTab('camera')}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'camera'
                ? 'bg-white dark:bg-slate-800 text-[#4F46E5] dark:text-[#818CF8] shadow-xs border border-slate-200/50 dark:border-slate-700/50'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <Camera className="h-3.5 w-3.5" />
            Live Camera
          </button>
          <button
            onClick={() => setActiveTab('simulator')}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'simulator'
                ? 'bg-white dark:bg-slate-800 text-[#4F46E5] dark:text-[#818CF8] shadow-xs border border-slate-200/50 dark:border-slate-700/50'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Scanner Sim
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'manual'
                ? 'bg-white dark:bg-slate-800 text-[#4F46E5] dark:text-[#818CF8] shadow-xs border border-slate-200/50 dark:border-slate-700/50'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            Manual Match
          </button>
        </div>

        {/* Dynamic Panel Content */}
        <div className="p-5 flex-1 overflow-y-auto min-h-64 flex flex-col justify-between">
          
          {/* TAB 1: REAL LIVE CAMERA STREAM */}
          {activeTab === 'camera' && (
            <div className="space-y-4 flex flex-col flex-1">
              <div className="relative w-full aspect-square bg-slate-950 rounded-2xl overflow-hidden flex flex-col items-center justify-center border-2 border-slate-200 dark:border-slate-850 group">
                
                {/* Simulated Target Sight overlay for scanner */}
                <div className="absolute inset-0 z-10 pointer-events-none border-[35px] border-slate-950/40">
                  <div className="w-full h-full border-2 border-dashed border-[#818CF8]/70 relative flex items-center justify-center">
                    
                    {/* Scanner Corner brackets */}
                    <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-[#4F46E5] dark:border-[#818CF8]" />
                    <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-[#4F46E5] dark:border-[#818CF8]" />
                    <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-[#4F46E5] dark:border-[#818CF8]" />
                    <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-[#4F46E5] dark:border-[#818CF8]" />
                    
                    {/* Pulsing Scanning red laser line */}
                    {cameraInitialized && !scanSuccessMsg && !cameraError && (
                      <div className="absolute left-0 right-0 h-0.5 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-bounce" style={{ animationDuration: '3s' }} />
                    )}
                  </div>
                </div>

                {/* Torch Toggle Button */}
                {cameraInitialized && (
                  <button
                    onClick={toggleTorch}
                    className={`absolute top-4 right-4 z-20 p-2.5 rounded-full backdrop-blur-md transition-all ${
                      torchOn
                        ? 'bg-amber-500 text-white'
                        : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/80'
                    }`}
                  >
                    <Flashlight className="h-5 w-5" />
                  </button>
                )}

                {/* Webcam Target stream div */}
                <div id="qr-camera-stream" className="w-full h-full object-cover" />

                {/* Loading state before camera starts */}
                {!cameraInitialized && !cameraError && (
                  <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center p-6 text-center text-slate-400 gap-3 z-20">
                    <RefreshCw className="h-8 w-8 text-[#818CF8] animate-spin" />
                    <div>
                      <p className="text-xs font-semibold text-white">Opening System Camera...</p>
                      <p className="text-[10px] text-slate-500 mt-1">Please authorize camera access in your web browser</p>
                    </div>
                  </div>
                )}

                {/* Error Banner */}
                {cameraError && (
                  <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-6 text-center text-slate-300 gap-3 z-20">
                    <AlertCircle className="h-10 w-10 text-rose-500" />
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Webcam Access Blocked</h4>
                      <p className="text-[10.5px] text-slate-400 mt-1.5 leading-relaxed">
                        {cameraError}
                      </p>
                      <button 
                        onClick={startCamera}
                        className="mt-4 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-[#818CF8] text-[10px] font-bold tracking-wide transition border border-[#818CF8]/20 cursor-pointer"
                      >
                        Try Re-initializing Camera
                      </button>
                    </div>
                  </div>
                )}

                {/* Success Banner Overlay */}
                {scanSuccessMsg && (
                  <div className="absolute inset-0 bg-emerald-950/95 flex flex-col items-center justify-center p-6 text-center text-emerald-300 gap-3 z-30">
                    <div className="h-12 w-12 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center animate-bounce">
                      <span className="text-xl">✅</span>
                    </div>
                    <div>
                      <h4 className="text-xs font-extrabold text-white uppercase tracking-widest">Job Card Scanned</h4>
                      <p className="text-xs font-mono font-semibold text-emerald-300 mt-1 leading-relaxed">
                        {scanSuccessMsg}
                      </p>
                      <p className="text-[9px] text-slate-400 mt-1">Loading detail ledger views...</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-slate-50 dark:bg-slate-950/40 p-3 border border-slate-100 dark:border-slate-850">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  💡 <strong>Barcode / QR Code Standard:</strong> Align the generated PDF Job Card's QR identifier directly to the square viewport. Make sure lighting is adequate and hold steady.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: INTERACTIVE SIMULATOR */}
          {activeTab === 'simulator' && (
            <div className="space-y-4 flex flex-col flex-1">
              <div className="p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-xl text-center">
                <p className="text-[11px] text-indigo-700 dark:text-indigo-300 leading-relaxed">
                  📱 <strong>IFrame Friendly Demo Simulator:</strong> Click any Job Card below to simulate a real, high-precision physical scan with a simulated beep audio feedback!
                </p>
              </div>

              {/* Live search in simulator */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Quick search job cards..."
                  value={simFilter}
                  onChange={(e) => setSimFilter(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-850 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:border-[#4F46E5] text-slate-800 dark:text-white"
                />
              </div>

              {/* Filtered active job cards list */}
              <div className="border border-slate-100 dark:border-slate-850 rounded-xl max-h-56 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-850">
                {filteredSimList.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic text-center py-6">No matching job cards in ledger</p>
                ) : (
                  filteredSimList.map(jc => (
                    <button
                      key={jc.jobCardNo}
                      onClick={() => handleSuccessfulScan(jc.jobCardNo)}
                      className="w-full p-2.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between group transition cursor-pointer"
                    >
                      <div>
                        <span className="text-xs font-mono font-bold text-[#4F46E5] dark:text-[#818CF8] group-hover:underline">
                          {jc.jobCardNo}
                        </span>
                        <div className="flex gap-2 text-[10px] text-slate-500 mt-0.5">
                          <span className="truncate max-w-[120px]">{jc.partyName}</span>
                          <span className="text-slate-300">|</span>
                          <span className="truncate max-w-[120px]">{jc.itemName}</span>
                        </div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600 dark:bg-slate-850 dark:text-slate-400 group-hover:bg-[#4F46E5] group-hover:text-white transition uppercase">
                        Scan Me
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: MANUAL MATCH SEARCH */}
          {activeTab === 'manual' && (
            <div className="space-y-4 flex flex-col flex-1">
              <div className="space-y-2">
                <label className="block text-[10.5px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  Type / Paste Job Card Reference
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Clipboard className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="e.g. JC2026-001"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 text-xs font-mono font-semibold rounded-xl border border-slate-200 dark:border-slate-850 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:border-[#4F46E5] text-slate-800 dark:text-white"
                    />
                  </div>
                  <button
                    onClick={() => handleSuccessfulScan(manualInput)}
                    disabled={!manualInput.trim()}
                    className="px-4 py-2 bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center"
                  >
                    Match Ledger
                  </button>
                </div>
              </div>

              {/* Suggestions based on manual input */}
              {manualInput.trim() && (
                <div className="border border-slate-100 dark:border-slate-850 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 dark:bg-slate-950/20 px-3 py-1.5 border-b border-slate-100 dark:border-slate-850">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      Live Ledger Matches
                    </span>
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-850">
                    {jobCards
                      .filter(jc => jc.jobCardNo.toLowerCase().includes(manualInput.toLowerCase()))
                      .slice(0, 4)
                      .map(jc => (
                        <button
                          key={jc.jobCardNo}
                          onClick={() => {
                            setManualInput(jc.jobCardNo);
                            handleSuccessfulScan(jc.jobCardNo);
                          }}
                          className="w-full px-3 py-2 text-left text-xs font-mono text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer"
                        >
                          <span>{jc.jobCardNo}</span>
                          <span className="text-[10px] text-slate-400 font-sans">{jc.itemName}</span>
                        </button>
                      ))}
                    {jobCards.filter(jc => jc.jobCardNo.toLowerCase().includes(manualInput.toLowerCase())).length === 0 && (
                      <p className="text-[10.5px] text-slate-400 italic p-3 text-center">No matching job numbers found</p>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-slate-50 dark:bg-slate-950/40 p-3 border border-slate-100 dark:border-slate-850 flex items-start gap-2 text-slate-500 dark:text-slate-400 text-[10px] leading-relaxed">
                <span className="text-xs">⚠️</span>
                <span>If a barcode sticker on a production lot is smudged or the scanner camera cannot focus, you can manually type the alpha-numeric job card number above to quickly locate and track its material balances.</span>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 transition cursor-pointer"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
}
