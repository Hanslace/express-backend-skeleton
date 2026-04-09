import nodemailer from 'nodemailer';
import { ENV } from '../config/index.js';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(ENV.MAIL_URL);
  }
  return transporter;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}) {
  await getTransporter().sendMail({ from: ENV.MAIL_FROM, ...opts });
}
