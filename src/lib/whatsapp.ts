import { MaterialMovement, JobCard, CompanyConfig } from '../types';

/**
 * Formats a WhatsApp message for a Job Card material movement.
 * Ensures Job Card No, Item Name, Item Code, Quantity, and Movement (From Dept -> To Dept) are clearly included.
 */
export function formatMovementWhatsAppMessage(
  movement: Partial<MaterialMovement>,
  jobCard?: Partial<JobCard>
): string {
  const jobCardNo = movement.jobCardNo || jobCard?.jobCardNo || 'N/A';
  const itemName = jobCard?.itemName || movement.processDetails?.itemName || 'N/A';
  const itemCode = jobCard?.itemCode || movement.processDetails?.itemCode || 'N/A';
  const qty = movement.quantity !== undefined ? `${movement.quantity} ${movement.requestedUnit || jobCard?.unit || 'KG'}` : 'N/A';
  const fromDept = movement.fromDepartment || 'N/A';
  const toDept = movement.toDepartment || 'N/A';
  const transferBy = movement.transferBy || 'Operator';
  const dateStr = movement.transferDate 
    ? new Date(movement.transferDate).toLocaleString() 
    : new Date().toLocaleString();

  return [
    `🚚 *MFR ERP - JOB CARD MOVEMENT ALERT* 🚚`,
    ``,
    `📋 *Job Card No:* ${jobCardNo}`,
    `📦 *Item Name:* ${itemName}`,
    `🏷️ *Item Code:* ${itemCode}`,
    `⚖️ *Quantity Moved:* ${qty}`,
    `🔄 *Movement:* ${fromDept} ➡️ ${toDept}`,
    `👤 *Transferred By:* ${transferBy}`,
    `🕒 *Date & Time:* ${dateStr}`,
    ``,
    `----------------------------------`,
    `_Automated Factory Update_`
  ].join('\n');
}

/**
 * Generates a WhatsApp web/app share URL or direct chat link.
 */
export function getWhatsAppShareUrl(message: string, phoneOrGroupLink?: string): string {
  const encodedText = encodeURIComponent(message);
  
  if (phoneOrGroupLink) {
    const cleanStr = phoneOrGroupLink.trim();
    if (cleanStr.includes('chat.whatsapp.com')) {
      return `https://api.whatsapp.com/send?text=${encodedText}`;
    }
    const phoneOnly = cleanStr.replace(/[^0-9]/g, '');
    if (phoneOnly.length >= 8) {
      return `https://api.whatsapp.com/send?phone=${phoneOnly}&text=${encodedText}`;
    }
  }

  return `https://api.whatsapp.com/send?text=${encodedText}`;
}

/**
 * Triggers WhatsApp notification dispatch according to Super Admin settings in CompanyConfig.
 */
export async function triggerWhatsAppMovementNotification(
  movement: MaterialMovement,
  jobCard?: JobCard,
  config?: CompanyConfig
): Promise<{ success: boolean; url?: string; message: string; method: 'api' | 'share' | 'disabled' }> {
  // 1. Check if WhatsApp notifications are enabled by Super Admin
  if (config && config.whatsappEnabled === false) {
    return {
      success: false,
      message: 'WhatsApp notifications disabled by Super Admin',
      method: 'disabled'
    };
  }

  const formattedMsg = formatMovementWhatsAppMessage(movement, jobCard);
  const shareUrl = getWhatsAppShareUrl(formattedMsg, config?.whatsappPhoneNumber);

  // 2. If Super Admin configured a Webhook API URL
  if (config?.whatsappApiUrl && config.whatsappApiUrl.trim().startsWith('http')) {
    try {
      const resp = await fetch(config.whatsappApiUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: formattedMsg,
          jobCardNo: movement.jobCardNo,
          itemName: jobCard?.itemName || movement.processDetails?.itemName || 'N/A',
          itemCode: jobCard?.itemCode || movement.processDetails?.itemCode || 'N/A',
          quantity: movement.quantity,
          fromDepartment: movement.fromDepartment,
          toDepartment: movement.toDepartment,
          transferBy: movement.transferBy,
          groupOrPhone: config.whatsappPhoneNumber || ''
        })
      });

      if (resp.ok) {
        return {
          success: true,
          url: shareUrl,
          message: formattedMsg,
          method: 'api'
        };
      }
    } catch (err) {
      console.warn('WhatsApp API Webhook POST failed, falling back to share URL:', err);
    }
  }

  // 3. Fallback to direct WhatsApp Share link URL
  return {
    success: true,
    url: shareUrl,
    message: formattedMsg,
    method: 'share'
  };
}
