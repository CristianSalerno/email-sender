export default function handler(req, res) {
  const hasConfig = !!(process.env.SENDGRID_API_KEY && process.env.FROM_EMAIL);
  return res.status(200).json({
    connected: hasConfig,
    email: hasConfig ? process.env.FROM_EMAIL : null
  });
}