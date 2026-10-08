import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, html, text, secret } = req.body || {};

  const expectedSecret = process.env.MAIL_SECRET || 'foodbridge-mail-secret-2026';
  if (secret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!to || !subject) {
    return res.status(400).json({ error: 'Recipient and subject are required' });
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    return res.status(500).json({ error: 'Mail relay credentials not configured in environment variables' });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  try {
    const info = await transporter.sendMail({
      from: `"FoodBridge" <${user}>`,
      to,
      subject,
      text: text || '',
      html: html || '',
    });

    console.log(`[MailRelay] Successfully sent email to ${to}, messageId: ${info.messageId}`);
    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('[MailRelay] Failed to send email via Gmail:', error);
    return res.status(500).json({ error: error.message });
  }
}
