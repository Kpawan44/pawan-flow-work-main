import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import QRCode from 'qrcode';
import { 
  X, 
  Printer, 
  Paperclip, 
  FileText, 
  Trash2, 
  Upload, 
  Check, 
  ShieldCheck, 
  ArrowRight,
  TrendingUp,
  Clock,
  Copy,
  ExternalLink,
  QrCode,
  Share2,
  MessageSquare
} from 'lucide-react';
import { JobCard, MaterialMovement, UserProfile, CompanyConfig } from '../types';
import { getJobCardProcessMetrics, getWireScrapQty } from '../lib/metrics';
import { DBService } from '../lib/firebase';
import { formatMovementWhatsAppMessage, getWhatsAppShareUrl } from '../lib/whatsapp';
import TimelineVisual from './TimelineVisual';
import { JobStatusBadge } from './JobStatusBadge';

interface JobCardDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobCard: JobCard;
  movements: MaterialMovement[];
  currentUser: UserProfile;
  companyConfig?: CompanyConfig | null;
  onUploadAttachment: (jobCardNo: string, file: { name: string; size: string; url: string; uploadedAt: string }) => void;
  onDeleteAttachment: (jobCardNo: string, index: number) => void;
}

export default function JobCardDetailsModal({
  isOpen,
  onClose,
  jobCard,
  movements,
  currentUser,
  companyConfig,
  onUploadAttachment,
  onDeleteAttachment
}: JobCardDetailsModalProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showWorkshopQR, setShowWorkshopQR] = useState(false);
  const [showPrintView, setShowPrintView] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (showWorkshopQR && qrCanvasRef.current && jobCard.jobCardNo) {
      QRCode.toCanvas(
        qrCanvasRef.current,
        jobCard.jobCardNo,
        {
          width: 256,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        },
        (error) => {
          if (error) console.error('Error generating workshop QR Code:', error);
        }
      );
    }
  }, [showWorkshopQR, jobCard.jobCardNo]);

  const handleDownloadQR = () => {
    if (qrCanvasRef.current) {
      const url = qrCanvasRef.current.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `QR_${jobCard.jobCardNo}.png`;
      link.href = url;
      link.click();
    }
  };

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const trackingUrl = `${window.location.origin}?jobCardNo=${jobCard.jobCardNo}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(trackingUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: `Track Job Card ${jobCard.jobCardNo}`,
        text: `Trace process flow and status ledger for job card number ${jobCard.jobCardNo} on PRO-MFG TRACK.`,
        url: trackingUrl
      }).catch(console.error);
    } else {
      handleCopyLink();
    }
  };

  // Filter movements for this specific job card
  const filteredMovements = movements.filter(m => m.jobCardNo.toLowerCase() === jobCard.jobCardNo.toLowerCase());
  const m = getJobCardProcessMetrics(jobCard, movements);

  // File Upload Handlers (Drag & Drop + Input Click)
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const processUploadedFile = (file: File) => {
    // Generate a simulated object URL for preview
    const sizeInKB = Math.round(file.size / 1024);
    const simulatedUrl = URL.createObjectURL(file);
    
    onUploadAttachment(jobCard.jobCardNo, {
      name: file.name,
      size: `${sizeInKB} KB`,
      url: simulatedUrl,
      uploadedAt: new Date().toISOString()
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processUploadedFile(e.target.files[0]);
    }
  };

  // Status Badge Helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/30';
      case 'In Process':
        return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/30';
      case 'Completed':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/30';
      case 'Rejected':
        return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/30';
      case 'Pending Acceptance':
        return 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900/30';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handlePrint = () => {
    setShowPrintView(true);
  };

  if (showPrintView && isOpen) {
    const getOpName = (dept: string) => {
      const mov = filteredMovements.find(m => m.fromDepartment === dept || m.toDepartment === dept);
      return mov ? (mov.acceptedBy || mov.transferBy) : '';
    };

    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            initial={isMobile ? { y: '100%', opacity: 0 } : { opacity: 0, scale: 0.93, y: 12 }}
            animate={isMobile ? { y: 0, opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={isMobile ? { y: '100%', opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
            transition={isMobile ? { type: 'spring', damping: 26, stiffness: 300 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="bg-white text-slate-900 border border-slate-300 rounded-t-2xl sm:rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden my-0 sm:my-8 flex flex-col max-h-[92vh] sm:max-h-[95vh] print:max-h-none print:my-0 print:border-none print:shadow-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Print Toolbar - Hidden when printing */}
          <div className="p-3 sm:p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between print:hidden gap-2">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <Printer className="h-4 w-4 sm:h-5 sm:w-5 text-slate-500 shrink-0" />
              <span className="font-semibold text-xs sm:text-sm text-slate-700 truncate">Print Preview</span>
            </div>
            <div className="flex gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={() => window.print()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 sm:px-4 rounded text-xs transition flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Printer className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Print Now</span>
                <span className="sm:hidden">Print</span>
              </button>
              <button
                onClick={() => setShowPrintView(false)}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-1.5 px-3 sm:px-4 rounded text-xs transition cursor-pointer"
              >
                Go Back
              </button>
            </div>
          </div>

          {/* Printable Area */}
          <div className="flex-1 p-4 sm:p-8 space-y-4 sm:space-y-6 overflow-y-auto print:p-0 print:overflow-visible bg-white" id="job-card-printable-area">
            {/* Header: Company Name & Doc Title */}
            <div className="border-b-4 border-double border-slate-900 pb-4 text-center">
              <h1 className="text-xl font-extrabold tracking-widest text-slate-900 uppercase">PRO-MFG TRACE</h1>
              <p className="text-[10px] text-slate-500 font-mono tracking-wider uppercase mt-1">OPERATIONS & QUALITY ASSURANCE CONTROL SYSTEM</p>
              <h2 className="text-2xl font-black tracking-tight text-slate-900 uppercase mt-2 bg-slate-100 py-1.5 print:bg-transparent">
                MANUFACTURING JOB TRAVELER CARD
              </h2>
            </div>

            {/* Core Specs: 3-column metadata & QR card */}
            <div className="grid grid-cols-1 md:grid-cols-3 print:grid-cols-3 gap-4 sm:gap-6 items-start">
              <div className="col-span-1 md:col-span-2 print:col-span-2 grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-x-4 gap-y-2 text-xs border border-slate-300 p-4 rounded-xl bg-slate-50/50 print:bg-transparent font-mono">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 font-sans">Job Card Number</span>
                  <p className="text-sm font-extrabold text-slate-900">{jobCard.jobCardNo}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 font-sans">Created Date</span>
                  <p className="text-xs font-semibold text-slate-800">
                    {new Date(jobCard.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 font-sans">Customer / Party Name</span>
                  <p className="text-sm font-bold text-slate-800">{jobCard.partyName}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 font-sans">Job Order Number</span>
                  <p className="text-xs font-bold text-slate-800">{jobCard.orderNo || 'N/A'}</p>
                </div>
                <div className="col-span-1 sm:col-span-2 print:col-span-2 border-t border-slate-200 my-1 pt-1" />
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 font-sans">Item Specification</span>
                  <p className="text-sm font-bold text-slate-800">{jobCard.itemName}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 font-sans">Item Code / Part No</span>
                  <p className="text-xs font-bold text-slate-800">{jobCard.itemCode}</p>
                </div>
              </div>

              {/* QR Code */}
              <div className="col-span-1 flex flex-col items-center justify-center p-3 border border-slate-300 rounded-xl bg-slate-50/50 print:bg-transparent text-center">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(trackingUrl)}`} 
                  alt="QR Code"
                  className="w-24 h-24 mb-1"
                  referrerPolicy="no-referrer"
                />
                <span className="font-mono text-[9px] text-slate-600 font-bold uppercase">SCAN FOR LIVE LEDGER</span>
                <span className="font-mono text-[8px] text-slate-400">{jobCard.jobCardNo}</span>
              </div>
            </div>

            {/* Weights Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3 sm:gap-4 text-center border-y border-slate-300 py-3 font-mono">
              <div>
                <span className="text-[9px] uppercase font-bold text-slate-500 font-sans">Order Quantity</span>
                <p className="text-base font-black text-slate-900">{jobCard.orderQty} KG</p>
              </div>
              <div>
                <span className="text-[9px] uppercase font-bold text-slate-500 font-sans">Processed Weight</span>
                <p className="text-base font-black text-slate-900">{(jobCard.completed ? jobCard.currentQty : (jobCard.storeDetails?.verifiedQty || 0))} KG</p>
              </div>
              <div>
                <span className="text-[9px] uppercase font-bold text-slate-500 font-sans">Current Transit Weight</span>
                <p className="text-base font-black text-amber-700">{jobCard.currentQty} KG</p>
              </div>
              <div>
                <span className="text-[9px] uppercase font-bold text-slate-500 font-sans">Heat Treatment</span>
                <p className="text-sm font-black text-slate-800 mt-0.5">{jobCard.heatTreatmentRequired ? 'YES (Harden)' : 'NO'}</p>
              </div>
            </div>

            {/* Department process metrics or logs */}
            <div className="space-y-4">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-900 border-b border-slate-400 pb-1">
                DEPARTMENT PROCESS SPECIFICATIONS & VERIFICATION SIGN-OFFS
              </h3>
              
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <div className="border border-slate-300 rounded-xl overflow-hidden text-xs min-w-[650px] sm:min-w-full">
                <div className="grid grid-cols-12 bg-slate-100 font-bold border-b border-slate-300 p-2 text-[10px] uppercase">
                  <div className="col-span-2">Department / Stage</div>
                  <div className="col-span-5">Logged Metrics & Specifications</div>
                  <div className="col-span-2">Logged Weight</div>
                  <div className="col-span-3">Operator/Verifier Signature</div>
                </div>

                {/* Stage 1: Purchase */}
                <div className="grid grid-cols-12 border-b border-slate-300 p-2.5 items-center">
                  <div className="col-span-2 font-bold uppercase text-[10.5px]">1. Purchase</div>
                  <div className="col-span-5 text-slate-600 font-mono text-[10px]">
                    {jobCard.purchaseDetails ? (
                      <div>
                        <p>• Supplier: <strong className="text-slate-800">{jobCard.purchaseDetails.supplierName}</strong></p>
                        <p>• Inward Qty: {jobCard.purchaseDetails.receivedQty} KG {jobCard.purchaseDetails.billNo ? `| Bill: ${jobCard.purchaseDetails.billNo}` : ''}</p>
                        {jobCard.purchaseDetails.remarks && <p>• Remarks: {jobCard.purchaseDetails.remarks}</p>}
                      </div>
                    ) : (
                      <p className="italic text-slate-400">No purchase inward details recorded</p>
                    )}
                  </div>
                  <div className="col-span-2 font-mono font-bold text-slate-800">
                    {jobCard.purchaseDetails?.receivedQty ? `${jobCard.purchaseDetails.receivedQty} KG` : '—'}
                  </div>
                  <div className="col-span-3 flex flex-col justify-end">
                    <span className="text-[9px] text-slate-500 font-mono">Inwarded by: {getOpName('Purchase') || jobCard.createdBy || '—'}</span>
                    <div className="border-b border-dashed border-slate-300 w-full mt-2" />
                  </div>
                </div>

                {/* Stage 2: Production */}
                <div className="grid grid-cols-12 border-b border-slate-300 p-2.5 items-center">
                  <div className="col-span-2 font-bold uppercase text-[10.5px]">2. Production</div>
                  <div className="col-span-5 text-slate-600 font-mono text-[10px]">
                    {jobCard.operatorName ? (
                      <div>
                        <p>• Operator: <strong className="text-slate-800">{jobCard.operatorName}</strong></p>
                        {getWireScrapQty(jobCard, movements) > 0 && (
                          <p className="text-amber-800 font-bold">• Wire Scrap: {getWireScrapQty(jobCard, movements)} KG {jobCard.productionDetails?.wireScrapReason ? `(${jobCard.productionDetails.wireScrapReason})` : ''}</p>
                        )}
                        <p>• Status: Completed Milling Operations</p>
                      </div>
                    ) : (
                      <p className="italic text-slate-400">Pending active production log</p>
                    )}
                  </div>
                  <div className="col-span-2 font-mono font-bold text-slate-800">
                    {m.qtyReceivedFromProd ? `${m.qtyReceivedFromProd} KG` : '—'}
                  </div>
                  <div className="col-span-3 flex flex-col justify-end">
                    <span className="text-[9px] text-slate-500 font-mono">Logged by: {jobCard.operatorName || '—'}</span>
                    <div className="border-b border-dashed border-slate-300 w-full mt-2" />
                  </div>
                </div>

                {/* Stage 3: Heat Treatment */}
                {jobCard.heatTreatmentRequired && (
                  <div className="grid grid-cols-12 border-b border-slate-300 p-2.5 items-center">
                    <div className="col-span-2 font-bold uppercase text-[10.5px]">3. Heat Treat</div>
                    <div className="col-span-5 text-slate-600 font-mono text-[10px]">
                      {jobCard.heatTreatmentDetails ? (
                        <div>
                          <p>• Temp: {jobCard.heatTreatmentDetails.temperature || '850°C'} | Cycle: {jobCard.heatTreatmentDetails.cycleTime || '4h'}</p>
                          <p>• Hardness Req: {jobCard.heatTreatmentDetails.hardnessRequired || 'HRC 32-38'}</p>
                        </div>
                      ) : (
                        <p className="italic text-slate-400">Awaiting Heat Treatment processing</p>
                      )}
                    </div>
                    <div className="col-span-2 font-mono font-bold text-slate-800">
                      {jobCard.heatTreatmentDetails?.qtyReceivedFromProd ? `${jobCard.heatTreatmentDetails.qtyReceivedFromProd} KG` : '—'}
                    </div>
                    <div className="col-span-3 flex flex-col justify-end">
                      <span className="text-[9px] text-slate-500 font-mono">Operator: {getOpName('Heat Treatment') || '—'}</span>
                      <div className="border-b border-dashed border-slate-300 w-full mt-2" />
                    </div>
                  </div>
                )}

                {/* Stage 4: Plating */}
                <div className="grid grid-cols-12 border-b border-slate-300 p-2.5 items-center">
                  <div className="col-span-2 font-bold uppercase text-[10.5px]">4. Plating</div>
                  <div className="col-span-5 text-slate-600 font-mono text-[10px]">
                    {jobCard.platingDetails ? (
                      <div>
                        <p>• Plating Type: <strong className="text-slate-800">{jobCard.platingDetails.platingType || 'Zinc'}</strong></p>
                        <p>• Thickness: {jobCard.platingDetails.micronThickness || '8-10'}μm | Duration: {jobCard.platingDetails.durationMinutes || '45'}m</p>
                      </div>
                    ) : (
                      <p className="italic text-slate-400">Awaiting electroplating line</p>
                    )}
                  </div>
                  <div className="col-span-2 font-mono font-bold text-slate-800">
                    {jobCard.platingDetails?.qtyReceivedFromHt !== undefined ? `${jobCard.platingDetails.qtyReceivedFromHt} KG` : '—'}
                  </div>
                  <div className="col-span-3 flex flex-col justify-end">
                    <span className="text-[9px] text-slate-500 font-mono">Plater: {getOpName('Plating') || '—'}</span>
                    <div className="border-b border-dashed border-slate-300 w-full mt-2" />
                  </div>
                </div>

                {/* Stage 5: Packing */}
                <div className="grid grid-cols-12 border-b border-slate-300 p-2.5 items-center">
                  <div className="col-span-2 font-bold uppercase text-[10.5px]">5. Packing</div>
                  <div className="col-span-5 text-slate-600 font-mono text-[10px]">
                    {jobCard.packingDetails ? (
                      <div>
                        <p>• Packed: {jobCard.packingDetails.packedQty || jobCard.currentQty} KG | Boxes: {jobCard.packingDetails.boxCount || 'N/A'}</p>
                        <p>• Pieces: {jobCard.packingDetails.totalPcs?.toLocaleString() || 'N/A'} pcs ({jobCard.packingDetails.pcsPerBagOrBox || 'N/A'} pcs/box)</p>
                      </div>
                    ) : (
                      <p className="italic text-slate-400">Awaiting box packaging</p>
                    )}
                  </div>
                  <div className="col-span-2 font-mono font-bold text-slate-800">
                    {jobCard.packingDetails?.packedQty ? `${jobCard.packingDetails.packedQty} KG` : '—'}
                  </div>
                  <div className="col-span-3 flex flex-col justify-end">
                    <span className="text-[9px] text-slate-500 font-mono">Packed by: {getOpName('Packing') || '—'}</span>
                    <div className="border-b border-dashed border-slate-300 w-full mt-2" />
                  </div>
                </div>

                {/* Stage 6: Store */}
                <div className="grid grid-cols-12 p-2.5 items-center">
                  <div className="col-span-2 font-bold uppercase text-[10.5px]">6. Store</div>
                  <div className="col-span-5 text-slate-600 font-mono text-[10px]">
                    {jobCard.storeDetails ? (
                      <div>
                        <p>• Bin Loc: <strong className="text-slate-800">{jobCard.storeDetails.locationBin || 'N/A'}</strong></p>
                        <p>• Verified Qty: {jobCard.storeDetails.verifiedQty} KG</p>
                      </div>
                    ) : (
                      <p className="italic text-slate-400">Awaiting warehouse placement</p>
                    )}
                  </div>
                  <div className="col-span-2 font-mono font-bold text-slate-800">
                    {jobCard.storeDetails?.verifiedQty ? `${jobCard.storeDetails.verifiedQty} KG` : '—'}
                  </div>
                  <div className="col-span-3 flex flex-col justify-end">
                    <span className="text-[9px] text-slate-500 font-mono">Stocked by: {getOpName('Store') || '—'}</span>
                    <div className="border-b border-dashed border-slate-300 w-full mt-2" />
                  </div>
                </div>
              </div>
            </div></div>

            {/* Timeline Trace List */}
            <div className="space-y-3">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-900 border-b border-slate-400 pb-1">
                TRANSIT LEDGER & STAGE GATE AUDIT TRAIL
              </h3>
              
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <table className="w-full text-left text-xs font-mono border-collapse min-w-[600px] sm:min-w-full">
                  <thead>
                    <tr className="bg-slate-100 uppercase text-[9px] font-bold border-b border-slate-300">
                      <th className="p-2 border border-slate-200">From</th>
                      <th className="p-2 border border-slate-200">To</th>
                      <th className="p-2 border border-slate-200">Weight</th>
                      <th className="p-2 border border-slate-200">Transfer By & Date</th>
                      <th className="p-2 border border-slate-200">Acceptance Verifier & Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMovements.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-4 text-center italic text-slate-400">No dispatch movements recorded.</td>
                      </tr>
                    ) : (
                      filteredMovements.map((mov, idx) => (
                        <tr key={idx} className="border-b border-slate-200 text-[10px]">
                          <td className="p-2 border border-slate-200 font-bold">{mov.fromDepartment}</td>
                          <td className="p-2 border border-slate-200 font-bold">{mov.toDepartment}</td>
                          <td className="p-2 border border-slate-200 font-bold text-slate-900">{mov.quantity} KG</td>
                          <td className="p-2 border border-slate-200 text-slate-600">
                            {mov.transferBy} <br />
                            <span className="text-[9px] text-slate-400">{new Date(mov.transferDate).toLocaleString([], {dateStyle: 'short', timeStyle: 'short'})}</span>
                          </td>
                          <td className="p-2 border border-slate-200 text-slate-600">
                            {mov.accepted ? (
                              <>
                                Approved: {mov.acceptedBy} <br />
                                <span className="text-[9px] text-slate-400">{new Date(mov.acceptedDate!).toLocaleString([], {dateStyle: 'short', timeStyle: 'short'})}</span>
                              </>
                            ) : (
                              <span className="text-amber-600 font-bold">⌛ PENDING ACCEPTANCE</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sign-off signatures */}
            <div className="pt-8 grid grid-cols-2 gap-8 text-center text-xs">
              <div className="space-y-12">
                <div className="border-b border-slate-400 mx-12" />
                <span className="uppercase text-[9px] font-bold text-slate-500 font-sans">Warehouse Supervisor / QA Sign</span>
              </div>
              <div className="space-y-12">
                <div className="border-b border-slate-400 mx-12" />
                <span className="uppercase text-[9px] font-bold text-slate-500 font-sans">Plant Operations Manager Approval</span>
              </div>
            </div>

            {/* Footnote */}
            <div className="border-t border-slate-300 pt-3 text-center text-[9px] font-mono text-slate-400 mt-8">
              <span>This traveler ledger matches database records exactly. Platform: PRO-MFG TRACE. Timestamp: {new Date().toLocaleString()} UTC</span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            initial={isMobile ? { y: '100%', opacity: 0 } : { opacity: 0, scale: 0.93, y: 12 }}
            animate={isMobile ? { y: 0, opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={isMobile ? { y: '100%', opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
            transition={
              isMobile
                ? { type: 'spring', damping: 26, stiffness: 300 }
                : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
            }
            className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden my-0 sm:my-8 flex flex-col max-h-[92vh] sm:max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
        
        {/* Modal Top Header (Non-Printable) */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/40 print:hidden gap-2">
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
            <JobStatusBadge status={jobCard.status} size="md" />
            <span className="text-xs sm:text-sm font-semibold text-slate-500 font-mono truncate">
              <span className="hidden sm:inline">Job Card No:</span>
              <span className="sm:hidden">No:</span> {jobCard.jobCardNo}
            </span>
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              onClick={() => setShowWorkshopQR(true)}
              className="flex items-center gap-1.5 p-2 sm:px-3.5 sm:py-2 text-xs font-bold text-white bg-[#4F46E5] hover:bg-[#4338CA] dark:bg-[#6366F1] dark:hover:bg-[#4F46E5] rounded-lg transition-all shadow-sm cursor-pointer"
              id="btn_modal_generate_qr"
              title="Generate Workshop QR Label"
            >
              <QrCode className="h-4 w-4" />
              <span className="hidden sm:inline">Generate QR Label</span>
              <span className="sm:hidden">QR Label</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 p-2 sm:px-3.5 sm:py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 dark:text-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-all cursor-pointer"
              title="Print Job Card"
            >
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Print Job Card</span>
            </button>
            <button 
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Printable Contents */}
        <div className="flex-1 p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto print:p-0" id="job-card-printable-area">
          {/* Print Only Header */}
          <div className="hidden print:block mb-8 border-b-2 border-slate-900 pb-4">
            <h2 className="text-2xl font-bold tracking-tight text-center uppercase">
              Manufacturing Job Card Summary
            </h2>
            <div className="text-center font-mono text-sm mt-1">
              Generated: {new Date().toLocaleDateString()} | Factory ID: Plant #1
            </div>
          </div>

          {/* Master Details Header block and Barcode Card */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-4">
              <h3 className="font-sans font-bold text-lg sm:text-xl text-slate-900 dark:text-white">
                {jobCard.partyName}
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-4 sm:gap-x-6 text-xs sm:text-sm">
                <div>
                  <span className="text-slate-400 text-xs uppercase font-semibold">Item Specification</span>
                  <p className="font-semibold text-slate-800 dark:text-slate-200">{jobCard.itemName}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-xs uppercase font-semibold">Item Code</span>
                  <p className="font-mono font-bold text-slate-800 dark:text-slate-100">{jobCard.itemCode}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-xs uppercase font-semibold">Job Order No</span>
                  <p className="font-mono text-slate-800 dark:text-slate-100">{jobCard.orderNo}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-xs uppercase font-semibold">Created On</span>
                  <p className="text-slate-700 dark:text-slate-300">
                    {new Date(jobCard.createdAt).toLocaleDateString([], {dateStyle: 'medium'})}
                  </p>
                </div>
              </div>
            </div>

            {/* Live QR Code & Quick Copy/Share Actions */}
            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center">
              <div className="relative group p-2 bg-white rounded-lg border border-slate-200 shadow-sm print:border-none print:shadow-none mb-2">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=112x112&data=${encodeURIComponent(trackingUrl)}`} 
                  alt={`QR Code for Job Card ${jobCard.jobCardNo}`}
                  className="w-28 h-28 mix-blend-multiply dark:mix-blend-normal"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg print:hidden">
                  <a 
                    href={trackingUrl} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="p-1 px-2.5 bg-[#3B82F6] text-white text-[10px] uppercase font-bold rounded flex items-center gap-1 hover:bg-blue-600 transition animate-fade-in"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open Trace
                  </a>
                </div>
              </div>
              
              <span className="font-mono text-[9px] text-slate-500 uppercase font-semibold block">
                SCAN_JC_REF_{jobCard.jobCardNo}
              </span>

              {/* Quick print & share action tools */}
              <div className="flex gap-1.5 mt-3 w-full print:hidden">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[10.5px] font-bold border transition duration-200 cursor-pointer ${
                    copied 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/20 dark:text-emerald-400' 
                      : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-100 dark:bg-slate-850 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800'
                  }`}
                  title="Copy Tracking Link to clipboard"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleShare}
                  className="flex items-center justify-center p-1.5 px-2 rounded-md text-[10.5px] font-bold bg-[#3B82F6] text-white border border-[#1D4ED8] hover:bg-blue-600 transition duration-200 cursor-pointer"
                  title="Share or Quick Copy link"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span className="ml-1">Share</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowWorkshopQR(true)}
                className="w-full mt-3 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[10px] font-extrabold text-[#4F46E5] bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-[#818CF8] dark:hover:bg-indigo-900/40 border border-indigo-200/50 dark:border-indigo-800/30 transition duration-200 cursor-pointer"
                title="Generate physical Job Card QR label containing the raw ID"
              >
                <QrCode className="h-3.5 w-3.5" />
                <span>Generate Workshop QR</span>
              </button>
            </div>
          </div>

          {/* Workflow parameters tracking / weight balance display */}
          <div className="bg-slate-900 text-white p-3.5 sm:p-5 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 border border-slate-800">
            <div>
              <span className="text-slate-400 text-[9px] sm:text-[10px] uppercase font-bold tracking-wider block">Order Target</span>
              <p className="text-sm sm:text-base md:text-lg font-bold font-mono mt-0.5">{jobCard.orderQty} KG</p>
            </div>
            <div>
              <span className="text-slate-400 text-[9px] sm:text-[10px] uppercase font-bold tracking-wider block">
                <span className="hidden sm:inline">Current Weight In transit</span>
                <span className="sm:hidden">In Transit</span>
              </span>
              <p className="text-sm sm:text-base md:text-lg font-bold font-mono text-amber-400 mt-0.5">{jobCard.currentQty} KG</p>
            </div>
            <div>
              <span className="text-slate-400 text-[9px] sm:text-[10px] uppercase font-bold tracking-wider block">
                <span className="hidden sm:inline">Processed/Outstanding</span>
                <span className="sm:hidden">Processed / Bal</span>
              </span>
              <p className="text-sm sm:text-base md:text-lg font-bold font-mono text-indigo-400 mt-0.5">
                {jobCard.completed ? jobCard.currentQty : 0} / {jobCard.balanceQty} KG
              </p>
            </div>
            <div>
              <span className="text-slate-400 text-[9px] sm:text-[10px] uppercase font-bold tracking-wider block">
                <span className="hidden sm:inline">Heat Treatment Req</span>
                <span className="sm:hidden">Heat Treat Req</span>
              </span>
              <p className={`text-[11px] sm:text-xs md:text-sm font-semibold rounded-full px-2 py-0.5 inline-block text-center mt-1 uppercase ${
                jobCard.heatTreatmentRequired ? 'bg-orange-850 hover:bg-orange-900 border border-orange-500 text-orange-200' : 'bg-slate-800 border border-slate-700 text-slate-300'
              }`}>
                {jobCard.heatTreatmentRequired ? 'Yes' : 'No'}
              </p>
            </div>
          </div>

          {/* Dynamic routing flow balances telemetry grid */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h4 className="font-sans font-bold text-xs text-slate-800 dark:text-slate-100 uppercase tracking-widest border-b pb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#3B82F6] animate-pulse shrink-0" />
              <span>Job Routing Flow Balances Telemetry (KG)</span>
            </h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs font-sans">
              
              {/* Card 1: Production milling */}
              <div className="p-3.5 rounded-lg border border-blue-100 dark:border-blue-950/40 bg-blue-50/20 dark:bg-blue-950/5 space-y-2">
                <div className="font-bold text-blue-700 dark:text-blue-400 uppercase text-[10px] tracking-wider">Milling (PROD)</div>
                <div className="space-y-1 font-mono text-[11px] text-slate-650 dark:text-slate-350">
                  <div className="flex justify-between"><span>Received:</span> <strong className="text-slate-850 dark:text-white">{m.qtyReceivedFromProd.toLocaleString()} KG</strong></div>
                  <div className="flex justify-between items-center gap-1.5 py-0.5">
                    <span>Routed Plating:</span> 
                    <div className="flex items-center gap-1">
                      <input 
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        title="Edit Routed Plating Quantity"
                        className="w-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-1 py-0.5 text-center font-mono font-bold text-blue-600 dark:text-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500 text-[11px]"
                        value={jobCard.customRoutedToPlating !== undefined && jobCard.customRoutedToPlating !== null ? jobCard.customRoutedToPlating : m.qtyRoutedToPlating}
                        onChange={async (e) => {
                          const clean = e.target.value.replace(/\D/g, '');
                          const val = clean === '' ? undefined : Number(clean);
                          try {
                            await DBService.updateJobCard(jobCard.jobCardNo, { 
                              customRoutedToPlating: val 
                            }, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                          } catch (err) {
                            console.error("Failed to update custom Routed Plating value", err);
                          }
                        }}
                      />
                      <span className="font-bold text-[10px] text-slate-400 dark:text-slate-500 font-mono">KG</span>
                    </div>
                  </div>
                  <div className="border-t border-slate-200/50 dark:border-slate-800 pt-1 flex justify-between"><span>Remaining:</span> <span className="font-bold text-amber-600">{m.qtyRemainingAtProd.toLocaleString()} KG</span></div>
                </div>
              </div>

              {/* Card 2: Surfacing & Plating */}
              <div className="p-3.5 rounded-lg border border-purple-100 dark:border-purple-950/40 bg-purple-50/20 dark:bg-purple-950/5 space-y-2">
                <div className="font-bold text-purple-700 dark:text-purple-400 uppercase text-[10px] tracking-wider">Plating (SURF)</div>
                <div className="space-y-1 font-mono text-[11px] text-slate-650 dark:text-slate-350">
                  <div className="flex justify-between"><span>Received:</span> <strong className="text-slate-850 dark:text-white">{m.qtyReceivedAtPlating.toLocaleString()} KG</strong></div>
                  <div className="flex justify-between"><span>Routed Packing:</span> <strong className="text-purple-600 dark:text-purple-400">{m.qtyRoutedToPacking.toLocaleString()} KG</strong></div>
                  <div className="border-t border-slate-200/50 dark:border-slate-800 pt-1 flex justify-between"><span>Remaining:</span> <span className="font-bold text-amber-600">{m.qtyRemainingAtPlating.toLocaleString()} KG</span></div>
                </div>
              </div>

              {/* Card 3: Packing weights */}
              <div className="p-3.5 rounded-lg border border-pink-100 dark:border-pink-950/40 bg-pink-50/20 dark:bg-pink-950/5 space-y-2">
                <div className="font-bold text-pink-700 dark:text-pink-400 uppercase text-[10px] tracking-wider">Packing (BOX)</div>
                <div className="space-y-1 font-mono text-[11px] text-slate-650 dark:text-slate-350">
                  <div className="flex justify-between"><span>Received:</span> <strong className="text-slate-850 dark:text-white">{m.qtyReceivedAtPacking.toLocaleString()} KG</strong></div>
                  <div className="flex justify-between"><span>Routed Store:</span> <strong className="text-pink-600 dark:text-pink-400">{m.qtyRoutedToStore.toLocaleString()} KG</strong></div>
                  <div className="border-t border-slate-200/50 dark:border-slate-800 pt-1 flex justify-between"><span>Remaining:</span> <span className="font-bold text-amber-600">{m.qtyRemainingAtPacking.toLocaleString()} KG</span></div>
                </div>
              </div>

              {/* Card 4: Store Stock ledger */}
              <div className="p-3.5 rounded-lg border border-emerald-100 dark:border-emerald-950/40 bg-emerald-50/20 dark:bg-emerald-950/5 space-y-2">
                <div className="font-bold text-emerald-700 dark:text-emerald-400 uppercase text-[10px] tracking-wider">Inventory Stock</div>
                <div className="space-y-1 font-mono text-[11px] text-slate-650 dark:text-slate-350">
                  <div className="flex justify-between"><span>Recv Store:</span> <strong className="text-slate-850 dark:text-white">{m.qtyReceivedAtStore.toLocaleString()} KG</strong></div>
                  <div className="flex justify-between"><span>Dispatched:</span> <strong className="text-emerald-600 dark:text-emerald-400">{m.qtyDispatched.toLocaleString()} KG</strong></div>
                  <div className="border-t border-slate-200/50 dark:border-slate-800 pt-1 flex justify-between"><span>In Stock:</span> <span className="font-bold text-emerald-650 dark:text-emerald-400">{m.qtyRemainingInStock.toLocaleString()} KG</span></div>
                </div>
              </div>

            </div>
          </div>

          {/* Core Timeline Trace Map */}
          <TimelineVisual jobCard={jobCard} movements={filteredMovements} />

          {/* Detailed processing logs gathered per department */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Department process information summary */}
            <div className="space-y-4">
              <h4 className="font-sans font-bold text-sm text-slate-800 dark:text-slate-100 uppercase tracking-wide border-b pb-2">
                Department Signature Details
              </h4>
              
              <div className="space-y-3.5 text-xs text-slate-700 dark:text-slate-300">
                {/* Step 2 Production */}
                <div className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200/60 dark:border-slate-800/60">
                  <div className="font-semibold text-slate-800 dark:text-slate-100">Production Department info</div>
                  {jobCard.operatorName ? (
                    <div className="mt-1 space-y-1 font-mono text-[11px]">
                      <p>• Operator Name: {jobCard.operatorName}</p>
                      {getWireScrapQty(jobCard, movements) > 0 && (
                        <p className="text-amber-600 dark:text-amber-400 font-bold">• Wire Scrap: {getWireScrapQty(jobCard, movements)} KG {jobCard.productionDetails?.wireScrapReason ? `(${jobCard.productionDetails.wireScrapReason})` : ''}</p>
                      )}
                      <p>• Status: Completed Milling</p>
                    </div>
                  ) : (
                    <p className="text-slate-400 italic mt-1 font-mono text-[10px]">Pending active production logging</p>
                  )}
                </div>

                {/* Step 3 Heat Treatment */}
                {jobCard.heatTreatmentRequired && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200/60 dark:border-slate-800/60">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">Heat Treatment Department info</div>
                    {jobCard.heatTreatmentDetails ? (
                      <div className="mt-1 space-y-1 font-mono text-[11px]">
                        <p>• Hardness Required: {jobCard.heatTreatmentDetails.hardnessRequired || 'HRC 32-38'}</p>
                        <p>• Temp (C): {jobCard.heatTreatmentDetails.temperature || '850°C'}</p>
                        <p>• Cycle Time: {jobCard.heatTreatmentDetails.cycleTime || '4 hours'}</p>
                        {jobCard.heatTreatmentDetails.remarks && <p>• Remarks: {jobCard.heatTreatmentDetails.remarks}</p>}
                      </div>
                    ) : (
                      <p className="text-slate-400 italic mt-1 font-mono text-[10px]">Awaiting Heat Treat processing</p>
                    )}
                  </div>
                )}

                {/* Step 4 Plating */}
                <div className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200/60 dark:border-slate-800/60">
                  <div className="font-semibold text-slate-800 dark:text-slate-100">Plating Department info</div>
                  {jobCard.platingDetails ? (
                    <div className="mt-1 space-y-1 font-mono text-[11px]">
                      <p>• Plating Type: {jobCard.platingDetails.platingType || 'Zinc'}</p>
                      <p>• Micron Thickness: {jobCard.platingDetails.micronThickness || '8-10'}μm</p>
                      <p>• Plating Duration: {jobCard.platingDetails.durationMinutes || '45'} min</p>
                      {jobCard.platingDetails.qtyReceivedFromHt !== undefined && (
                        <p>• Qty Received from HT: {jobCard.platingDetails.qtyReceivedFromHt} KG</p>
                      )}
                      {jobCard.platingDetails.qtySentToPacking !== undefined && (
                        <p>• Qty Sent to Packing: {jobCard.platingDetails.qtySentToPacking} KG</p>
                      )}
                      {jobCard.platingDetails.qtyRemaining !== undefined && (
                        <p>• Remaining Balance: {jobCard.platingDetails.qtyRemaining} KG</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-400 italic mt-1 font-mono text-[10px]">Awaiting electroplating line</p>
                  )}
                </div>

                {/* Step 5 Packing */}
                <div className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200/60 dark:border-slate-800/60">
                   <div className="font-semibold text-slate-800 dark:text-slate-100">Packing Department info</div>
                   {jobCard.packingDetails ? (
                     <div className="mt-1 space-y-1 font-mono text-[11px]">
                       <p>• Packed Weight: {jobCard.packingDetails.packedQty || jobCard.currentQty} KG</p>
                       <p>• Box Count: {jobCard.packingDetails.boxCount || 'N/A'}</p>
                       {jobCard.packingDetails.pcsPerBagOrBox !== undefined && (
                         <p>• Pcs in Bag/Box: {jobCard.packingDetails.pcsPerBagOrBox} pcs</p>
                       )}
                       {jobCard.packingDetails.totalPcs !== undefined && (
                         <p>• Total Pieces (Pcs): {jobCard.packingDetails.totalPcs.toLocaleString()} pcs</p>
                       )}
                       <p>• Style: {jobCard.packingDetails.packingType || 'Wooden Pallets'}</p>
                       {jobCard.packingDetails.qtyReceivedFromPlating !== undefined && (
                         <p>• Qty Received from Plating: {jobCard.packingDetails.qtyReceivedFromPlating} KG</p>
                       )}
                       {jobCard.packingDetails.qtySentToStore !== undefined && (
                         <p>• Qty Sent to Store: {jobCard.packingDetails.qtySentToStore} KG</p>
                       )}
                       {jobCard.packingDetails.qtyRemaining !== undefined && (
                         <p>• Remaining Balance: {jobCard.packingDetails.qtyRemaining} KG</p>
                       )}
                     </div>
                   ) : (
                     <p className="text-slate-400 italic mt-1 font-mono text-[10px]">Awaiting box packaging</p>
                   )}
                 </div>
 
                 {/* Step 6 Store */}
                 <div className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200/60 dark:border-slate-800/60">
                   <div className="font-semibold text-slate-800 dark:text-slate-100">Store / Inventory Ingestion</div>
                   {jobCard.storeDetails ? (
                     <div className="mt-1 space-y-1 font-mono text-[11px]">
                       <p>• Verified Inventory: {jobCard.storeDetails.verifiedQty || jobCard.currentQty} KG</p>
                       <p>• Location Bin Tag: {jobCard.storeDetails.locationBin || 'BIN-A3'}</p>
                       {jobCard.storeDetails.pcsPerBagOrBox !== undefined && (
                         <p>• Pcs in Bag/Box: {jobCard.storeDetails.pcsPerBagOrBox} pcs</p>
                       )}
                       {jobCard.storeDetails.totalPcs !== undefined && (
                         <p>• Total Pieces (Pcs): {jobCard.storeDetails.totalPcs.toLocaleString()} pcs</p>
                       )}
                       {jobCard.storeDetails.qtyReceivedFromPacking !== undefined && (
                         <p>• Qty Received from Packing: {jobCard.storeDetails.qtyReceivedFromPacking} KG</p>
                       )}
                       {jobCard.storeDetails.qtySentToDispatch !== undefined && (
                         <p>• Qty Sent to Dispatch/Stocked: {jobCard.storeDetails.qtySentToDispatch} KG</p>
                       )}
                       {jobCard.storeDetails.qtyRemaining !== undefined && (
                         <p>• Remaining Balance (Hold/Pending): {jobCard.storeDetails.qtyRemaining} KG</p>
                       )}
                     </div>
                   ) : (
                     <p className="text-slate-400 italic mt-1 font-mono text-[10px]">Awaiting warehouse placement</p>
                    )}
                  </div>
                </div>
              </div>

            {/* Material Movement Audit trail & attachments list */}
            <div className="space-y-6">
              <div>
                <h4 className="font-sans font-bold text-sm text-slate-800 dark:text-slate-100 uppercase tracking-wide border-b pb-2 mb-3">
                  Transit & Acceptance Audit Trail
                </h4>
                
                {filteredMovements.length === 0 ? (
                  <p className="text-slate-400 italic text-xs font-mono">No material movements recorded yet.</p>
                ) : (
                  <div className="relative border-l border-slate-200 dark:border-slate-850 pl-4 space-y-4">
                    {filteredMovements.map((m, mIdx) => (
                      <div key={m.movementId} className="relative text-xs">
                        <div className="absolute -left-[21px] top-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-full h-3.5 w-3.5 border-2 border-slate-300 dark:border-slate-700" />
                        <div>
                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                            {m.fromDepartment} → {m.toDepartment}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            Transferred: {m.quantity} KG by {m.transferBy}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {new Date(m.transferDate).toLocaleDateString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                          
                          {m.accepted ? (
                            <div className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/20 px-1.5 py-0.5 rounded w-fit">
                              <Check className="h-3 w-3" />
                              Accepted by {m.acceptedBy} on {new Date(m.acceptedDate!).toLocaleDateString([], {hour: '2-digit', minute:'2-digit'})}
                            </div>
                          ) : (
                            <div className="mt-1 text-[10px] text-purple-600 dark:text-purple-400 font-bold bg-purple-50 dark:bg-purple-950/20 px-1.5 py-0.5 rounded w-fit">
                              ⌛ Awaiting downstream operator verification
                            </div>
                          )}

                          {m.remarks && (
                            <p className="mt-1 italic p-1 bg-slate-50 dark:bg-slate-900 text-slate-500 font-sans text-[10px] rounded border border-slate-100 dark:border-slate-850">
                              Remarks: "{m.remarks}"
                            </p>
                          )}

                          <div className="mt-1.5 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const msg = formatMovementWhatsAppMessage(m, jobCard);
                                const url = getWhatsAppShareUrl(msg, companyConfig?.whatsappPhoneNumber);
                                window.open(url, '_blank');
                              }}
                              className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded flex items-center gap-1 transition cursor-pointer"
                              title="Send WhatsApp Group Alert for this movement"
                            >
                              <MessageSquare className="h-3 w-3 text-emerald-600" />
                              Send to WhatsApp Group
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Attachment Section (Fully implementing the requested Drag-and-Drop + Manual file picker pattern) */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-slate-50 dark:bg-slate-900/20 print:hidden">
                <h4 className="font-sans font-bold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Paperclip className="h-4 w-4" />
                  Engineering Attachments & Images
                </h4>

                {/* Drag and Drop Zone Container */}
                <div 
                  id="attachment-drag-zone"
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                    isDragActive 
                      ? 'border-amber-500 bg-amber-500/10 text-amber-500' 
                      : 'border-slate-300 dark:border-slate-800 hover:border-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
                  }`}
                >
                  <input 
                    type="file" 
                    id="attachment-file-input"
                    ref={fileInputRef}
                    onChange={handleInputChange}
                    className="hidden" 
                    accept="image/*,application/pdf,.doc,.docx"
                  />
                  <Upload className="h-6 w-6 mx-auto text-slate-400 mb-2" />
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Drag & Drop File here OR <span className="text-amber-500 hover:underline">Browse</span>
                  </p>
                  <p className="text-[9px] text-slate-400 mt-1 uppercase font-mono">
                    Accepts QA PDFs, Thickness Reports, Operator Photos
                  </p>
                </div>

                {/* Local attachments lists */}
                {!(jobCard as any).attachments || !(jobCard as any).attachments.length ? (
                  <p className="text-[10px] text-slate-400 font-mono italic mt-3 text-center">
                    No blueprints or digital certificate files uploaded yet.
                  </p>
                ) : (
                  <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                    {(((jobCard as any).attachments as any[] || [])).map((file, fIdx) => (
                      <div key={fIdx} className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-750 rounded-lg text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 text-emerald-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-700 dark:text-slate-200 truncate pr-2">
                              {file.name}
                            </p>
                            <span className="text-[9px] text-slate-400 font-mono">
                              {file.size} • {new Date(file.uploadedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <a 
                            href={file.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[10px] text-amber-500 hover:underline px-1.5 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20"
                          >
                            View
                          </a>
                          <button
                            onClick={() => onDeleteAttachment(jobCard.jobCardNo, fIdx)}
                            className="p-1 rounded text-red-500 hover:bg-red-500/15"
                            title="Delete file"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>

          <AnimatePresence>
            {showWorkshopQR && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-slate-900/90 backdrop-blur-md flex items-center justify-center z-[60] p-2 sm:p-4 print:bg-white"
                id="workshop-qr-container"
                onClick={(e) => e.stopPropagation()}
              >
                <motion.div
                  initial={isMobile ? { y: '100%', opacity: 0 } : { opacity: 0, scale: 0.9, y: 10 }}
                  animate={isMobile ? { y: 0, opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                  exit={isMobile ? { y: '100%', opacity: 0 } : { opacity: 0, scale: 0.9, y: 10 }}
                  transition={isMobile ? { type: 'spring', damping: 26, stiffness: 300 } : { duration: 0.2, ease: 'easeOut' }}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl sm:rounded-2xl max-w-sm w-full p-4 sm:p-6 shadow-2xl flex flex-col items-center justify-center relative print:border-none print:shadow-none print:p-0"
                >
                  
                  {/* Close Button (Hidden on Print) */}
                  <button
                    onClick={() => setShowWorkshopQR(false)}
                    className="absolute top-3 right-3 sm:top-4 sm:right-4 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-850 text-slate-400 hover:text-slate-600 dark:hover:text-white transition cursor-pointer print:hidden"
                    title="Close QR details"
                  >
                    <X className="h-5 w-5" />
                  </button>

                  {/* Header Description */}
                  <div className="text-center mb-3 sm:mb-4 print:hidden">
                    <h4 className="text-xs font-extrabold text-[#4F46E5] dark:text-[#818CF8] uppercase tracking-widest flex items-center justify-center gap-1.5">
                      <QrCode className="h-4 w-4" />
                      Workshop QR Label
                    </h4>
                    <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Scan this QR code with the production webcam scanner to load data instantly
                    </p>
                  </div>

                  {/* Printable Area Wrapper */}
                  <div className="bg-white p-4 sm:p-6 rounded-xl sm:rounded-2xl border-2 border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center w-full shadow-inner print:border-2 print:border-black print:p-4 print:shadow-none">
                    
                    <div className="border-b border-slate-200 pb-2 mb-2 w-full print:border-slate-400">
                      <span className="text-[9px] text-slate-400 font-mono uppercase tracking-widest block font-bold">PHYSICAL SCANNER LOT LABEL</span>
                      <h2 className="text-base sm:text-lg font-black text-slate-900 font-mono tracking-tight uppercase">
                        {jobCard.jobCardNo}
                      </h2>
                    </div>

                    {/* QR Code Canvas */}
                    <div className="bg-white p-2 sm:p-3 rounded-xl border border-slate-100 shadow-sm flex items-center justify-center my-2 print:border-none print:shadow-none print:p-0">
                      <canvas ref={qrCanvasRef} className="w-40 h-40 sm:w-48 sm:h-48 max-w-full" />
                    </div>

                    {/* Dynamic details for quick verification */}
                    <div className="space-y-1 font-mono text-[10px] text-slate-700 w-full border-t border-slate-200 pt-3 mt-1 print:border-slate-400">
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-400 uppercase shrink-0 font-sans font-bold text-[9px]">Item Name:</span>
                        <strong className="text-slate-900 truncate max-w-[170px] sm:max-w-[200px] text-right">{jobCard.itemName}</strong>
                      </div>
                      {jobCard.itemCode && (
                        <div className="flex justify-between gap-2">
                          <span className="text-slate-400 uppercase shrink-0 font-sans font-bold text-[9px]">Item Code:</span>
                          <strong className="text-slate-900 font-mono text-right">{jobCard.itemCode}</strong>
                        </div>
                      )}
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-400 uppercase shrink-0 font-sans font-bold text-[9px]">Party Name:</span>
                        <strong className="text-slate-900 truncate max-w-[170px] sm:max-w-[200px] text-right">{jobCard.partyName}</strong>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-400 uppercase shrink-0 font-sans font-bold text-[9px]">Target Qty:</span>
                        <strong className="text-slate-900 text-right">{jobCard.orderQty} {jobCard.unit || 'KGS'}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Interactive Actions (Hidden on Print) */}
                  <div className="grid grid-cols-2 gap-2 mt-4 sm:mt-5 w-full print:hidden">
                    <button
                      onClick={handleDownloadQR}
                      className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 dark:text-slate-200 dark:bg-slate-900 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 transition duration-200 cursor-pointer"
                      title="Download QR code image for printing or sharing"
                    >
                      <span>💾 Download PNG</span>
                    </button>
                    <button
                      onClick={() => window.print()}
                      className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition duration-200 cursor-pointer"
                      title="Print this workshop label specifically"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      <span>Print Label</span>
                    </button>
                  </div>

                  <p className="text-[9px] sm:text-[9.5px] text-center text-slate-400 mt-3 sm:mt-4 leading-normal print:hidden">
                    💡 <strong>Usage:</strong> Stick this label onto the physical tray or container. Production supervisors can scan this using the built-in webcam scanner for error-free weight entry.
                  </p>

                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
