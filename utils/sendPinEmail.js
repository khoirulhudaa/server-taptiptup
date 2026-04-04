const nodemailer = require('nodemailer'); 

// transporter (pakai Gmail)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS // pakai App Password!
  }
});

exports.sendPinEmail = async (email, pin) => {
  await transporter.sendMail({
    from: `"Dukung-In" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Kode Verifikasi Akun",
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2 style="color:#4f46e5">Verifikasi Akun Kamu</h2>
        <p>Gunakan kode berikut untuk verifikasi:</p>
        <div style="
          font-size:32px;
          font-weight:bold;
          letter-spacing:6px;
          background:#eef2ff;
          padding:12px;
          text-align:center;
          border-radius:12px;
          color:#4338ca;
        ">
          ${pin}
        </div>
        <p style="margin-top:20px">Kode berlaku selama 5 menit.</p>
      </div>
    `
  });
};