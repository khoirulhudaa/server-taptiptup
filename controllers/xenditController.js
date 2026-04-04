const { Xendit } = require('xendit-node');
const { Donation, Withdrawal, User } = require('../models');

// ✅ Inisialisasi sekali, akses langsung dari xenditClient (JANGAN destructure)
const xenditClient = new Xendit({
  secretKey: process.env.XENDIT_SECRET_KEY,
});

// ============================================================
// CREATE DONATION INVOICE
// ============================================================
exports.createDonation = async (req, res) => {
  const { amount, donorName, message, userId, paymentMethod, email } = req.body;

  if (!amount || !userId) {
    return res.status(400).json({ message: 'Amount dan userId wajib diisi' });
  }

  const externalId = `donasi-${userId}-${Date.now()}`;

  try {
    // ✅ Akses via xenditClient.Invoice langsung (bukan destructure)
    const response = await xenditClient.Invoice.createInvoice({
      data: {
        externalId: externalId,       // ✅ camelCase
        amount: parseFloat(amount),
        description: `Donasi untuk User ${userId}`,
        customer: {
          givenNames: donorName || 'Anonim',
          email: email || 'customer@email.com',
        },
        successRedirectUrl: `${process.env.FRONTEND_URL}/donation/success`,
        callbackUrl: `${process.env.BACKEND_URL}/api/xendit/webhooks`,
        currency: 'IDR',
      },
    });

    await Donation.create({
      externalId,
      userId,
      amount: parseFloat(amount),
      donorName: donorName || 'Anonim',
      message,
      paymentUrl: response.invoiceUrl,
      status: 'PENDING',
    });

    res.json({ url: response.invoiceUrl });

  } catch (err) {
    console.error('[createDonation] Error:', JSON.stringify(err, null, 2));
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// WEBHOOK — INVOICE (Donasi Masuk)
// ============================================================
exports.handleWebhook = async (req, res) => {
  const callbackToken = req.headers['x-callback-token'];
  if (callbackToken !== process.env.XENDIT_CALLBACK_TOKEN) {
    console.warn('[handleWebhook] Unauthorized webhook attempt');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { external_id, status } = req.body;

  if (status === 'PAID') {
    try {
      const dataDonasi = await Donation.findOne({
        where: { externalId: external_id }, // ✅ kolom DB sesuai model Donation
        include: [{ model: User }],
      });

      // Idempotency: jangan proses ulang jika sudah PAID
      if (dataDonasi && dataDonasi.status !== 'PAID') {
        dataDonasi.status = 'PAID';
        await dataDonasi.save();

        const streamer = dataDonasi.User;
        if (streamer) {
          streamer.walletBalance =
            parseFloat(streamer.walletBalance || 0) + parseFloat(dataDonasi.amount);
          await streamer.save();

          const io = req.app.get('socketio');
          io.to(streamer.overlayToken).emit('new-donation', {
            donorName: dataDonasi.donorName,
            amount: dataDonasi.amount,
            message: dataDonasi.message,
          });

          console.log(`[handleWebhook] Donasi PAID: Rp${dataDonasi.amount} → @${streamer.username}`);
        }
      }
    } catch (err) {
      console.error('[handleWebhook] Error:', err);
      // Tetap 200 agar Xendit tidak retry terus
    }
  }

  res.status(200).send('OK');
};

// ============================================================
// WEBHOOK — DISBURSEMENT (Update Status Withdrawal)
// ============================================================
exports.handleDisbursementWebhook = async (req, res) => {
  const callbackToken = req.headers['x-callback-token'];
  if (callbackToken !== process.env.XENDIT_CALLBACK_TOKEN) {
    console.warn('[handleDisbursementWebhook] Unauthorized');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { external_id, status, failure_code } = req.body;

  try {
    const withdrawal = await Withdrawal.findOne({
      where: { xenditReference: external_id },
      include: [{ model: User }],
    });

    if (!withdrawal) {
      console.warn(`[handleDisbursementWebhook] Tidak ditemukan: ${external_id}`);
      return res.status(200).send('OK');
    }

    // Idempotency: skip jika sudah final
    if (withdrawal.status === 'COMPLETED' || withdrawal.status === 'FAILED') {
      return res.status(200).send('OK');
    }

    if (status === 'COMPLETED') {
      withdrawal.status = 'COMPLETED';
      await withdrawal.save();
      console.log(`[handleDisbursementWebhook] COMPLETED: Rp${withdrawal.amount} → ${withdrawal.accountNumber}`);

    } else if (status === 'FAILED') {
      withdrawal.status = 'FAILED';
      await withdrawal.save();

      // Rollback saldo ke streamer
      const user = withdrawal.User;
      if (user) {
        user.walletBalance =
          parseFloat(user.walletBalance || 0) + parseFloat(withdrawal.amount);
        await user.save();
        console.log(`[handleDisbursementWebhook] FAILED (${failure_code}), saldo dikembalikan ke @${user.username}`);
      }
    }
  } catch (err) {
    console.error('[handleDisbursementWebhook] Error:', err);
  }

  res.status(200).send('OK');
};

// ============================================================
// REQUEST WITHDRAWAL (Streamer Cairkan Saldo)
// ============================================================
exports.requestWithdrawal = async (req, res) => {
  const { amount, paymentMethod, channelCode, accountNumber, accountName } = req.body;
  const userId = req.user.id;

  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ message: 'Nominal tidak valid' });
  }
  if (parseFloat(amount) < 10000) {
    return res.status(400).json({ message: 'Minimal penarikan adalah Rp 10.000' });
  }
  if (!channelCode || !accountNumber || !accountName) {
    return res.status(400).json({ message: 'Data rekening/e-wallet tidak lengkap' });
  }

  const FEE = 5000;
  const totalDeduct = parseFloat(amount) + FEE;

  try {
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    if (parseFloat(user.walletBalance) < totalDeduct) {
      return res.status(400).json({
        message: `Saldo tidak mencukupi. Dibutuhkan Rp ${totalDeduct.toLocaleString('id-ID')} (termasuk biaya admin Rp 5.000)`,
      });
    }

    // Potong saldo dulu sebelum request Xendit (prevent race condition)
    user.walletBalance = parseFloat(user.walletBalance) - totalDeduct;
    await user.save();

    const externalId = `wd-${userId}-${Date.now()}`;

    let disbursementResponse;
    try {
      // ✅ Akses via xenditClient.Disbursement langsung, camelCase semua field
      disbursementResponse = await xenditClient.Disbursement.create({
        data: {
          externalId: externalId,           // ✅ camelCase
          bankCode: channelCode,            // ✅ camelCase
          accountHolderName: accountName,   // ✅ camelCase
          accountNumber: accountNumber,
          amount: parseFloat(amount),
          description: `Withdrawal @${user.username} via ${paymentMethod}`,
        },
      });
    } catch (xenditErr) {
      // Xendit gagal → rollback saldo
      user.walletBalance = parseFloat(user.walletBalance) + totalDeduct;
      await user.save();
      console.error('[requestWithdrawal] Xendit error:', JSON.stringify(xenditErr, null, 2));
      return res.status(502).json({
        message: 'Gagal menghubungi payment gateway. Silakan coba beberapa saat lagi.',
      });
    }

    await Withdrawal.create({
      userId,
      amount: parseFloat(amount),
      paymentMethod,
      channelCode,
      accountNumber,
      accountName,
      status: 'PENDING',
      xenditReference: externalId,
    });

    console.log(`[requestWithdrawal] @${user.username} WD Rp${amount} via ${channelCode}`);

    res.json({
      message: 'Permintaan penarikan sedang diproses. Dana akan masuk dalam beberapa menit.',
      xenditId: disbursementResponse.id,
    });

  } catch (err) {
    console.error('[requestWithdrawal] Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// GET WITHDRAWAL HISTORY (Riwayat Penarikan Streamer)
// ============================================================
exports.getWithdrawalHistory = async (req, res) => {
  const userId = req.user.id;

  try {
    const withdrawals = await Withdrawal.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: 20,
    });

    res.json(withdrawals);
  } catch (err) {
    console.error('[getWithdrawalHistory] Error:', err);
    res.status(500).json({ error: err.message });
  }
};