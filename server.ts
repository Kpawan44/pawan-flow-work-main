import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import nodemailer from "nodemailer";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Global log for all triggered emails (in-memory persistent state)
  interface SentEmail {
    id: string;
    timestamp: string;
    subject: string;
    recipient: string;
    executiveSummary: string;
    criticalBottlenecks: string[];
    recommendedActions: string[];
    htmlBody: string;
    status: 'sent' | 'queued' | 'simulated';
    error?: string;
  }

  const sentEmailsLog: SentEmail[] = [
    {
      id: "se-1",
      timestamp: new Date(Date.now() - 3600000 * 24).toISOString(), // 1 day ago
      subject: "[Daily Operations Summary] PMW Factory Yield: 97.4% with 2 Pending Completions",
      recipient: "pawan.kummar16@gmail.com",
      executiveSummary: "Factory operations run within normal limits. Materials dispatch and heat treatment schedules are on track. Minor scrap accumulation of 50 KG observed in JC-1002.",
      criticalBottlenecks: [
        "Moderate scrap loss (10%) detected in Production department for JC-1002."
      ],
      recommendedActions: [
        "Audit tool alignment on trimming machinery to prevent future edge fractures.",
        "Calibrate temperature levels on furnace B ahead of upcoming high-volume alloy run."
      ],
      htmlBody: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #4F46E5; margin-bottom: 20px;">Daily Operations Summary Log</h2>
          <p><strong>Date:</strong> Yesterday</p>
          <p>This is a simulated entry documenting past scheduled runs of the automated reporting cloud function.</p>
        </div>
      `,
      status: "simulated"
    }
  ];

  // GET sent emails outbox
  app.get("/api/sent-emails", (req, res) => {
    res.json(sentEmailsLog);
  });

  // POST trigger automated daily report email
  app.post("/api/trigger-daily-summary", async (req, res) => {
    try {
      const { jobCards = [], movements = [], recipient } = req.body;
      const targetRecipient = recipient || process.env.ADMIN_EMAIL || "pawan.kummar16@gmail.com";
      
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not defined");
      }
      
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Prepare stats
      const totalJobCards = jobCards.length;
      const pendingJobs = jobCards.filter((c: any) => !c.completed);
      const completedJobs = jobCards.filter((c: any) => c.completed);
      
      const totalOrderQty = jobCards.reduce((acc: number, c: any) => acc + (c.orderQty || 0), 0);
      const totalPendingQty = pendingJobs.reduce((acc: number, c: any) => acc + (c.balanceQty || 0), 0);
      
      // Calculate department rejections
      const deptRejections: Record<string, { processed: number; rejected: number }> = {
        'Production': { processed: 0, rejected: 0 },
        'Heat Treatment': { processed: 0, rejected: 0 },
        'Plating': { processed: 0, rejected: 0 },
        'Packing': { processed: 0, rejected: 0 },
        'Store': { processed: 0, rejected: 0 }
      };

      jobCards.forEach((jc: any) => {
        deptRejections['Production'].processed += jc.orderQty || 0;
        if (jc.status === 'Rejected' && jc.currentDepartment === 'Production') {
          deptRejections['Production'].rejected += jc.orderQty || 0;
        }

        if (jc.heatTreatmentRequired) {
          const htDet = jc.heatTreatmentDetails;
          const htProcessed = htDet?.qtyReceivedFromProd || 0;
          const htRejections = htDet?.rejectionQty || 0;
          deptRejections['Heat Treatment'].processed += htProcessed;
          deptRejections['Heat Treatment'].rejected += htRejections;
        }

        const platDet = jc.platingDetails;
        const platProcessed = platDet?.qtyReceivedFromHt || 0;
        const platRejections = platDet?.rejectionQty || 0;
        deptRejections['Plating'].processed += platProcessed;
        deptRejections['Plating'].rejected += platRejections;

        const packDet = jc.packingDetails;
        const packProcessed = packDet?.qtyReceivedFromPlating || 0;
        const packRejections = packDet?.rejectionQty || 0;
        deptRejections['Packing'].processed += packProcessed;
        deptRejections['Packing'].rejected += packRejections;

        const storeDet = jc.storeDetails;
        const storeProcessed = storeDet?.qtyReceivedFromPacking || 0;
        const storeRejections = storeDet?.rejectionQty || 0;
        deptRejections['Store'].processed += storeProcessed;
        deptRejections['Store'].rejected += storeRejections;
      });

      const processedStats = Object.entries(deptRejections).map(([dept, val]) => {
        const rate = val.processed > 0 ? (val.rejected / val.processed) * 100 : 0;
        return {
          department: dept,
          processedKg: val.processed,
          rejectedKg: val.rejected,
          rejectionRate: `${rate.toFixed(2)}%`
        };
      });

      const activeJobsList = pendingJobs.map((c: any) => ({
        jobCardNo: c.jobCardNo,
        partyName: c.partyName,
        itemName: c.itemName,
        currentQty: c.currentQty,
        balanceQty: c.balanceQty,
        currentDepartment: c.currentDepartment,
        status: c.status,
        createdAt: c.createdAt
      }));

      const systemContext = `
        You are an advanced industrial operations and quality analysis AI daemon at Precision Metal Works.
        Your task is to review the active operations state, pending job cards, and departmental rejection statistics, and generate a comprehensive executive email notification.
        
        DATA FOR ANALYSIS:
        - Total Job Cards: ${totalJobCards}
        - Pending/In-Progress Job Cards: ${pendingJobs.length} (${totalPendingQty} KG remaining)
        - Completed Job Cards: ${completedJobs.length}
        - Department Rejection Metrics: ${JSON.stringify(processedStats)}
        - Active Job Cards: ${JSON.stringify(activeJobsList)}
      `;

      const promptText = `Generate a daily executive summary report for the admin team.
        Review all pending completions and departmental quality rates.
        Ensure your "htmlBody" is a stunningly designed responsive HTML template with inline styles, custom typography, slate-900 styled table rows, highlighted alert boxes for high rejection rates (e.g. over 5%), and visual sections for corrective recommendations. Make it look like a high-end email notification sent from a premium enterprise platform. Do not include external assets or image placeholders, only use clean HTML/CSS with standard colors (indigo \`#4F46E5\`, slate \`#1E293B\`, emerald \`#10B981\`, rose \`#EF4444\`).`;

      let reportData: any;
      try {
        const geminiResponse = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: promptText,
          config: {
            systemInstruction: systemContext,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                subject: {
                  type: Type.STRING,
                  description: "The professional, concise subject line of the daily automated operations mail."
                },
                executiveSummary: {
                  type: Type.STRING,
                  description: "High-level summary of factory yield, completions, and operations for the admin dashboard (2-3 sentences)."
                },
                criticalBottlenecks: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Array of detected process anomalies, high-rejection departments, or overdue job cards."
                },
                recommendedActions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Strategic action steps the management team should execute to resolve bottlenecks."
                },
                htmlBody: {
                  type: Type.STRING,
                  description: "Complete, responsive, production-ready, beautifully designed inline-styled HTML email body."
                }
              },
              required: ["subject", "executiveSummary", "criticalBottlenecks", "recommendedActions", "htmlBody"]
            }
          }
        });

        const textOutput = geminiResponse.text;
        if (!textOutput) {
          throw new Error("Failed to receive structured report content from Gemini");
        }

        reportData = JSON.parse(textOutput);
      } catch (geminiError: any) {
        console.warn("Gemini compilation failed (quota/billing depleted). Initiating rule-based heuristic fallback generator:", geminiError);
        
        const highRejectionDepts = processedStats.filter((s: any) => parseFloat(s.rejectionRate) > 5.0).map((s: any) => s.department);
        const activeYield = totalJobCards > 0 ? ((completedJobs.length / totalJobCards) * 100).toFixed(1) : "100.0";
        
        const subject = `[Daily Operations Summary] PMW Factory Yield: ${activeYield}% with ${pendingJobs.length} Pending Completions`;
        const executiveSummary = `This automated report summary was generated via high-fidelity rule-based manufacturing heuristics. Currently, Precision Metal Works is tracking ${pendingJobs.length} pending/in-progress job cards representing a remaining material balance of ${totalPendingQty} KG. A total of ${completedJobs.length} job cards have been successfully closed and moved to the store. Current departmental material quality and throughput metrics are documented below.`;
        
        const criticalBottlenecks: string[] = [];
        if (highRejectionDepts.length > 0) {
          highRejectionDepts.forEach((dept: string) => {
            const stat = processedStats.find((s: any) => s.department === dept);
            criticalBottlenecks.push(`Elevated material rejection rate detected in ${dept} department: ${stat?.rejectionRate} (${stat?.rejectedKg} KG rejected out of ${stat?.processedKg} KG processed).`);
          });
        } else {
          criticalBottlenecks.push("All active production departments are performing within normal operational tolerances (rejections under 5.0%).");
        }
        
        const rejectedJobs = pendingJobs.filter((jc: any) => jc.status === 'Rejected');
        if (rejectedJobs.length > 0) {
          criticalBottlenecks.push(`${rejectedJobs.length} active job cards are flagged with "Rejected" status and require immediate rework evaluation (e.g., ${rejectedJobs.slice(0, 2).map((j: any) => j.jobCardNo).join(', ')}).`);
        }
        
        const recommendedActions: string[] = [];
        if (highRejectionDepts.length > 0) {
          recommendedActions.push(`Deploy quality assurance supervisors to review machine calibration and operator procedures in: ${highRejectionDepts.join(', ')}.`);
        } else {
          recommendedActions.push("Maintain standard production throughput speed with regular daily equipment maintenance checkups.");
        }
        recommendedActions.push("Prioritize processing for job cards with small remaining balances to expedite order completions and free floor space.");
        if (rejectedJobs.length > 0) {
          recommendedActions.push(`Initiate immediate material rework protocols or log scrap salvage transactions for rejected job cards: ${rejectedJobs.map((j: any) => j.jobCardNo).join(', ')}.`);
        }
        recommendedActions.push("Audit store receiving logs to verify that packing dispatch inventories perfectly sync with active ledger totals.");

        const statsRows = processedStats.map((s: any) => {
          const isHigh = parseFloat(s.rejectionRate) > 5.0;
          const rateColor = isHigh ? '#EF4444' : '#10B981';
          const rateWeight = isHigh ? 'bold' : 'normal';
          return `
            <tr style="border-bottom: 1px solid #E2E8F0;">
              <td style="padding: 12px; font-weight: 500; color: #1E293B;">${s.department}</td>
              <td style="padding: 12px; text-align: right; color: #475569;">${s.processedKg} KG</td>
              <td style="padding: 12px; text-align: right; color: #EF4444;">${s.rejectedKg} KG</td>
              <td style="padding: 12px; text-align: right; color: ${rateColor}; font-weight: ${rateWeight};">${s.rejectionRate}</td>
            </tr>
          `;
        }).join('');

        const bottleneckItems = criticalBottlenecks.map((b: string) => `
          <li style="margin-bottom: 8px; color: #E11D48; font-weight: 500;">
            <span style="color: #475569; font-weight: normal;">${b}</span>
          </li>
        `).join('');

        const recommendationItems = recommendedActions.map((a: string) => `
          <li style="margin-bottom: 8px; color: #4F46E5; font-weight: 500;">
            <span style="color: #475569; font-weight: normal;">${a}</span>
          </li>
        `).join('');

        const htmlBody = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>PMW Automated Operations Report</title>
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; color: #334155;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F8FAFC; padding: 24px 0;">
              <tr>
                <td align="center">
                  <table width="640" border="0" cellspacing="0" cellpadding="0" style="background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    <tr style="background-color: #1E293B;">
                      <td style="padding: 32px 24px; text-align: left;">
                        <h1 style="margin: 0; color: #FFFFFF; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Precision Metal Works</h1>
                        <p style="margin: 4px 0 0 0; color: #94A3B8; font-size: 13px; font-weight: 500;">DAILY OPERATIONS & QUALITY LEDGER</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 32px 24px;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                          <tr>
                            <td width="31%" style="background-color: #F1F5F9; border-radius: 8px; padding: 16px; text-align: center;">
                              <span style="display: block; font-size: 11px; color: #64748B; font-weight: 600; text-transform: uppercase;">Total Orders</span>
                              <span style="display: block; font-size: 24px; color: #1E293B; font-weight: 700; margin-top: 4px;">${totalJobCards}</span>
                            </td>
                            <td width="3%"></td>
                            <td width="32%" style="background-color: #EEF2FF; border-radius: 8px; padding: 16px; text-align: center;">
                              <span style="display: block; font-size: 11px; color: #4F46E5; font-weight: 600; text-transform: uppercase;">Active / Pending</span>
                              <span style="display: block; font-size: 24px; color: #4F46E5; font-weight: 700; margin-top: 4px;">${pendingJobs.length}</span>
                            </td>
                            <td width="3%"></td>
                            <td width="31%" style="background-color: #ECFDF5; border-radius: 8px; padding: 16px; text-align: center;">
                              <span style="display: block; font-size: 11px; color: #059669; font-weight: 600; text-transform: uppercase;">Completed</span>
                              <span style="display: block; font-size: 24px; color: #059669; font-weight: 700; margin-top: 4px;">${completedJobs.length}</span>
                            </td>
                          </tr>
                        </table>
                        <h2 style="font-size: 15px; color: #1E293B; font-weight: 600; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px;">Executive Summary</h2>
                        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-top: 0; margin-bottom: 24px;">
                          ${executiveSummary}
                        </p>
                        <h2 style="font-size: 15px; color: #1E293B; font-weight: 600; margin-top: 0; margin-bottom: 12px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px;">Departmental Material Quality Audit</h2>
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; font-size: 13px; margin-bottom: 24px;">
                          <tr style="background-color: #F8FAFC; border-bottom: 2px solid #E2E8F0;">
                            <th align="left" style="padding: 12px; color: #64748B; font-weight: 600;">Department</th>
                            <th align="right" style="padding: 12px; color: #64748B; font-weight: 600;">Processed (KG)</th>
                            <th align="right" style="padding: 12px; color: #64748B; font-weight: 600;">Rejected (KG)</th>
                            <th align="right" style="padding: 12px; color: #64748B; font-weight: 600;">Rejection Rate</th>
                          </tr>
                          ${statsRows}
                        </table>
                        <div style="background-color: #FFF1F2; border-left: 4px solid #F43F5E; border-radius: 4px; padding: 16px; margin-bottom: 24px;">
                          <h3 style="font-size: 14px; color: #9F1239; font-weight: 600; margin-top: 0; margin-bottom: 8px;">Critical Bottlenecks & Anomalies</h3>
                          <ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.5; color: #475569;">
                            ${bottleneckItems}
                          </ul>
                        </div>
                        <div style="background-color: #F5F3FF; border-left: 4px solid #8B5CF6; border-radius: 4px; padding: 16px; margin-bottom: 0;">
                          <h3 style="font-size: 14px; color: #5B21B6; font-weight: 600; margin-top: 0; margin-bottom: 8px;">Recommended Operational Actions</h3>
                          <ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.5; color: #475569;">
                            ${recommendationItems}
                          </ul>
                        </div>
                      </td>
                    </tr>
                    <tr style="background-color: #F8FAFC; border-top: 1px solid #E2E8F0;">
                      <td style="padding: 24px; text-align: center; font-size: 11px; color: #94A3B8;">
                        <p style="margin: 0 0 4px 0;">This email is an automated transmission from the PMW Manufacturing Ledger platform.</p>
                        <p style="margin: 0;">Precision Metal Works © 2026. All rights reserved.</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `;

        reportData = {
          subject,
          executiveSummary,
          criticalBottlenecks,
          recommendedActions,
          htmlBody
        };
      }

      // Attempt to transmit email via Nodemailer if SMTP secrets are defined
      let mailStatus: 'sent' | 'queued' | 'simulated' = 'queued';
      let mailError: string | undefined = undefined;

      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        try {
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            },
          });

          await transporter.sendMail({
            from: `"PMW Automated Operations" <${process.env.SMTP_USER}>`,
            to: targetRecipient,
            subject: reportData.subject,
            html: reportData.htmlBody,
          });

          mailStatus = 'sent';
          console.log(`Daily operations report sent successfully to ${targetRecipient}`);
        } catch (err: any) {
          mailStatus = 'queued';
          mailError = err instanceof Error ? err.message : String(err);
          console.warn("SMTP send failed, email logged to system outbox queue:", mailError);
        }
      } else {
        mailStatus = 'queued';
        console.info(`SMTP credentials not defined. Report successfully compiled and queued in simulated Outbox. Recipient: ${targetRecipient}`);
      }

      const newEmailRecord: SentEmail = {
        id: `se-${Date.now()}`,
        timestamp: new Date().toISOString(),
        subject: reportData.subject,
        recipient: targetRecipient,
        executiveSummary: reportData.executiveSummary,
        criticalBottlenecks: reportData.criticalBottlenecks,
        recommendedActions: reportData.recommendedActions,
        htmlBody: reportData.htmlBody,
        status: mailStatus,
        error: mailError
      };

      sentEmailsLog.unshift(newEmailRecord);

      res.json({
        success: true,
        record: newEmailRecord,
        smtpConfigured: !!process.env.SMTP_HOST
      });

    } catch (error: any) {
      console.error("Daily summary compile error:", error);
      res.status(500).json({ error: "Failed to compile automated daily summary", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
