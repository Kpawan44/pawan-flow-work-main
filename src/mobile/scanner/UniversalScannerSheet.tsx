import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  X, 
  Camera, 
  Flashlight, 
  Search, 
  Sparkles, 
  AlertCircle, 
  RefreshCw, 
  CheckCircle2,
  Keyboard,
  Layers
} from 'lucide-react';
import { JobCard, MaterialMovement, UserProfile } from '../../types';
import ScanActionBottomSheet, { ScanResultEntity } from './ScanActionBottomSheet';

interface UniversalScannerSheetProps {
  isOpen: boolean;
  onClose: () => void;
  jobCards: JobCard[];
  movements: MaterialMovement[];
  currentUser: UserProfile;
  onSelectJobCard?: (jobCardNo: string) => void;
  onTransferJob?: (jobCard: JobCard) => void;
  onAcceptMovement?: (movement: MaterialMovement) => Promise<void> | void;
  isOnline: boolean;
}

export const UniversalScannerSheet: React.FC<UniversalScannerSheetProps> = ({
  isOpen,
  onClose,
  jobCards = [],
  movements = [],
  currentUser,
  onSelectJobCard,
  onTransferJob,
  onAcceptMovement,
  isOnline
}) => {
  const [activeMode, setActiveMode] = useState<'camera' | 'simulator' | 'manual'>('camera');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraInitialized, setCameraInitialized] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [simFilter, setSimFilter] = useState('');
  
  // Entity currently identified from scan to trigger ScanActionBottomSheet
  const [identifiedEntity, setIdentifiedEntity] = useState<ScanResultEntity | null>(null);
  const [showActionSheet, setShowActionSheet] = useState(false);

  const qrCodeInstanceRef = useRef<Html5Qrcode | null>(null);
  const lastScanTimestampRef = useRef<number>(0);
  const isScanningActiveRef = useRef<boolean>(false);

  // Play crisp physical barcode beep sound using Web Audio API
  const playBeep = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const audioCtx = new AudioContext();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(1200, audioCtx.currentTime); // High pitch crisp industrial beep
      gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);

      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.12);
      oscillator.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
      console.warn("Could not play scan beep", e);
    }
  }, []);

  // Strict camera stop & MediaStream track cleanup
  const stopAndCleanCamera = useCallback(async () => {
    isScanningActiveRef.current = false;
    if (qrCodeInstanceRef.current) {
      try {
        if (qrCodeInstanceRef.current.isScanning) {
          await qrCodeInstanceRef.current.stop();
        }
        await qrCodeInstanceRef.current.clear();
      } catch (err) {
        console.warn("Error while stopping camera scanner:", err);
      }
      qrCodeInstanceRef.current = null;
    }

    // Explicitly release any media stream video tracks attached to the container
    try {
      const container = document.getElementById('mobile-universal-qr-stream');
      if (container) {
        const videos = container.querySelectorAll('video');
        videos.forEach((video) => {
          if (video.srcObject && video.srcObject instanceof MediaStream) {
            video.srcObject.getTracks().forEach((track) => {
              track.stop();
            });
            video.srcObject = null;
          }
        });
        container.innerHTML = '';
      }
    } catch (e) {
      console.warn("Error releasing video stream tracks:", e);
    }

    setCameraInitialized(false);
    setTorchOn(false);
  }, []);

  // Toggle Torch on supported devices
  const toggleTorch = async () => {
    if (!qrCodeInstanceRef.current) return;
    try {
      const newTorchState = !torchOn;
      await qrCodeInstanceRef.current.applyVideoConstraints({
        advanced: [{ torch: newTorchState } as any]
      });
      setTorchOn(newTorchState);
    } catch (err) {
      console.error("Failed to toggle torch", err);
    }
  };

  // Resolve scanned code to Job Card or Movement Entity
  const parseScannedCode = useCallback((code: string): ScanResultEntity => {
    const trimmed = code.trim();
    let matchedJob: JobCard | undefined;
    let matchedMovement: MaterialMovement | undefined;

    // 1. Direct exact Job Card match (case-insensitive)
    matchedJob = jobCards.find(
      (jc) => jc.jobCardNo.toLowerCase() === trimmed.toLowerCase()
    );

    // 2. Direct exact Movement ID match
    if (!matchedJob) {
      matchedMovement = movements.find(
        (m) => m.movementId.toLowerCase() === trimmed.toLowerCase()
      );
      if (matchedMovement) {
        matchedJob = jobCards.find(
          (jc) => jc.jobCardNo.toLowerCase() === matchedMovement!.jobCardNo.toLowerCase()
        );
      }
    }

    // 3. Query param match (e.g. "?jobCardNo=JC-1003" or "?movementId=MOV-1003")
    if (!matchedJob && !matchedMovement) {
      const jcParamMatch = trimmed.match(/jobCardNo=([^&"'\s]+)/i);
      if (jcParamMatch && jcParamMatch[1]) {
        const extractedNo = decodeURIComponent(jcParamMatch[1]).trim();
        matchedJob = jobCards.find(
          (jc) => jc.jobCardNo.toLowerCase() === extractedNo.toLowerCase()
        );
      }
    }

    // 4. Try JSON parsing
    if (!matchedJob && !matchedMovement) {
      try {
        const json = JSON.parse(trimmed);
        if (json && typeof json === 'object') {
          const jsonJc = json.jobCardNo || json.job_card_no || json.jobCard;
          if (typeof jsonJc === 'string') {
            matchedJob = jobCards.find(
              (jc) => jc.jobCardNo.toLowerCase() === jsonJc.trim().toLowerCase()
            );
          }
          const jsonMov = json.movementId || json.movement_id;
          if (typeof jsonMov === 'string') {
            matchedMovement = movements.find(
              (m) => m.movementId.toLowerCase() === jsonMov.trim().toLowerCase()
            );
          }
        }
      } catch (e) {
        // Ignored
      }
    }

    // 5. Substring / normalized search in jobCards
    if (!matchedJob && !matchedMovement) {
      const lowerCode = trimmed.toLowerCase();
      matchedJob = jobCards.find((jc) => lowerCode.includes(jc.jobCardNo.toLowerCase()));
    }

    // Check if there is an unaccepted pending ingress movement targeting current user's department for this Job Card
    let pendingIngressMovement: MaterialMovement | undefined;
    if (matchedJob) {
      pendingIngressMovement = movements.find(
        (m) => 
          m.jobCardNo.toLowerCase() === matchedJob!.jobCardNo.toLowerCase() &&
          !m.accepted &&
          (m.toDepartment.toLowerCase() === currentUser.department.toLowerCase() ||
           currentUser.role === 'super_admin' ||
           currentUser.role === 'admin')
      );
    }

    if (matchedJob) {
      return {
        type: 'job_card',
        rawCode: trimmed,
        jobCard: matchedJob,
        movement: matchedMovement,
        pendingIngressMovement
      };
    } else if (matchedMovement) {
      return {
        type: 'movement',
        rawCode: trimmed,
        movement: matchedMovement,
        pendingIngressMovement: !matchedMovement.accepted ? matchedMovement : undefined
      };
    }

    return {
      type: 'unknown',
      rawCode: trimmed
    };
  }, [jobCards, movements, currentUser]);

  // Handle successful scan with duplicate protection
  const handleSuccessfulScan = useCallback((code: string) => {
    const now = Date.now();
    // 2-second duplicate debounce protection
    if (now - lastScanTimestampRef.current < 2000) {
      return;
    }
    // Freeze if action sheet is already open
    if (showActionSheet) {
      return;
    }

    lastScanTimestampRef.current = now;
    playBeep();

    const entity = parseScannedCode(code);
    setIdentifiedEntity(entity);
    setShowActionSheet(true);
  }, [playBeep, parseScannedCode, showActionSheet]);

  // Initialize Camera Scanner
  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraInitialized(false);

    try {
      await stopAndCleanCamera();

      // Request camera stream to trigger Android/Capacitor runtime permission prompt
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const testStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
          });
          testStream.getTracks().forEach((track) => track.stop());
        } catch (permErr: any) {
          const pName = permErr.name || '';
          const pMsg = permErr.message || String(permErr);
          if (
            pName === 'NotAllowedError' || 
            pName === 'PermissionDeniedError' || 
            pMsg.includes('Permission') || 
            pMsg.includes('denied')
          ) {
            setCameraError("Camera permission is required to scan QR codes. Please allow Camera access in Android Settings.");
            return;
          } else if (
            pName === 'NotFoundError' || 
            pName === 'DevicesNotFoundError' || 
            pMsg.includes('not found')
          ) {
            setCameraError("No physical camera device was found on this system. Please use 'Scanner Sim' or 'Manual Match' tab instead.");
            return;
          } else if (
            pName === 'NotReadableError' || 
            pName === 'TrackStartError' || 
            pMsg.includes('in use')
          ) {
            setCameraError("Camera is currently in use by another application or locked. Please close other camera apps and retry.");
            return;
          }
          throw permErr;
        }
      }

      const element = document.getElementById('mobile-universal-qr-stream');
      if (!element) return;
      element.innerHTML = '';

      const html5QrCode = new Html5Qrcode('mobile-universal-qr-stream');
      qrCodeInstanceRef.current = html5QrCode;
      isScanningActiveRef.current = true;

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: (width, height) => {
            const size = Math.min(width, height) * 0.72;
            return { width: Math.max(180, size), height: Math.max(180, size) };
          }
        },
        (decodedText) => {
          handleSuccessfulScan(decodedText);
        },
        () => {
          // Silent frame callback
        }
      );

      setCameraInitialized(true);
    } catch (err: any) {
      console.error('Failed to initialize webcam qr-scanner', err);
      setCameraError("Camera unavailable or permission denied. Please allow Camera permissions and retry.");
    }
  }, [stopAndCleanCamera, handleSuccessfulScan]);

  // Lifecycle camera activation & cleanup
  useEffect(() => {
    if (isOpen && activeMode === 'camera') {
      const timer = setTimeout(() => {
        startCamera();
      }, 100);
      return () => {
        clearTimeout(timer);
        stopAndCleanCamera();
      };
    } else {
      stopAndCleanCamera();
    }
  }, [isOpen, activeMode, startCamera, stopAndCleanCamera]);

  // Handle manual input submission
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    handleSuccessfulScan(manualInput.trim());
    setManualInput('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white select-none print:hidden">
      {/* Top Bar with Safe Area and Controls */}
      <div className="pt-[max(env(safe-area-inset-top,0px),0.75rem)] px-4 pb-3 flex items-center justify-between border-b border-slate-800 bg-slate-900/90 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-xl bg-blue-500/20 text-[#3B82F6]">
            <Camera className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-extrabold tracking-wide uppercase">Universal Scanner</h3>
            <p className="text-[10px] text-slate-400 font-mono">Station: {currentUser.department}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Torch toggle button */}
          {cameraInitialized && (
            <button
              onClick={toggleTorch}
              className={`p-2.5 rounded-xl border transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center ${
                torchOn 
                  ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold' 
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
              title="Toggle Flashlight"
            >
              <Flashlight className="h-4 w-4" />
            </button>
          )}

          {/* Close Scanner Button */}
          <button
            onClick={() => {
              stopAndCleanCamera();
              onClose();
            }}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="Close Scanner"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-900/50 p-1 gap-1">
        <button
          onClick={() => setActiveMode('camera')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px] ${
            activeMode === 'camera'
              ? 'bg-[#3B82F6] text-white shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Camera className="h-4 w-4" />
          <span>Camera</span>
        </button>

        <button
          onClick={() => setActiveMode('simulator')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px] ${
            activeMode === 'simulator'
              ? 'bg-[#3B82F6] text-white shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Sparkles className="h-4 w-4" />
          <span>Simulate</span>
        </button>

        <button
          onClick={() => setActiveMode('manual')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px] ${
            activeMode === 'manual'
              ? 'bg-[#3B82F6] text-white shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Keyboard className="h-4 w-4" />
          <span>Manual</span>
        </button>
      </div>

      {/* Main Viewport Area */}
      <div className="flex-1 relative flex flex-col items-center justify-center overflow-hidden p-4">
        {/* CAMERA MODE */}
        {activeMode === 'camera' && (
          <div className="w-full h-full flex flex-col items-center justify-center relative">
            {cameraError ? (
              <div className="max-w-sm p-5 bg-rose-950/60 border border-rose-800/80 rounded-3xl text-center space-y-3">
                <AlertCircle className="h-8 w-8 text-rose-400 mx-auto" />
                <h4 className="text-sm font-bold text-rose-200">Camera Access Error</h4>
                <p className="text-xs text-rose-300 leading-relaxed">{cameraError}</p>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={startCamera}
                    className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Retry Camera</span>
                  </button>
                  <button
                    onClick={() => setActiveMode('simulator')}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
                  >
                    Use Simulator
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Hardware Stream Viewport Container */}
                <div 
                  id="mobile-universal-qr-stream" 
                  className="w-full max-w-sm aspect-square rounded-3xl overflow-hidden bg-black border-2 border-slate-700 shadow-2xl relative"
                />

                <p className="text-xs text-slate-400 text-center mt-4 font-medium">
                  Align Job Card or Ingress Barcode within the frame to scan
                </p>
              </>
            )}
          </div>
        )}

        {/* SIMULATOR MODE */}
        {activeMode === 'simulator' && (
          <div className="w-full max-w-md h-full flex flex-col space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={simFilter}
                onChange={(e) => setSimFilter(e.target.value)}
                placeholder="Filter active plant job cards..."
                className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-blue-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {jobCards
                .filter(jc => 
                  jc.jobCardNo.toLowerCase().includes(simFilter.toLowerCase()) ||
                  jc.partyName.toLowerCase().includes(simFilter.toLowerCase()) ||
                  jc.itemName.toLowerCase().includes(simFilter.toLowerCase())
                )
                .slice(0, 50)
                .map(jc => (
                  <button
                    key={jc.jobCardNo}
                    onClick={() => handleSuccessfulScan(jc.jobCardNo)}
                    className="w-full p-3 rounded-2xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-left transition flex items-center justify-between cursor-pointer active:scale-98"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#3B82F6]">{jc.jobCardNo}</span>
                        <span className="text-[10px] text-slate-400">@ {jc.currentDepartment}</span>
                      </div>
                      <h4 className="text-xs font-bold text-white mt-0.5">{jc.partyName}</h4>
                      <p className="text-[11px] text-slate-400">{jc.itemName} ({jc.orderQty} KG)</p>
                    </div>
                    <span className="text-[10px] font-bold uppercase bg-blue-500/10 text-blue-400 px-2 py-1 rounded-lg">
                      Simulate Scan
                    </span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* MANUAL INPUT MODE */}
        {activeMode === 'manual' && (
          <form onSubmit={handleManualSubmit} className="w-full max-w-sm space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                Enter Job Card / Barcode No.
              </label>
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="e.g. JC-1001 or MOV-1002"
                autoFocus
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-2xl text-sm font-mono text-white placeholder-slate-500 focus:outline-hidden focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={!manualInput.trim()}
              className="w-full py-3 rounded-2xl bg-[#3B82F6] hover:bg-blue-600 text-white font-bold text-xs shadow-md transition cursor-pointer disabled:opacity-50 min-h-[46px]"
            >
              Identify & Open Actions
            </button>
          </form>
        )}
      </div>

      {/* Contextual Action Bottom Sheet (Triggered upon scan) */}
      <ScanActionBottomSheet
        isOpen={showActionSheet}
        onClose={() => {
          setShowActionSheet(false);
          setIdentifiedEntity(null);
        }}
        entity={identifiedEntity}
        currentUser={currentUser}
        onAcceptIngress={onAcceptMovement}
        onTransferJob={onTransferJob}
        onViewDetails={(jobCardNo) => {
          if (onSelectJobCard) {
            onSelectJobCard(jobCardNo);
          }
          stopAndCleanCamera();
          onClose();
        }}
        isOnline={isOnline}
      />
    </div>
  );
};

export default UniversalScannerSheet;
