import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, 
  ArrowRight, 
  Check, 
  FileText, 
  User, 
  Scale, 
  Wrench, 
  CheckCircle2, 
  AlertTriangle,
  RefreshCw,
  QrCode,
  Package,
  Layers,
  Sparkles
} from 'lucide-react';
import { Department, UserProfile, RawMaterialKind } from '../../types';
import { resolveInitialPurchaseRoute } from '../../hardening/process1Purchase';

interface MobileJobCardCreateScreenProps {
  currentUser: UserProfile;
  onBack: () => void;
  onCreateJobCard: (jobData: any, initialMovementOverride?: any) => Promise<void> | void;
}

const MATERIAL_GRADES = ['10B21', 'EN8D', 'SCM435', 'CHQ-1018', 'SS304', 'MS-WC', 'BR-HEX', 'AL-6061'];
const PLATING_TYPES = ['Zinc Trivalent (Blue/Clear)', 'Zinc Yellow Passivation', 'Black Phosphate', 'Nickel Chrome', 'Geomet 500', 'Natural Self Finish'];

export const MobileJobCardCreateScreen: React.FC<MobileJobCardCreateScreenProps> = ({
  currentUser,
  onBack,
  onCreateJobCard
}) => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Form Fields
  const [itemName, setItemName] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [unit, setUnit] = useState<'KGS' | 'PCS'>('KGS');

  const [partyName, setPartyName] = useState('');
  const [poNumber, setPoNumber] = useState('');

  const [orderQty, setOrderQty] = useState<number>(0);
  const [materialGrade, setMaterialGrade] = useState('10B21');
  const [heatNo, setHeatNo] = useState('');

  const [processType, setProcessType] = useState<'Standard' | 'Purchase'>('Standard');
  const [purchaseMaterialType, setPurchaseMaterialType] = useState<'Raw Material' | 'Semi Finished Goods' | 'Finished Goods'>('Semi Finished Goods');
  const [purchaseRawKind, setPurchaseRawKind] = useState<RawMaterialKind>('Other');
  const [heatTreatmentRequired, setHeatTreatmentRequired] = useState(true);
  const [platingType, setPlatingType] = useState('Zinc Trivalent (Blue/Clear)');
  const [initialDepartment, setInitialDepartment] = useState<Department>('Production');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Validation per step
  const validateStep = (step: number): boolean => {
    setErrorMessage(null);
    if (step === 1) {
      if (!itemName.trim()) {
        setErrorMessage("Please enter an Item Description.");
        return false;
      }
      return true;
    }
    if (step === 2) {
      if (!partyName.trim()) {
        setErrorMessage("Please enter Customer / Party Name.");
        return false;
      }
      return true;
    }
    if (step === 3) {
      if (!orderQty || orderQty <= 0) {
        setErrorMessage("Please enter a valid Target Order Quantity.");
        return false;
      }
      return true;
    }
    if (step === 4 && processType === 'Purchase') {
      if (purchaseMaterialType === 'Raw Material' && !purchaseRawKind) {
        setErrorMessage("Classify Raw Material as Wire or Other.");
        return false;
      }
      return true;
    }
    return true;
  };

  const handleNextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, 5) as any);
    }
  };

  const handlePrevStep = () => {
    setErrorMessage(null);
    setCurrentStep((prev) => Math.max(prev - 1, 1) as any);
  };

  // Submit Job Card
  const handleFinalSubmit = async () => {
    if (!validateStep(3)) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (processType === 'Purchase') {
        const route = resolveInitialPurchaseRoute({
          materialType: purchaseMaterialType,
          rawMaterialKind: purchaseRawKind,
          isWire: purchaseRawKind === 'Wire',
          selectedDestination: initialDepartment
        });
        if (route.error) {
          setErrorMessage(route.error);
          setIsSubmitting(false);
          return;
        }
        const cleanItemCode = itemCode.trim() ? itemCode.trim().toUpperCase() : `PUR-${Date.now().toString().slice(-4)}`;
        const jobPayload = {
          itemName: itemName.trim(),
          itemCode: cleanItemCode,
          partyName: partyName.trim(),
          poNumber: poNumber.trim() || undefined,
          orderQty: Number(orderQty),
          currentQty: Number(orderQty),
          balanceQty: Number(orderQty),
          unit: purchaseMaterialType === 'Finished Goods' ? unit : 'KGS',
          processType: 'Purchase' as const,
          materialType: purchaseMaterialType,
          isWire: purchaseMaterialType === 'Raw Material' ? route.isWire : undefined,
          rawMaterialKind: route.rawMaterialKind || undefined,
          heatTreatmentRequired: route.destination === 'Heat Treatment',
          currentDepartment: route.destination,
          status: 'Pending Acceptance',
          purchaseDetails: {
            supplierName: partyName.trim(),
            receivedQty: Number(orderQty),
            sentToStore: Number(orderQty),
            materialType: purchaseMaterialType,
            unit: purchaseMaterialType === 'Finished Goods' ? unit : 'KGS',
            isWire: purchaseMaterialType === 'Raw Material' ? route.isWire : undefined,
            rawMaterialKind: route.rawMaterialKind || undefined
          }
        };
        await onCreateJobCard(jobPayload);
        onBack();
        return;
      }

      const cleanItemCode = itemCode.trim() ? itemCode.trim().toUpperCase() : `BOLT-${Date.now().toString().slice(-4)}`;
      const jobPayload = {
        itemName: itemName.trim(),
        itemCode: cleanItemCode,
        partyName: partyName.trim(),
        poNumber: poNumber.trim() || undefined,
        orderQty: Number(orderQty),
        currentQty: Number(orderQty),
        balanceQty: Number(orderQty),
        unit,
        materialGrade,
        heatNo: heatNo.trim() || `COIL-${Date.now().toString().slice(-4)}`,
        processType: 'Manufacturing' as const,
        heatTreatmentRequired,
        platingType,
        currentDepartment: initialDepartment,
        status: 'Pending Acceptance',
        createdAt: new Date().toISOString()
      };

      await onCreateJobCard(jobPayload);
      onBack();
    } catch (err: any) {
      console.error("Failed to create job card", err);
      setErrorMessage(err?.message || "Failed to create Job Card. Please retry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col min-h-full space-y-4 select-none pb-8">
      {/* Top Wizard Navigation Bar */}
      <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-200 transition cursor-pointer"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-tight text-slate-900 dark:text-white">
              New Job Card Wizard
            </h2>
            <p className="text-[10.5px] text-slate-500 font-mono">
              Step {currentStep} of 5 • {currentStep === 1 ? 'Item Specs' : currentStep === 2 ? 'Customer' : currentStep === 3 ? 'Material & Mass' : currentStep === 4 ? 'Process Routing' : 'Review & Confirm'}
            </p>
          </div>
        </div>

        <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1 rounded-xl">
          {Math.round((currentStep / 5) * 100)}%
        </span>
      </div>

      {/* Wizard Step Progress Indicator */}
      <div className="grid grid-cols-5 gap-1.5 px-1">
        {[1, 2, 3, 4, 5].map((stepNum) => (
          <div
            key={stepNum}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              stepNum <= currentStep ? 'bg-[#3B82F6]' : 'bg-slate-200 dark:bg-slate-800'
            }`}
          />
        ))}
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs font-bold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Step Content */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
        {/* STEP 1: ITEM IDENTIFICATION */}
        {currentStep === 1 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <Package className="h-5 w-5 text-[#3B82F6]" />
              <h3 className="text-xs font-extrabold uppercase text-slate-900 dark:text-white">
                Item & Fastener Specs
              </h3>
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Item Description <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="e.g. M8 Flange Bolt 45mm"
                autoFocus
                className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Part Code / Drawing No
              </label>
              <input
                type="text"
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
                placeholder="e.g. BOLT-M8-45"
                className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Primary Unit
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setUnit('KGS')}
                  className={`py-2.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
                    unit === 'KGS'
                      ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-[#3B82F6]'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  KGS (Kilograms)
                </button>
                <button
                  type="button"
                  onClick={() => setUnit('PCS')}
                  className={`py-2.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
                    unit === 'PCS'
                      ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-[#3B82F6]'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  PCS (Pieces)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: CUSTOMER / ORDER */}
        {currentStep === 2 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <User className="h-5 w-5 text-[#3B82F6]" />
              <h3 className="text-xs font-extrabold uppercase text-slate-900 dark:text-white">
                Customer & Order Info
              </h3>
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Customer / Party Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder="e.g. Bajaj Auto Ltd or Tata Motors"
                autoFocus
                className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Customer PO / Challan No
              </label>
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="e.g. PO-2026-991"
                className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500"
              />
            </div>
          </div>
        )}

        {/* STEP 3: QUANTITY & MATERIAL */}
        {currentStep === 3 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <Scale className="h-5 w-5 text-[#3B82F6]" />
              <h3 className="text-xs font-extrabold uppercase text-slate-900 dark:text-white">
                Target Mass & Material Grade
              </h3>
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Order Target Mass (KG) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min={1}
                value={orderQty || ''}
                onChange={(e) => setOrderQty(Number(e.target.value))}
                placeholder="e.g. 1000"
                autoFocus
                className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-mono font-extrabold text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Raw Material Grade
              </label>
              <select
                value={materialGrade}
                onChange={(e) => setMaterialGrade(e.target.value)}
                className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500 cursor-pointer"
              >
                {MATERIAL_GRADES.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Heat / Coil Serial No
              </label>
              <input
                type="text"
                value={heatNo}
                onChange={(e) => setHeatNo(e.target.value)}
                placeholder="e.g. HEAT-9921"
                className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500"
              />
            </div>
          </div>
        )}

        {/* STEP 4: PROCESS ROUTING */}
        {currentStep === 4 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <Wrench className="h-5 w-5 text-[#3B82F6]" />
              <h3 className="text-xs font-extrabold uppercase text-slate-900 dark:text-white">
                Process Routing & Surface Treatment
              </h3>
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Job Kind
              </label>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button type="button" onClick={() => setProcessType('Standard')} className={`py-2.5 rounded-xl text-xs font-bold border ${processType === 'Standard' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-slate-50 border-slate-200'}`}>Manufacturing</button>
                <button type="button" onClick={() => setProcessType('Purchase')} className={`py-2.5 rounded-xl text-xs font-bold border ${processType === 'Purchase' ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-slate-50 border-slate-200'}`}>Purchase Inward</button>
              </div>
            </div>

            {processType === 'Purchase' ? (
              <>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 block mb-1">Material Type</label>
                  <select
                    value={purchaseMaterialType}
                    onChange={(e) => {
                      const mt = e.target.value as any;
                      setPurchaseMaterialType(mt);
                      if (mt === 'Raw Material') setInitialDepartment(purchaseRawKind === 'Wire' ? 'Raw Material Store' : 'Incoming Store');
                      if (mt === 'Semi Finished Goods') setInitialDepartment('Production');
                      if (mt === 'Finished Goods') setInitialDepartment('Store');
                    }}
                    className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold"
                  >
                    <option value="Raw Material">Raw Material</option>
                    <option value="Semi Finished Goods">Semi Finished Goods</option>
                    <option value="Finished Goods">Finished Goods</option>
                  </select>
                </div>
                {purchaseMaterialType === 'Raw Material' && (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => { setPurchaseRawKind('Wire'); setInitialDepartment('Raw Material Store'); }} className={`py-2 rounded-xl text-xs font-bold border ${purchaseRawKind === 'Wire' ? 'bg-emerald-600 text-white' : 'bg-slate-50'}`}>Wire</button>
                    <button type="button" onClick={() => { setPurchaseRawKind('Other'); setInitialDepartment('Incoming Store'); }} className={`py-2 rounded-xl text-xs font-bold border ${purchaseRawKind === 'Other' ? 'bg-purple-600 text-white' : 'bg-slate-50'}`}>Other RM</button>
                  </div>
                )}
                {purchaseMaterialType === 'Finished Goods' && (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setUnit('KGS')} className={`py-2 rounded-xl text-xs font-bold border ${unit === 'KGS' ? 'bg-indigo-600 text-white' : 'bg-slate-50'}`}>KG</button>
                    <button type="button" onClick={() => setUnit('PCS')} className={`py-2 rounded-xl text-xs font-bold border ${unit === 'PCS' ? 'bg-pink-600 text-white' : 'bg-slate-50'}`}>PCS</button>
                  </div>
                )}
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 block mb-1">Initial Destination</label>
                  <select
                    value={initialDepartment}
                    onChange={(e) => setInitialDepartment(e.target.value as any)}
                    className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold"
                  >
                    {purchaseMaterialType === 'Raw Material' && (
                      purchaseRawKind === 'Wire'
                        ? <option value="Raw Material Store">Raw Material Store</option>
                        : <option value="Incoming Store">Incoming Store</option>
                    )}
                    {purchaseMaterialType === 'Semi Finished Goods' && (
                      <>
                        <option value="Production">Production</option>
                        <option value="Heat Treatment">Heat Treatment</option>
                        <option value="Plating">Plating</option>
                        <option value="Incoming Store">Incoming Store</option>
                      </>
                    )}
                    {purchaseMaterialType === 'Finished Goods' && (
                      <>
                        <option value="Dispatch">Direct Dispatch</option>
                        <option value="Store">Finished Goods Store</option>
                      </>
                    )}
                  </select>
                </div>
              </>
            ) : (
              <>
            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Heat Treatment Furnace Required?
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setHeatTreatmentRequired(true)}
                  className={`py-2.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
                    heatTreatmentRequired
                      ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-500 text-rose-600 dark:text-rose-400'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  Yes (Furnace Pass)
                </button>
                <button
                  type="button"
                  onClick={() => setHeatTreatmentRequired(false)}
                  className={`py-2.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
                    !heatTreatmentRequired
                      ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-[#3B82F6]'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  No (Bypass HT)
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Plating & Surface Coating
              </label>
              <select
                value={platingType}
                onChange={(e) => setPlatingType(e.target.value)}
                className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500 cursor-pointer"
              >
                {PLATING_TYPES.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-500 block mb-1">
                Initial Destination Station
              </label>
              <select
                value={initialDepartment}
                onChange={(e) => setInitialDepartment(e.target.value as any)}
                className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500 cursor-pointer"
              >
                <option value="Production">Production (Heading/Forging)</option>
                <option value="Raw Material Store">Raw Material Store</option>
              </select>
            </div>
              </>
            )}
          </div>
        )}

        {/* STEP 5: REVIEW & CONFIRM */}
        {currentStep === 5 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <h3 className="text-xs font-extrabold uppercase text-slate-900 dark:text-white">
                Review & Confirm Creation
              </h3>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2.5 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Item:</span>
                <span className="font-bold text-slate-900 dark:text-white">{itemName} ({itemCode || 'Auto'})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Customer:</span>
                <span className="font-bold text-slate-900 dark:text-white">{partyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Order Mass:</span>
                <span className="font-extrabold text-[#3B82F6]">{orderQty} {unit}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Material Grade:</span>
                <span className="font-bold text-slate-900 dark:text-white">{materialGrade}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Heat No:</span>
                <span className="font-bold text-slate-900 dark:text-white">{heatNo || 'Auto'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Heat Treatment:</span>
                <span className="font-bold text-slate-900 dark:text-white">{heatTreatmentRequired ? 'Required' : 'Bypassed'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Plating:</span>
                <span className="font-bold text-slate-900 dark:text-white">{platingType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Initial Station:</span>
                <span className="font-extrabold text-emerald-600 dark:text-emerald-400">{initialDepartment}</span>
              </div>
            </div>
          </div>
        )}

        {/* Step Action Buttons */}
        <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          {currentStep > 1 && (
            <button
              type="button"
              onClick={handlePrevStep}
              disabled={isSubmitting}
              className="flex-1 min-h-[46px] py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs cursor-pointer active:scale-98 transition"
            >
              Back
            </button>
          )}

          {currentStep < 5 ? (
            <button
              type="button"
              onClick={handleNextStep}
              className="flex-1 min-h-[46px] py-2.5 rounded-2xl bg-[#3B82F6] hover:bg-blue-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md cursor-pointer active:scale-98 transition"
            >
              <span>Next Step</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinalSubmit}
              disabled={isSubmitting}
              className="flex-1 min-h-[48px] py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md cursor-pointer active:scale-98 transition disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Creating Job Card...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Confirm & Generate Job Card</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MobileJobCardCreateScreen;
