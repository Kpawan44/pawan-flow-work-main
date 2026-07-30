import React, { useState, useEffect } from 'react';
import { X, Search, FileSpreadsheet, Download, RefreshCw, Layers } from 'lucide-react';
import { getEmulatedSheetRows } from '../lib/googleSheets';

interface GoogleSheetViewerProps {
  onClose: () => void;
  spreadsheetName?: string;
  spreadsheetUrl?: string;
}

export default function GoogleSheetViewer({
  onClose,
  spreadsheetName = 'Factory Material Flow Ledger',
  spreadsheetUrl = ''
}: GoogleSheetViewerProps) {
  const [activeTab, setActiveTab] = useState<string>('Job Cards');
  const [searchTerm, setSearchTerm] = useState('');
  const [sheetData, setSheetData] = useState<Record<string, any[][]>>({});
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  const tabs = ['Job Cards', 'Department Updates', 'Material Movements', 'Actions & Audit Log'];

  const loadData = () => {
    const rows = getEmulatedSheetRows();
    setSheetData(rows);
    setLastRefreshed(new Date().toLocaleTimeString());
  };

  useEffect(() => {
    loadData();
    // Refresh periodically if open
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const currentTabRows = sheetData[activeTab] || [];
  const headers = currentTabRows[0] || [];
  const rows = currentTabRows.slice(1) || [];

  // Filter rows based on search term
  const filteredRows = rows.filter((row) => {
    if (!searchTerm) return true;
    return row.some((cell) => 
      String(cell).toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const handleDownloadCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    currentTabRows.forEach((rowArray) => {
      const row = rowArray.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",");
      csvContent += row + "\r\n";
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${spreadsheetName} - ${activeTab}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in font-sans">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden shadow-2xl relative">
        
        {/* Header Bar */}
        <div className="bg-[#107C41] text-white px-6 py-4 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <FileSpreadsheet className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-wide flex items-center gap-2">
                <span>Google Sheets Live Inspector</span>
                <span className="bg-white/10 text-emerald-100 text-[10px] uppercase font-mono px-1.5 py-0.5 rounded tracking-normal">Live Sync Active</span>
              </h3>
              <p className="text-[11px] text-emerald-100 font-medium">
                {spreadsheetName} • Real-time logged production database
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              className="p-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-white transition-all flex items-center gap-1.5 text-xs font-semibold"
              title="Refresh sheet data"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Refreshed: {lastRefreshed}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-white transition-all cursor-pointer"
              title="Close Spreadsheet Inspector"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Toolbar & Filter Panel */}
        <div className="p-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-850 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between shrink-0">
          {/* Tab Selector */}
          <div className="flex overflow-x-auto gap-1 pb-1 md:pb-0 scrollbar-none shrink-0">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setSearchTerm('');
                }}
                className={`px-3 py-1.5 rounded-lg font-bold font-sans text-xs shrink-0 transition-all cursor-pointer ${
                  activeTab === tab
                    ? 'bg-[#107C41] text-white shadow-xs'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Action Buttons & Search */}
          <div className="flex flex-1 md:justify-end items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search className="h-3.5 w-3.5" />
              </span>
              <input
                type="text"
                placeholder={`Search current tab...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full text-xs font-medium pl-9 pr-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 rounded-lg outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-sans"
              />
            </div>
            <button
              onClick={handleDownloadCSV}
              className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 font-bold text-xs py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 shadow-xs transition"
              title="Download sheet data as CSV file"
            >
              <Download className="h-3.5 w-3.5 text-[#107C41]" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
          </div>
        </div>

        {/* Spreadsheet Data Grid */}
        <div className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-950 p-1">
          {filteredRows.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
              <Layers className="h-10 w-10 text-slate-300 mb-2" />
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No Sync Records Found</p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-sm">
                Make production updates, log transfers, or create job cards to see real-time rows populate this sheet.
              </p>
            </div>
          ) : (
            <div className="min-w-full inline-block align-middle">
              <div className="overflow-hidden border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 text-left">
                  <thead className="bg-slate-50 dark:bg-slate-850">
                    <tr>
                      {/* Row Index Column */}
                      <th className="px-2 py-2 border-r border-b border-slate-200 dark:border-slate-800 text-center text-[10px] font-bold font-mono text-slate-400 select-none w-10 bg-slate-100 dark:bg-slate-900">
                        #
                      </th>
                      {headers.map((hdr, idx) => (
                        <th
                          key={idx}
                          className="px-4 py-2 border-r border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono text-[10px] font-bold uppercase tracking-wider whitespace-nowrap bg-slate-50 dark:bg-slate-850"
                        >
                          {hdr}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 dark:divide-slate-850">
                    {filteredRows.map((row, rowIdx) => (
                      <tr 
                        key={rowIdx} 
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-850/40 transition-all odd:bg-white dark:odd:bg-slate-900 even:bg-slate-50/20 dark:even:bg-slate-850/10"
                      >
                        <td className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-850 text-center text-[10px] font-medium font-mono text-slate-400 bg-slate-100/50 dark:bg-slate-950/20 select-none">
                          {rowIdx + 2}
                        </td>
                        {row.map((cell, cellIdx) => (
                          <td
                            key={cellIdx}
                            className="px-4 py-1.5 border-r border-slate-150 dark:border-slate-850 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-nowrap"
                          >
                            {cell === 'YES' || cell === 'Completed' ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 font-sans border border-emerald-150 dark:border-emerald-900/20">
                                {String(cell)}
                              </span>
                            ) : cell === 'NO' ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-sans border border-slate-150 dark:border-slate-700/50">
                                {String(cell)}
                              </span>
                            ) : String(cell).startsWith('JC-') || String(cell).startsWith('PUR-') || String(cell).startsWith('MOV-') ? (
                              <span className="font-bold text-slate-850 dark:text-white">{String(cell)}</span>
                            ) : (
                              String(cell)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Status Bar */}
        <div className="bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-850 px-6 py-3 flex flex-col sm:flex-row justify-between items-center text-center sm:text-left gap-2 text-[11px] text-slate-500 shrink-0">
          <div className="flex flex-wrap justify-center sm:justify-start items-center gap-3">
            <span>
              Rows Loaded: <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">{filteredRows.length}</span> (excluding headers)
            </span>
            <span className="hidden sm:inline text-slate-300">|</span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">Synced in local storage emulated ledger</span>
            </span>
          </div>
          {spreadsheetUrl && (
            <a
              href={spreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#107C41] hover:underline font-semibold flex items-center gap-1 text-[10.5px]"
              title="Open the real Google Sheets document in a new tab"
            >
              <span>View Online Sheet</span>
              <X className="h-3 w-3 rotate-45 shrink-0" />
            </a>
          )}
        </div>

      </div>
    </div>
  );
}
