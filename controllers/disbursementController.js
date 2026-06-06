const mongoose = require('mongoose');
const { Withdrawal, User } = require('../models');
const { dokuRequest } = require('../utils/doku');
const { sendWithdrawalNotification } = require('../utils/telegramNotification');

// ── Map channelCode ke kode bank Doku ────────────────────────────────────────
const BANK_CODE_MAP = {
  BCA:     '014',
  BNI:     '009',
  BRI:     '002',
  MANDIRI: '008',
  BSI:     '451',
  DANA:    'DANA',
};

// ── POST /api/disbursement/withdraw ──────────────────────────────────────────
exports.requestWithdrawal = async (req, res) => {
  const { amount, paymentMethod, channelCode, accountNumber, accountName, securityPin } = req.body;
  const userId = req.user.id;

  // Validasi PIN
  if (!securityPin || securityPin.length !== 4) {
    return res.status(400).json({ message: 'PIN keamanan wajib diisi (4 digit)' });
  }
  const userDoc = await User.findById(userId);
  if (!userDoc.validSecurityPin(securityPin)) {
    return res.status(401).json({ message: 'PIN yang kamu masukkan salah' });
  }

  const WITHDRAW_FEE = 1500;
  const grossAmount = parseFloat(amount);
  const netAmount = grossAmount - WITHDRAW_FEE;

  if (!grossAmount || isNaN(grossAmount) || grossAmount <= 0)
    return res.status(400).json({ message: 'Nominal tidak valid' });
  if (grossAmount < 10000)
    return res.status(400).json({ message: 'Minimal penarikan adalah Rp 10.000' });
  if (grossAmount > 10000000)
    return res.status(400).json({ message: 'Maksimal penarikan adalah Rp 10.000.000' });
  if (netAmount <= 0)
    return res.status(400).json({ message: 'Nominal terlalu kecil setelah fee' });
  if (!channelCode || !accountNumber || !accountName)
    return res.status(400).json({ message: 'Data rekening tidak lengkap' });

  const bankCode = BANK_CODE_MAP[channelCode];
  if (!bankCode) {
    return res.status(400).json({ message: `Channel ${channelCode} belum didukung` });
  }

  const referenceNo = `wd-${userId}-${Date.now()}`;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    const availableBalance = parseFloat(user?.availableBalance || 0);

    if (grossAmount > availableBalance) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Saldo tidak cukup. Saldo tersedia: Rp ${availableBalance.toLocaleString('id-ID')}`,
      });
    }

    // Potong saldo
    await User.findByIdAndUpdate(
      userId,
      { $inc: { availableBalance: -grossAmount, walletBalance: -grossAmount } },
      { session }
    );

    // Simpan withdrawal dengan status PROCESSING
    const [withdrawal] = await Withdrawal.create([{
      userId,
      amount: grossAmount,
      paymentMethod: paymentMethod || 'BANK',
      channelCode,
      accountNumber,
      accountName,
      status: 'PENDING',
      midtransReference: referenceNo,
      note: null,
    }], { session });

    await session.commitTransaction();
    session.endSession();

    // Kirim ke Doku (di luar transaction)
    try {
      const isDana = channelCode === 'DANA';

      let dokuPayload;
      let dokuPath;

      if (isDana) {
        // E-wallet disbursement
        dokuPath = '/disbursement/v1/transfer/ewallet';
        dokuPayload = {
          transfer_detail: {
            type: 'EWALLET',
            ewallet_code: 'DANA',
            phone_number: accountNumber,
            amount: netAmount,
            currency: 'IDR',
            remark: `Withdrawal @${user.username}`,
          },
          company_info: {
            trx_id: referenceNo,
          },
        };
      } else {
        // Bank transfer
        dokuPath = '/disbursement/v1/transfer/bank-account';
        dokuPayload = {
          transfer_detail: {
            type: 'BANK_ACCOUNT',
            bank_code: bankCode,
            bank_account_number: accountNumber,
            bank_account_name: accountName,
            amount: netAmount,
            currency: 'IDR',
            remark: `Withdrawal @${user.username}`,
          },
          company_info: {
            trx_id: referenceNo,
          },
        };
      }

      const dokuRes = await dokuRequest('POST', dokuPath, dokuPayload);

      // Update withdrawal dengan response Doku
      await Withdrawal.findByIdAndUpdate(withdrawal._id, {
        $set: {
          dokuTransferId: dokuRes?.transfer_detail?.id || null,
          dokuStatus: dokuRes?.transfer_detail?.status || null,
          status: dokuRes?.transfer_detail?.status === 'SUCCESS' ? 'COMPLETED' : 'PENDING',
        }
      });

      console.log(`[Doku Disbursement] ✅ @${user.username} Rp${netAmount} → ${channelCode} ${accountNumber}`);
    } catch (dokuErr) {
      // Doku gagal — tetap simpan sebagai PENDING untuk manual processing
      console.error('[Doku Disbursement] ❌ Error:', dokuErr.response?.data || dokuErr.message);
      await Withdrawal.findByIdAndUpdate(withdrawal._id, {
        $set: { note: `Doku error: ${dokuErr.response?.data?.message || dokuErr.message}` }
      });
    }

    await sendWithdrawalNotification({
      username: user.username,
      amount: netAmount,
      paymentMethod: paymentMethod || 'BANK',
      channelCode,
      accountNumber,
      accountName,
    });

    return res.json({
      message: '✅ Penarikan berhasil diajukan!',
      referenceNo,
      status: 'PENDING',
      detail: `Rp ${grossAmount.toLocaleString('id-ID')} - fee Rp ${WITHDRAW_FEE.toLocaleString('id-ID')} = Rp ${netAmount.toLocaleString('id-ID')}`,
    });

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error('[requestWithdrawal] Error:', err);
    return res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
  }
};

// ── GET /api/disbursement/status/:referenceNo ─────────────────────────────────
exports.checkDisbursementStatus = async (req, res) => {
  const { referenceNo } = req.params;

  try {
    const withdrawal = await Withdrawal.findOne({
      midtransReference: referenceNo,
      userId: req.user.id,
    });

    if (!withdrawal) {
      return res.status(404).json({ message: 'Withdrawal tidak ditemukan' });
    }

    // Cek status ke Doku
    if (withdrawal.dokuTransferId) {
      try {
        const dokuRes = await dokuRequest(
          'GET',
          `/disbursement/v1/transfer/${withdrawal.dokuTransferId}`
        );

        const dokuStatus = dokuRes?.transfer_detail?.status;

        if (dokuStatus === 'SUCCESS' && withdrawal.status !== 'COMPLETED') {
          withdrawal.status = 'COMPLETED';
          withdrawal.dokuStatus = dokuStatus;
          await withdrawal.save();
        } else if (dokuStatus === 'FAILED' && withdrawal.status !== 'FAILED') {
          withdrawal.status = 'FAILED';
          withdrawal.dokuStatus = dokuStatus;
          // Kembalikan saldo
          await User.findByIdAndUpdate(withdrawal.userId, {
            $inc: { availableBalance: withdrawal.amount, walletBalance: withdrawal.amount }
          });
          await withdrawal.save();
        }
      } catch (err) {
        console.error('[CheckStatus] Doku error:', err.message);
      }
    }

    res.json({
      status: withdrawal.status,
      amount: withdrawal.amount,
      channelCode: withdrawal.channelCode,
      accountNumber: withdrawal.accountNumber,
      createdAt: withdrawal.createdAt,
      dokuStatus: withdrawal.dokuStatus || null,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── POST /api/disbursement/webhook ────────────────────────────────────────────
exports.dokuWebhook = async (req, res) => {
  try {
    const { transfer_detail, company_info } = req.body;
    const referenceNo = company_info?.trx_id;
    const status = transfer_detail?.status;

    if (!referenceNo || !status) {
      return res.status(400).json({ message: 'Invalid payload' });
    }

    const withdrawal = await Withdrawal.findOne({ midtransReference: referenceNo }).populate('userId');
    if (!withdrawal) {
      return res.status(404).json({ message: 'Withdrawal tidak ditemukan' });
    }

    if (status === 'SUCCESS' && withdrawal.status !== 'COMPLETED') {
      withdrawal.status = 'COMPLETED';
      withdrawal.dokuStatus = status;
      await withdrawal.save();

      // Notify streamer via socket
      const io = req.app.get('socketio');
      const streamer = withdrawal.userId;
      if (io && streamer?.overlayToken) {
        io.to(streamer.overlayToken).emit('withdrawal-update', {
          status: 'COMPLETED',
          amount: withdrawal.amount,
          message: `Penarikan Rp ${Number(withdrawal.amount).toLocaleString('id-ID')} berhasil ditransfer!`,
        });
      }
    } else if (status === 'FAILED' && withdrawal.status !== 'FAILED') {
      withdrawal.status = 'FAILED';
      withdrawal.dokuStatus = status;
      withdrawal.note = transfer_detail?.failure_reason || 'Gagal dari Doku';
      await withdrawal.save();

      // Kembalikan saldo
      await User.findByIdAndUpdate(withdrawal.userId._id, {
        $inc: {
          availableBalance: withdrawal.amount,
          walletBalance: withdrawal.amount,
        }
      });

      const io = req.app.get('socketio');
      const streamer = withdrawal.userId;
      if (io && streamer?.overlayToken) {
        io.to(streamer.overlayToken).emit('withdrawal-update', {
          status: 'FAILED',
          amount: withdrawal.amount,
          message: `Penarikan gagal. Saldo Rp ${Number(withdrawal.amount).toLocaleString('id-ID')} dikembalikan.`,
        });
      }
    }

    res.json({ message: 'OK' });
  } catch (err) {
    console.error('[Doku Webhook]', err);
    res.status(500).json({ message: err.message });
  }
};