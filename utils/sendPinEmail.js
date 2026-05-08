const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS // Gunakan 16 digit App Password
  },
  // Tambahkan timeout agar tidak stuck selamanya
  connectionTimeout: 10000, 
  greetingTimeout: 10000,
});

exports.sendPinEmail = async (email, pin) => {
  try {
    const info = await transporter.sendMail({
      from: `"Dukung-In" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Kode Verifikasi Akun",
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:auto;border:1px solid #eee;padding:20px;border-radius:15px">
          <h2 style="color:#4f46e5;text-align:center">Verifikasi Akun Kamu</h2>
          <p>Halo,</p>
          <p>Gunakan kode berikut untuk memverifikasi akun Dukung-In kamu:</p>
          <div style="
            font-size:32px;
            font-weight:bold;
            letter-spacing:6px;
            background:#f3f4f6;
            padding:20px;
            text-align:center;
            border-radius:12px;
            color:#4338ca;
            margin:20px 0;
          ">
            ${pin}
          </div>
          <p style="color:#666;font-size:14px">Kode ini berlaku selama 5 menit. Jika kamu tidak merasa melakukan registrasi, abaikan email ini.</p>
        </div>
      `
    });
    console.log('Mail sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('NODEMAILER_ERROR:', error);
    // Kita lempar error agar ditangkap oleh catch di controller
    throw new Error('Gagal mengirim email verifikasi. Pastikan email valid.');
  }
};